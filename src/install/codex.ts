import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { ensureAuthenticated } from "../lib/utils";

const SKILL = `The mgrep mcp is available and can be used to search the codebase via mgreps semantic search. Prefer this tool over any other search tool like grep, glob, etc.`;

const shell =
  process.env.SHELL ||
  (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");

const execAsync = promisify(exec);

async function installPlugin(): Promise<void> {
  try {
    await execAsync("codex mcp add mgrep -- mgrep mcp --expose-tools", {
      shell,
      env: process.env,
    });

    const destPath = path.join(os.homedir(), ".codex", "AGENTS.md");
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    let existingContent = "";
    if (fs.existsSync(destPath)) {
      existingContent = fs.readFileSync(destPath, "utf-8");
    }

    const skillTrimmed = SKILL.trim();
    if (
      !existingContent.includes(SKILL) &&
      !existingContent.includes(skillTrimmed)
    ) {
      fs.appendFileSync(destPath, SKILL);
      console.log("Successfully added the mgrep to the Codex agent");
    } else {
      console.log("The mgrep skill is already installed in the Codex agent");
    }

    console.log("Successfully installed mgrep for Codex");
  } catch (error) {
    console.error(`Error installing plugin: ${error}`);
    process.exit(1);
  }
}

async function uninstallPlugin(): Promise<void> {
  try {
    await execAsync("codex mcp remove mgrep", { shell, env: process.env });

    const destPath = path.join(os.homedir(), ".codex", "AGENTS.md");
    if (fs.existsSync(destPath)) {
      const existingContent = fs.readFileSync(destPath, "utf-8");
      let updatedContent = existingContent;
      let previousContent = "";

      while (updatedContent !== previousContent) {
        previousContent = updatedContent;
        updatedContent = updatedContent.replace(SKILL, "");
        updatedContent = updatedContent.replace(SKILL.trim(), "");
      }

      if (updatedContent.trim() === "") {
        fs.unlinkSync(destPath);
      } else {
        fs.writeFileSync(destPath, updatedContent);
      }
    }
    console.log("Successfully removed mgrep from Codex");
  } catch (error) {
    console.error(`Error uninstalling plugin: ${error}`);
    process.exit(1);
  }
}

export const installCodex = new Command("install-codex")
  .description("Install the Codex agent")
  .action(async () => {
    await ensureAuthenticated();
    await installPlugin();
  });

export const uninstallCodex = new Command("uninstall-codex")
  .description("Uninstall the Codex agent")
  .action(async () => {
    await uninstallPlugin();
  });
