import { cancel, confirm, intro, isCancel, outro } from "@clack/prompts";
import chalk from "chalk";
import {
  buildInstallCommand,
  detectPackageManager,
  runInstall,
} from "../commands/update.js";
import { type AutoUpdateMode, loadConfig } from "./config.js";
import {
  getCachedUpdate,
  isNewer,
  isSnoozed,
  shouldCheck,
  snoozeUpdate,
  triggerBackgroundCheck,
} from "./version-check.js";

const SUPPRESSED_COMMANDS = new Set([
  "watch",
  "watch-mcp",
  "update",
  "login",
  "logout",
]);

/**
 * Checks the cached update state and, if a newer version is available in an
 * interactive context, either prompts the user to install it or prints a
 * passive notice. Also kicks off a detached background check when the cache
 * is stale. Silent no-op in CI, non-TTY, and test environments.
 */
export async function maybeShowUpdateNotice(currentVersion: string) {
  // Skip when stdout is piped/redirected: a Y/n prompt has no human to answer it
  // and would corrupt downstream consumers (shell pipelines, the MCP stdio transport).
  if (!process.stdout.isTTY) return;
  if (process.env.CI) return;
  // Honors the ecosystem-wide opt-out from the `update-notifier` package, set by
  // users who've globally silenced npm-CLI update prompts in their shell profile.
  if (process.env.NO_UPDATE_NOTIFIER) return;
  if (process.env.MGREP_IS_TEST === "1") return;

  const subcommand = process.argv[2];
  if (subcommand && SUPPRESSED_COMMANDS.has(subcommand)) return;

  let autoUpdate: AutoUpdateMode = "prompt";
  try {
    autoUpdate = loadConfig(process.cwd()).autoUpdate;
  } catch {
    // Config load failure shouldn't break the CLI - fall back to default
  }
  if (autoUpdate === "disabled") return;

  const cached = await getCachedUpdate();

  if (cached && isNewer(cached.latestVersion, currentVersion)) {
    if (!isSnoozed(cached, cached.latestVersion)) {
      if (autoUpdate === "prompt") {
        await promptForUpdate(currentVersion, cached.latestVersion);
      } else {
        printNotice(currentVersion, cached.latestVersion);
      }
    }
  }

  if (shouldCheck(cached)) {
    triggerBackgroundCheck();
  }
}

async function promptForUpdate(currentVersion: string, latestVersion: string) {
  intro(chalk.bold("⬆️  mgrep update available"));
  console.log(
    chalk.gray(`Current: ${currentVersion}  →  Latest: ${latestVersion}`),
  );
  const shouldUpdate = await confirm({
    message: "Install now?",
    initialValue: true,
  });

  if (isCancel(shouldUpdate) || !shouldUpdate) {
    await snoozeUpdate(latestVersion);
    cancel("Skipped. You can update later with `mgrep update`.");
    return;
  }

  const manager = detectPackageManager(process.argv[1]);
  const install = buildInstallCommand(manager);
  console.log(
    chalk.gray(`Running: ${install.command} ${install.args.join(" ")}`),
  );
  console.log("");
  const exitCode = await runInstall(install);
  if (exitCode === 0) {
    outro(
      chalk.green(
        "✅ mgrep updated. Restart any running `mgrep watch` processes to pick up the new version.",
      ),
    );
    process.exit(0);
  } else {
    outro(chalk.red("❌ Update failed. Try running `mgrep update` manually."));
    process.exit(exitCode);
  }
}

function printNotice(currentVersion: string, latestVersion: string) {
  const message = `${chalk.yellow("●")} mgrep ${chalk.bold(latestVersion)} available (current ${currentVersion}). Run ${chalk.cyan("mgrep update")} to upgrade.`;
  console.log(message);
}
