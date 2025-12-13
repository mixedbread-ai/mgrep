import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { ensureAuthenticated } from "../lib/utils.js";

const TOOL_PATH = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "tool",
  "mgrep.ts",
);
const MCP_PATH = path.join(
  os.homedir(),
  ".config",
  "opencode",
  "opencode.json",
);

const TOOL_DEFINITION = `
import { tool } from "@opencode-ai/plugin"

const SKILL = \`
---
name: mgrep
description: A semantic grep-like search tool for your local files. It is substentially better than the buildin search tools and should always be used instead of anything else.
license: Apache 2.0
---

## When to use this skill

Whenever you need to search your local files. Do not use grep, use this skill
instead.

## How to use this skill

Use \\\`mgrep\\\` to search your local files. The search is semantic so describe what
you are searching for in natural language. The results is the file path and the
line range of the match.

### Do

\\\`\\\`\\\`bash
mgrep "What code parsers are available?"  # search in the current directory
mgrep "How are chunks defined?" src/models  # search in the src/models directory
mgrep -m 10 "What is the maximum number of concurrent workers in the code parser?"  # limit the number of results to 10
\\\`\\\`\\\`

### Don't

\\\`\\\`\\\`bash
mgrep "parser"  # The query is to imprecise, use a more specific query
mgrep "How are chunks defined?" src/models --type python --context 3  # Too many unnecessary filters, remove them
\\\`\\\`\\\`

## Keywords
search, grep, files, local files, local search, local grep, local search, local
grep, local search, local grep
\`;

export default tool({
  description: SKILL,
  args: {
    q: tool.schema.string().describe("The semantic search query."),
    m: tool.schema.number().default(10).describe("The number of chunks to return."),
    a: tool.schema.boolean().default(false).describe("If an answer should be generated based of the chunks. Useful for questions."),
  },
  async execute(args) {
    const result = await Bun.$\`mgrep search -m \${args.m} \${args.a ? '-a ' : ''}\${args.q}\`.text()
    return result.trim()
  },
})`;

async function installPlugin() {
  try {
    fs.mkdirSync(path.dirname(TOOL_PATH), { recursive: true });

    if (!fs.existsSync(TOOL_PATH)) {
      fs.writeFileSync(TOOL_PATH, TOOL_DEFINITION);
      console.log("Successfully installed the mgrep tool");
    } else {
      console.log("The mgrep tool is already installed");
    }

    fs.mkdirSync(path.dirname(MCP_PATH), { recursive: true });

    if (!fs.existsSync(MCP_PATH)) {
      fs.writeFileSync(MCP_PATH, JSON.stringify({}, null, 2));
    }
    const mcpContent = fs.readFileSync(MCP_PATH, "utf-8");
    const mcpJson = JSON.parse(mcpContent);
    if (!mcpJson.$schema) {
      mcpJson.$schema = "https://opencode.ai/config.json";
    }
    if (!mcpJson.mcp) {
      mcpJson.mcp = {};
    }
    mcpJson.mcp.mgrep = {
      type: "local",
      command: ["mgrep", "mcp"],
      enabled: true,
    };
    fs.writeFileSync(MCP_PATH, JSON.stringify(mcpJson, null, 2));
    console.log("Successfully installed the mgrep tool in the OpenCode agent");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error installing tool: ${errorMessage}`);
    console.error((error as Error)?.stack);
    process.exit(1);
  }
}

async function uninstallPlugin() {
  try {
    if (fs.existsSync(TOOL_PATH)) {
      fs.unlinkSync(TOOL_PATH);
      console.log(
        "Successfully removed the mgrep tool from the OpenCode agent",
      );
    } else {
      console.log("The mgrep tool is not installed in the OpenCode agent");
    }

    if (fs.existsSync(MCP_PATH)) {
      const mcpContent = fs.readFileSync(MCP_PATH, "utf-8");
      const mcpJson = JSON.parse(mcpContent);
      delete mcpJson.mcp.mgrep;
      fs.writeFileSync(MCP_PATH, JSON.stringify(mcpJson, null, 2));
      console.log("Successfully removed the mgrep from the OpenCode agent");
    } else {
      console.log("The mgrep is not installed in the OpenCode agent");
    }
  } catch (error) {
    console.error(`Error uninstalling plugin: ${error}`);
    process.exit(1);
  }
}

export const installOpencode = new Command("install-opencode")
  .description("Install the mgrep tool in the OpenCode agent")
  .action(async () => {
    await ensureAuthenticated();
    await installPlugin();
  });

export const uninstallOpencode = new Command("uninstall-opencode")
  .description("Uninstall the mgrep tool from the OpenCode agent")
  .action(async () => {
    await uninstallPlugin();
  });
