import { cancel, intro, outro } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import {
  getCurrentOrganization,
  selectOrganization,
} from "../lib/organizations.js";
import { getStoredToken } from "../lib/token.js";

export async function switchOrgAction() {
  intro(chalk.bold("🔄 Switch Organization"));

  const token = await getStoredToken();

  if (!token) {
    cancel("You are not logged in. Please run 'mgrep login' first.");
    process.exit(1);
  }

  const currentOrg = await getCurrentOrganization(token.access_token);
  const selectedOrg = await selectOrganization(
    token.access_token,
    currentOrg?.id,
  );

  outro(
    chalk.green(`✅ Switched to organization ${chalk.bold(selectedOrg.name)}.`),
  );
}

export const switchOrg = new Command("switch-org")
  .description("Switch to a different organization")
  .action(switchOrgAction);
