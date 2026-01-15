#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { program } from "commander";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { search } from "./commands/search.js";
import { switchOrg } from "./commands/switch-org.js";
import { watch } from "./commands/watch.js";
import { watchMcp } from "./commands/watch_mcp.js";
import {
  installClaudeCode,
  uninstallClaudeCode,
} from "./install/claude-code.js";
import { installCodex, uninstallCodex } from "./install/codex.js";
import { installDroid, uninstallDroid } from "./install/droid.js";
import { installOpencode, uninstallOpencode } from "./install/opencode.js";
import { setupLogger } from "./lib/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
program.addCommand(installCodex);
program.addCommand(uninstallCodex);
program.addCommand(installDroid);
program.addCommand(uninstallDroid);
program.addCommand(installOpencode);
program.addCommand(uninstallOpencode);
program.addCommand(login);
program.addCommand(logout);
program.addCommand(switchOrg);
program.addCommand(watchMcp);

program.parse();
