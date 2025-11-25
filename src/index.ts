#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { Command, program } from "commander";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { search } from "./commands/search";
import { watch } from "./commands/watch";
import { installClaudeCode, uninstallClaudeCode } from "./install/claude-code";
import { listDaemons, stopDaemon } from "./lib/daemon";
import { setupLogger } from "./lib/logger";

setupLogger();

program
  .version(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "../package.json"), {
        encoding: "utf-8",
      }),
    ).version,
  )
  .option(
    "--store <string>",
    "The store to use",
    process.env.MXBAI_STORE || "mgrep",
  );

program.addCommand(search, { isDefault: true });
program.addCommand(watch);
program.addCommand(installClaudeCode);
program.addCommand(uninstallClaudeCode);
program.addCommand(login);
program.addCommand(logout);

const daemonList = new Command("daemon:list")
  .description("List all running daemons")
  .action(() => {
    const daemons = listDaemons();
    if (daemons.length === 0) {
      console.log("No daemons running");
    } else {
      for (const d of daemons) {
        console.log(`PID ${d.pid}: ${d.dir}`);
      }
    }
  });

const daemonStop = new Command("daemon:stop")
  .description("Stop daemon for directory (default: cwd)")
  .argument("[dir]", "Directory to stop daemon for")
  .action((dir) => {
    const target = dir || process.cwd();
    if (stopDaemon(target)) {
      console.log("Daemon stopped");
    } else {
      console.log(`No daemon was running for ${target}`);
    }
  });

program.addCommand(daemonList);
program.addCommand(daemonStop);

program.parse();
