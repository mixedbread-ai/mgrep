import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import { ensureAuthenticated } from "../lib/utils.js";

const shell =
  process.env.SHELL ||
  (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");

const execAsync = promisify(exec);

async function installPlugin() {
  try {
    await execAsync("claude plugin marketplace add mixedbread-ai/mgrep", {
      shell,
      env: process.env,
    });
    console.log(
      "Successfully added the mixedbread-ai/mgrep plugin to the marketplace",
    );
  } catch (error) {
    console.error(`Error installing plugin: ${error}`);
    console.error(
      `Do you have claude-code version 2.0.36 or higher installed?`,
    );
  }

  try {
    await execAsync("claude plugin install mgrep", {
      shell,
      env: process.env,
    });
    console.log("Successfully installed the mgrep plugin");
  } catch (error) {
    console.error(`Error installing plugin: ${error}`);
    console.error(
      `Do you have claude-code version 2.0.36 or higher installed?`,
    );
    process.exit(1);
  }
}

async function uninstallPlugin() {
  try {
    await execAsync("claude plugin uninstall mgrep", {
      shell,
      env: process.env,
    });
    console.log("Successfully uninstalled the mgrep plugin");
  } catch (error) {
    console.error(`Error uninstalling plugin: ${error}`);
    console.error(
      `Do you have claude-code version 2.0.36 or higher installed?`,
    );
  }

  try {
    await execAsync("claude plugin marketplace remove mixedbread-ai/mgrep", {
      shell,
      env: process.env,
    });
    console.log(
      "Successfully removed the mixedbread-ai/mgrep plugin from the marketplace",
    );
  } catch (error) {
    console.error(`Error removing plugin from marketplace: ${error}`);
    console.error(
      `Do you have claude-code version 2.0.36 or higher installed?`,
    );
    process.exit(1);
  }
}

export const installClaudeCode = new Command("install-claude-code")
  .description("Install the Claude Code plugin")
  .action(async () => {
    await ensureAuthenticated();
    await installPlugin();
  });

export const uninstallClaudeCode = new Command("uninstall-claude-code")
  .description("Uninstall the Claude Code plugin")
  .action(async () => {
    await uninstallPlugin();
  });
