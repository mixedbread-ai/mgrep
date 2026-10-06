import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Command } from "commander";
import { z } from "zod";
import { loadConfig } from "../lib/config.js";
import { createStore } from "../lib/context.js";
import { runSearch } from "../lib/search.js";
import { isAtOrAboveHomeDirectory } from "../lib/utils.js";
import { getPackageVersion } from "../lib/version.js";
import { syncFiles } from "./search.js";
import { startWatch } from "./watch.js";

// The SDK's default roots schema rejects non-file URIs before we can skip them.
const rootsResult = z.object({
  roots: z.array(z.object({ uri: z.string() })),
});

const searchArguments = z.strictObject({
  query: z.string().min(1),
  path: z.string().optional(),
  maxCount: z.number().int().positive().default(10),
  content: z.boolean().default(false),
  answer: z.boolean().default(false),
  web: z.boolean().default(false),
});

export const watchMcp = new Command("mcp")
  .description("Start MCP server for mgrep")
  .option("--expose-tools", "Expose search tools via MCP", false)
  .option("--no-watch", "Skip background file sync")
  .action(async (_options, cmd) => {
    // The MCP server is writing to stdout, so all logs are written to stderr.
    console.log = (...args: unknown[]) => {
      process.stderr.write(`[LOG] ${args.join(" ")}\n`);
    };
    console.error = (...args: unknown[]) => {
      process.stderr.write(`[ERROR] ${args.join(" ")}\n`);
    };
    console.debug = (...args: unknown[]) => {
      process.stderr.write(`[DEBUG] ${args.join(" ")}\n`);
    };
    console.info = console.log;

    process.on("unhandledRejection", (reason) => {
      console.error("Unhandled rejection:", reason);
    });

    const options: { store: string; exposeTools: boolean; watch: boolean } =
      cmd.optsWithGlobals();
    const configuredSyncWaitMs = Number(
      process.env.MGREP_MCP_SYNC_WAIT_MS?.trim() || "20000",
    );
    const syncWaitMs =
      Number.isInteger(configuredSyncWaitMs) &&
      configuredSyncWaitMs >= 0 &&
      configuredSyncWaitMs <= 2147483647
        ? configuredSyncWaitMs
        : 20000;
    const root = process.cwd();
    const transport = new StdioServerTransport();
    const server = new Server(
      { name: "mgrep", version: getPackageVersion() },
      {
        capabilities: { tools: {} },
        instructions: `mgrep semantic search is available through this server's \`search\` tool. Use it for conceptual or cross-file questions where you don't know the exact identifier, such as 'where is authentication handled'. It searches ${root} by default. Use rg or grep for exact strings, symbol names and regexes. Both are fine; pick whichever fits the question.`,
      },
    );
    let syncTimer: NodeJS.Timeout | undefined;
    let closing = false;
    const firstSyncs = new Map<string, Promise<void>>();
    const serverRoot = realpathSync(root);
    const serverRootPrefix = serverRoot.endsWith(sep)
      ? serverRoot
      : `${serverRoot}${sep}`;
    let completeWatch: (watching: boolean) => void = () => {};
    // Requests can arrive before the delayed watcher startup completes.
    const watcherReady = new Promise<boolean>((resolve) => {
      completeWatch = resolve;
    });
    if (!options.watch) completeWatch(false);

    const resolveRoot = async (searchPath?: string): Promise<string> => {
      if (searchPath !== undefined)
        return realpathSync(resolve(root, searchPath));
      if (server.getClientCapabilities()?.roots) {
        const { roots } = rootsResult.parse(
          await server.request(
            { method: "roots/list" },
            ResultSchema.passthrough(),
          ),
        );
        const fileRoot = roots.find((entry) => entry.uri.startsWith("file://"));
        if (fileRoot) return realpathSync(fileURLToPath(fileRoot.uri));
      }
      if (options.watch) return root;
      throw new Error(
        "An absolute project path is required; pass the absolute project directory as path.",
      );
    };

    const shutdown = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      clearTimeout(syncTimer);
      completeWatch(false);
      try {
        await server.close();
      } finally {
        // In-process fs.watch handles must not outlive the MCP client.
        process.exit(0);
      }
    };

    server.onclose = () => void shutdown();
    process.stdin.once("end", () => void shutdown());
    process.stdin.once("close", () => void shutdown());
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        console.error(`Received ${signal}, shutting down gracefully...`);
        void shutdown();
      });
    }

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: options.exposeTools
        ? [
            {
              name: "search",
              description:
                "Semantic search over the project's files, indexed by mgrep. Use it for conceptual or cross-file questions where you don't know the exact identifier, such as 'where is authentication handled' or 'how are failed uploads retried'. For exact strings, symbol names or regexes, use rg or grep instead. path is optional and defaults to the session's project directory. Results are file paths with line ranges; read only those ranges. Set web and answer to true for a web lookup.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    minLength: 1,
                    description: "A full natural-language question.",
                  },
                  path: {
                    type: "string",
                    description:
                      "A path relative to the server cwd or an absolute path.",
                  },
                  maxCount: {
                    type: "integer",
                    minimum: 1,
                    multipleOf: 1,
                    default: 10,
                  },
                  content: { type: "boolean", default: false },
                  answer: { type: "boolean", default: false },
                  web: { type: "boolean", default: false },
                },
                required: options.watch ? ["query"] : ["query", "path"],
                additionalProperties: false,
              },
              annotations: {
                title: "mgrep semantic search",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
          ]
        : [],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (!options.exposeTools || request.params.name !== "search") {
          throw new Error(`Unknown tool: ${request.params.name}`);
        }
        const args = searchArguments.parse(request.params.arguments ?? {});
        const searchRoot = await resolveRoot(args.path);
        let watcherStatus: boolean | undefined = false;
        if (
          options.watch &&
          (searchRoot === serverRoot || searchRoot.startsWith(serverRootPrefix))
        ) {
          let waitTimer: NodeJS.Timeout | undefined;
          try {
            watcherStatus = await Promise.race([
              watcherReady,
              new Promise<undefined>((resolve) => {
                waitTimer = setTimeout(() => resolve(undefined), syncWaitMs);
              }),
            ]);
          } finally {
            clearTimeout(waitTimer);
          }
        }
        const store = await createStore({ interactive: false });
        if (watcherStatus === false && !isAtOrAboveHomeDirectory(searchRoot)) {
          let firstSync = firstSyncs.get(searchRoot);
          if (!firstSync) {
            firstSync = syncFiles(
              store,
              options.store,
              searchRoot,
              false,
              loadConfig(searchRoot),
            ).then(() => undefined);
            firstSyncs.set(searchRoot, firstSync);
          }
          try {
            await firstSync;
          } catch (error) {
            firstSyncs.delete(searchRoot);
            throw error;
          }
        }
        let text = await runSearch(
          store,
          {
            ...args,
            store: options.store,
            path: searchRoot,
            rerank: true,
            agentic: false,
          },
          searchRoot,
        );
        if (watcherStatus === undefined) {
          text = [
            text,
            "Note: the initial mgrep sync is still running; results may be incomplete.",
          ]
            .filter(Boolean)
            .join("\n");
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text }], isError: true };
      }
    });

    await server.connect(transport);
    if (closing || !options.watch) return;

    console.log("[SYNC] Scheduling initial sync in 1 second...");
    syncTimer = setTimeout(async () => {
      if (isAtOrAboveHomeDirectory(root)) {
        console.error(
          "[SYNC] Background sync skipped: cwd is at or above the home directory.",
        );
        completeWatch(false);
        return;
      }
      console.log("[SYNC] Starting file sync...");
      try {
        completeWatch(
          await startWatch({
            store: options.store,
            dryRun: false,
            createStore: () => createStore({ interactive: false }),
          }),
        );
      } catch (error) {
        console.error("[SYNC] Failed to start watcher:", error);
        completeWatch(false);
      } finally {
        // Watch's CLI error status must not affect a healthy MCP session.
        process.exitCode = 0;
      }
    }, 1000);
  });
