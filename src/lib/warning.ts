import chalk from "chalk";

/**
 * Prints a prominent warning message about mgrep's background sync behavior.
 * Should be called after successful installation to inform users.
 * @param agentName - The name of the agent mgrep was installed for (e.g., "Claude Code", "OpenCode")
 * @param uninstallCommand - The command to run to uninstall mgrep from this agent
 */
export function printInstallWarning(
  agentName: string,
  uninstallCommand: string,
): void {
  const border = chalk.yellow("═".repeat(70));
  const warningIcon = chalk.yellow.bold("⚠️  WARNING");

  console.log();
  console.log(border);
  console.log();
  console.log(`  ${warningIcon}`);
  console.log();
  console.log(chalk.yellow.bold("  BACKGROUND SYNC ENABLED"));
  console.log();
  console.log(
    chalk.white(
      "  mgrep runs a background process that syncs your files to enable",
    ),
  );
  console.log(chalk.white("  semantic search. This process:"));
  console.log();
  console.log(
    chalk.white("    • Starts automatically when you begin a session"),
  );
  console.log(chalk.white("    • Indexes files in your working directory"));
  console.log(
    chalk.white(
      "    • Syncs file content to mixedbread's servers for embedding (this creates usage on the mixedbread platform)",
    ),
  );
  console.log(chalk.white("    • Stops when your session ends"));
  console.log();
  console.log(chalk.cyan.bold(`  To uninstall mgrep from ${agentName}:`));
  console.log();
  console.log(chalk.green(`    ${uninstallCommand}`));
  console.log();
  console.log(border);
  console.log();
}
