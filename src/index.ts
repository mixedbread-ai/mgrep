#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { program } from "commander";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { search } from "./commands/search.js";
import { switchOrg } from "./commands/switch-org.js";
import { update } from "./commands/update.js";
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
import { maybeShowUpdateNotice } from "./lib/update-notice.js";
import { runVersionCheck } from "./lib/version-check.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const currentVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), {
    encoding: "utf-8",
  }),
).version as string;

// Background-check worker path: same binary, re-execed with this env var.
// Performs a single registry fetch + cache write, then exits.
if (process.env.MGREP_INTERNAL_VERSION_CHECK === "1") {
  await runVersionCheck(currentVersion);
  process.exit(0);
}

setupLogger();

await maybeShowUpdateNotice(currentVersion);

program
  .version(currentVersion)
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
program.addCommand(update);

program.parse();
