import { spawn } from "node:child_process";
import fs from "node:fs";
import { intro, outro } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";

const PACKAGE_NAME = "@mixedbread/mgrep";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface InstallCommand {
  command: string;
  args: string[];
}

/**
 * Detects which package manager installed the running mgrep binary by
 * inspecting the resolved path of process.argv[1]. Falls back to npm.
 */
export function detectPackageManager(
  binaryPath: string | undefined,
): PackageManager {
  if (!binaryPath) return "npm";
  let resolved: string;
  try {
    resolved = fs.realpathSync(binaryPath);
  } catch {
    resolved = binaryPath;
  }
  const haystack = `${binaryPath}|${resolved}`;
  if (haystack.includes("/.bun/") || haystack.includes("\\.bun\\"))
    return "bun";
  if (haystack.includes("/.yarn/") || haystack.includes("\\.yarn\\"))
    return "yarn";
  if (
    haystack.includes("/.pnpm/") ||
    haystack.includes("\\.pnpm\\") ||
    haystack.includes("/pnpm/") ||
    haystack.includes("\\pnpm\\")
  ) {
    return "pnpm";
  }
  return "npm";
}

export function buildInstallCommand(manager: PackageManager): InstallCommand {
  switch (manager) {
    case "pnpm":
      return { command: "pnpm", args: ["add", "-g", PACKAGE_NAME] };
    case "yarn":
      return { command: "yarn", args: ["global", "add", PACKAGE_NAME] };
    case "bun":
      return { command: "bun", args: ["add", "-g", PACKAGE_NAME] };
    default:
      return { command: "npm", args: ["i", "-g", PACKAGE_NAME] };
  }
}

export async function runInstall(install: InstallCommand): Promise<number> {
  return await new Promise((resolve) => {
    const child = spawn(install.command, install.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function updateAction() {
  intro(chalk.bold("⬆️  mgrep update"));

  const manager = detectPackageManager(process.argv[1]);
  const install = buildInstallCommand(manager);
  const fullCommand = `${install.command} ${install.args.join(" ")}`;

  console.log(chalk.gray(`Detected package manager: ${manager}`));
  console.log(chalk.gray(`Running: ${fullCommand}`));
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
    outro(
      chalk.red(
        `❌ Update failed. Try running manually: ${chalk.bold(fullCommand)}`,
      ),
    );
    process.exit(exitCode);
  }
}

export const update = new Command("update")
  .description("Update mgrep to the latest version")
  .action(updateAction);
