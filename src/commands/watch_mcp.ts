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

    const options: {
      store: string;
    } = cmd.optsWithGlobals();

    setTimeout(() => {
      startWatch({ store: options.store, dryRun: false });
    }, 0);

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
  });
