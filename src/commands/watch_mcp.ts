import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Command } from "commander";
import { startWatch } from "./watch";

export const watchMcp = new Command("mcp")
  .description("Start MCP server for mgrep")
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
      return {
        tools: [],
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (_request) => {
      return {
        result: "Not implemented",
      };
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
