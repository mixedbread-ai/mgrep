import { cancel, outro } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import { createStore } from "../lib/context.js";
import { getCachedOrganization } from "../lib/organizations.js";

/**
 * Lists all stores in the current organization
 */
export async function listStoresAction() {
  try {
    const store = await createStore();

    // Display organization info if available
    const cachedOrg = await getCachedOrganization();
    if (cachedOrg) {
      console.log(
        chalk.dim(
          `Organization: ${cachedOrg.name} (${cachedOrg.slug})`,
        ),
      );
      console.log("");
    }

    const stores = await store.list();

    if (stores.length === 0) {
      console.log(chalk.yellow("No stores found in this organization."));
      console.log(
        chalk.dim("Create a store by running 'mgrep watch' in a project directory."),
      );
      return;
    }

    console.log(chalk.bold(`Found ${stores.length} store(s):\n`));

    for (const s of stores) {
      console.log(`  ${chalk.cyan(s.name)}`);
      if (s.description) {
        console.log(`    ${chalk.dim(s.description)}`);
      }
      console.log(
        `    ${chalk.dim(`Created: ${new Date(s.created_at).toLocaleDateString()}`)}`,
      );
      console.log("");
    }

    outro(chalk.dim("Use '--store <name>' to specify a store for operations"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    cancel(`Failed to list stores: ${message}`);
    process.exit(1);
  }
}

export const listStores = new Command("list-stores")
  .alias("ls")
  .description("List all stores in the current organization")
  .action(listStoresAction);
