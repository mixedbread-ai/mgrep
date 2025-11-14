import { exec } from "node:child_process";
import { Command } from "commander";
import { ensureAuthenticated } from "../utils";

const shell =
  process.env.SHELL ||
  (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");

function installPlugin() {
  exec(
    "claude plugin marketplace add mixedbread-ai/mgrep",
    { shell, env: process.env },
    (error) => {
      if (error) {
        console.error(`Error installing plugin: ${error}`);
        console.error(
          `Do you have claude-code version 2.0.36 or higher installed?`,
        );
        process.exit(1);
      }
      console.log(
        "Successfully added the mixedbread-ai/mgrep plugin to the marketplace",
      );
      exec(
        "claude plugin install mgrep",
        { shell, env: process.env },
        (error) => {
          if (error) {
            console.error(`Error installing plugin: ${error}`);
            console.error(
              `Do you have claude-code version 2.0.36 or higher installed?`,
            );
            process.exit(1);
          }
          console.log("Successfully installed the mgrep plugin");
        },
      );
    },
  );
}

export const installClaudeCode = new Command("install-claude-code")
  .description("Install the Claude Code plugin")
  .action(async () => {
    await ensureAuthenticated();
    await installPlugin();
  });
