import { outro } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import { deleteToken, getStoredToken } from "../lib/token.js";

export async function logoutAction() {
  const token = await getStoredToken();
  if (!token) {
    outro(chalk.blue("You are not logged in"));
    process.exit(0);
  }

  await deleteToken();
  outro(chalk.green("✅ Successfully logged out"));
}

export const logout = new Command("logout")
  .description("Logout from the Mixedbread platform")
  .action(logoutAction);
