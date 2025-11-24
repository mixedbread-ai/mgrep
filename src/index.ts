#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { program } from "commander";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { search } from "./commands/search";
import { watch } from "./commands/watch";
import { installClaudeCode, uninstallClaudeCode } from "./install/claude-code";
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

program.parse();
