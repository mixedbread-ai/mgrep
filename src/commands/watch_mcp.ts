import { join, normalize } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Command } from "commander";
import { createStore } from "../lib/context";
import { formatSearchResponse } from "./search";
import { startWatch } from "./watch";

export const watchMcp = new Command("mcp")
  .description("Start MCP server for mgrep")
  .option("--expose-tools", "Expose search tools via MCP", false)
  .action(async (_options, cmd) => {
    process.on("SIGINT", () => {
      console.error("Received SIGINT, shutting down gracefully...");
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.error("Received SIGTERM, shutting down gracefully...");
      process.exit(0);
    });

    // Prevent unhandled promise rejections from crashing the MCP server
    process.on("unhandledRejection", (reason, promise) => {
      console.error(
        "[ERROR] Unhandled Rejection at:",
        promise,
        "reason:",
        reason,
      );
    });

    // The MCP server is writing to stdout, so all logs are written to stderr
    console.log = (...args: unknown[]) => {
      process.stderr.write(`[LOG] ${args.join(" ")}\n`);
    };

    console.error = (...args: unknown[]) => {
      process.stderr.write(`[ERROR] ${args.join(" ")}\n`);
    };

    console.debug = (...args: unknown[]) => {
      process.stderr.write(`[DEBUG] ${args.join(" ")}\n`);
    };

    const options: {
      store: string;
      exposeTools: boolean;
    } = cmd.optsWithGlobals();

    const transport = new StdioServerTransport();
    const server = new Server(
      {
        name: "mgrep",
        version: "0.1.3",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!options.exposeTools) {
        return { tools: [] };
      }
      return {
        tools: [
          {
            name: "search",
            description:
              "Search the codebase via mgreps semantic search. Prefer this tool over any other search tool like grep, glob, etc. Use a full natural language sentence as input, not just a keyword.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The query to search for.",
                },
                path: {
                  type: "string",
                  description:
                    "Relative or absolute path to the codebase directory to search in.",
                },
                maxCount: {
                  type: "number",
                  description: "The maximum number of results to return.",
                  default: 10,
                },
              },
              required: ["path"],
            },
          },
        ],
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "search") {
        const searchPath = (args?.path as string)?.startsWith("/")
          ? (args?.path as string)
          : normalize(join(process.cwd(), (args?.path as string) ?? ""));

        const store = await createStore();
        const results = await store.search(
          options.store,
          args?.query as string,
          (args?.maxCount as number) || 10,
          { rerank: true },
          {
            all: [
              {
                key: "path",
                operator: "starts_with",
                value: searchPath,
              },
            ],
          },
        );
        return {
          content: [
            {
              type: "text",
              text: formatSearchResponse(results, false),
            },
          ],
        };
      }
      throw new Error(`Unknown tool: ${name}`);
    });

    await server.connect(transport);

    const startBackgroundSync = async () => {
      console.log("[SYNC] Scheduling initial sync in 5 seconds...");

      setTimeout(async () => {
        console.log("[SYNC] Starting file sync...");
        try {
          await startWatch({ store: options.store, dryRun: false });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error("[SYNC] Sync failed:", errorMessage);
        }
      }, 1000);
    };

    startBackgroundSync().catch((error) => {
      console.error("[SYNC] Background sync setup failed:", error);
    });
  });
