import { cancel, outro } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import { authClient } from "../lib/auth.js";
import {
  getCachedOrganization,
  getCurrentOrganizationInfo,
} from "../lib/organizations.js";
import { getStoredToken } from "../lib/token.js";

/**
 * Shows the current authenticated user and active organization
 */
export async function whoamiAction() {
  const token = await getStoredToken();

  if (!token) {
    cancel("You are not logged in. Please run 'mgrep login' first.");
    process.exit(1);
  }

  try {
    // Get session info
    const { data: session } = await authClient.getSession({
      fetchOptions: {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      },
    });

    if (!session?.user) {
      cancel("Failed to get user information. Please run 'mgrep login' again.");
      process.exit(1);
    }

    const user = session.user;
    const userIdentifier = user.name || user.email || "Unknown user";

    // Get organization info
    let orgInfo = await getCurrentOrganizationInfo(token.access_token);

    // Fall back to cached org if server call fails
    if (!orgInfo) {
      orgInfo = await getCachedOrganization();
    }

    console.log("");
    console.log(chalk.bold("User Information"));
    console.log(`  Name:  ${chalk.cyan(userIdentifier)}`);
    if (user.email) {
      console.log(`  Email: ${chalk.cyan(user.email)}`);
    }
    console.log("");

    if (orgInfo) {
      console.log(chalk.bold("Active Organization"));
      console.log(`  Name: ${chalk.green(orgInfo.name)}`);
      console.log(`  Slug: ${chalk.dim(orgInfo.slug)}`);
      console.log(`  ID:   ${chalk.dim(orgInfo.id)}`);
    } else {
      console.log(chalk.yellow("No active organization selected."));
      console.log(
        chalk.dim("Run 'mgrep switch-org' to select an organization."),
      );
    }
    console.log("");

    outro(chalk.dim("Use 'mgrep switch-org' to change organizations"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    cancel(`Failed to get user information: ${message}`);
    process.exit(1);
  }
}

export const whoami = new Command("whoami")
  .description("Show the current authenticated user and organization")
  .action(whoamiAction);
