import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { ensureAuthenticated } from "../lib/utils.js";

const LEGACY_AGENTS_BLOCK = `
---
name: mgrep
description: A semantic grep-like search tool for your local files. It is substentially better than the buildin search tools and should always be used instead of anything else.
license: Apache 2.0
---

## When to use this skill

Whenever you need to search your local files. Do not use grep, use this skill
instead.

## How to use this skill

Use \`mgrep\` to search your local files. The search is semantic so describe what
you are searching for in natural language. The results is the file path and the
line range of the match.

### Do

\`\`\`bash
mgrep "What code parsers are available?"  # search in the current directory
mgrep "How are chunks defined?" src/models  # search in the src/models directory
mgrep -m 10 "What is the maximum number of concurrent workers in the code parser?"  # limit the number of results to 10
\`\`\`

### Don't

\`\`\`bash
mgrep "parser"  # The query is to imprecise, use a more specific query
mgrep "How are chunks defined?" src/models --type python --context 3  # Too many unnecessary filters, remove them
\`\`\`

## Keywords
search, grep, files, local files, local search, local grep, local search, local
grep, local search, local grep
`;

const execFileAsync = promisify(execFile);
const MARKETPLACE = "Mixedbread-Grep";
const PLUGIN = `mgrep@${MARKETPLACE}`;

async function runCodex(args: string[]): Promise<void> {
  await execFileAsync("codex", args, { env: process.env });
}

function removeLegacyAgentsBlocks(warnOnFailure = false): void {
  const agentsPaths = new Set([
    path.resolve(
      process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
      "AGENTS.md",
    ),
    path.join(os.homedir(), ".codex", "AGENTS.md"),
  ]);
  for (const agentsPath of agentsPaths) {
    try {
      if (!fs.existsSync(agentsPath)) continue;
      const existingContent = fs.readFileSync(agentsPath, "utf-8");
      let updatedContent = existingContent;
      let previousContent = "";
      while (updatedContent !== previousContent) {
        previousContent = updatedContent;
        updatedContent = updatedContent.replace(LEGACY_AGENTS_BLOCK, "");
        updatedContent = updatedContent.replace(LEGACY_AGENTS_BLOCK.trim(), "");
      }
      if (updatedContent === existingContent) continue;
      if (updatedContent.trim() === "") fs.unlinkSync(agentsPath);
      else fs.writeFileSync(agentsPath, updatedContent);
    } catch (error) {
      if (!warnOnFailure) throw error;
      console.warn(
        `Warning: Could not clean legacy instructions in ${agentsPath}: ${error}`,
      );
    }
  }
}

async function installPlugin(): Promise<void> {
  try {
    await runCodex(["mcp", "remove", "mgrep"]).catch(() => undefined);
    removeLegacyAgentsBlocks();
    const source =
      process.env.MGREP_CODEX_MARKETPLACE ||
      "https://github.com/mixedbread-ai/mgrep.git";
    try {
      await runCodex(["plugin", "marketplace", "add", source]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already (?:added|exists|registered|configured)/i.test(message))
        throw error;
    }
    await runCodex(["plugin", "add", PLUGIN]);
    console.log("Successfully installed the mgrep plugin for Codex");
    console.log(
      "On first start, Codex asks you to review the plugin's SessionStart hook (or use /hooks); it only adds search guidance. The plugin's MCP server syncs the session's project directory in the background while Codex runs.",
    );
  } catch (error) {
    console.error(`Error installing plugin: ${error}`);
    process.exitCode = 1;
  }
}

async function uninstallPlugin(): Promise<void> {
  for (const args of [
    ["plugin", "remove", PLUGIN],
    ["plugin", "marketplace", "remove", MARKETPLACE],
    ["mcp", "remove", "mgrep"],
  ]) {
    try {
      await runCodex(args);
    } catch (error) {
      console.warn(`Warning: Could not run codex ${args.join(" ")}: ${error}`);
    }
  }
  removeLegacyAgentsBlocks(true);
  console.log("Finished removing the mgrep Codex integration");
}

/** Installs the native mgrep Codex plugin and removes legacy agent instructions. */
export const installCodex = new Command("install-codex")
  .description("Install the mgrep plugin for Codex")
  .action(async (): Promise<void> => {
    await ensureAuthenticated();
    await installPlugin();
  });

/** Removes the native mgrep Codex plugin and legacy agent instructions. */
export const uninstallCodex = new Command("uninstall-codex")
  .description("Uninstall the mgrep plugin for Codex")
  .action(async (): Promise<void> => {
    await uninstallPlugin();
  });
