import { cancel, confirm, intro, isCancel, outro } from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";
import open from "open";
import yoctoSpinner from "yocto-spinner";
import { authClient } from "../lib/auth.js";
import { selectOrganization } from "../lib/organizations.js";
import { getStoredToken, pollForToken, storeToken } from "../lib/token.js";

const CLIENT_ID = "mgrep";

export async function loginAction() {
  intro(chalk.bold("🔐 Mixedbread Login"));

  // Check if already logged in
  const existingToken = await getStoredToken();
  if (existingToken) {
    const shouldReauth = await confirm({
      message: "You're already logged in. Do you want to log in again?",
      initialValue: false,
    });

    if (isCancel(shouldReauth) || !shouldReauth) {
      cancel("Login cancelled");
      process.exit(0);
    }
  }

  const spinner = yoctoSpinner({ text: "Requesting device authorization..." });
  spinner.start();

  try {
    // Request device code
    const { data, error } = await authClient.device.code({
      client_id: CLIENT_ID,
      scope: "openid profile email",
    });

    spinner.stop();

    if (error || !data) {
      console.error(
        `Failed to request device authorization: ${error?.error_description || "Unknown error"}`,
      );
      process.exit(1);
    }

    const {
      device_code,
      user_code,
      verification_uri,
      verification_uri_complete,
      interval = 5,
      expires_in,
    } = data;

    // Display authorization instructions
    console.log("");
    console.log(chalk.cyan("📱 Device Authorization Required"));
    console.log("");
    console.log("Login to your Mixedbread platform account, then:");
    console.log(
      `Please visit: ${chalk.underline.blue(verification_uri_complete)}`,
    );
    console.log(`Enter code: ${chalk.bold.green(user_code)}`);
    console.log("");

    // Ask if user wants to open browser
    const shouldOpen = await confirm({
      message: "Open browser automatically?",
      initialValue: true,
    });

    if (!isCancel(shouldOpen) && shouldOpen) {
      const urlToOpen = verification_uri_complete || verification_uri;
      await open(urlToOpen);
    }

    // Start polling
    console.log(
      chalk.gray(
        `Waiting for authorization (expires in ${Math.floor(expires_in / 60)} minutes)...`,
      ),
    );

    const token = await pollForToken(
      authClient,
      device_code,
      CLIENT_ID,
      interval,
      expires_in,
    );

    if (token) {
      const selectedOrg = await selectOrganization(token.access_token);

      await storeToken(token);

      // Get user info
      const { data: session } = await authClient.getSession({
        fetchOptions: {
          headers: {
            Authorization: `Bearer ${token.access_token}`,
          },
        },
      });

      const userIdentifier = session?.user?.name || session?.user?.email;

      outro(
        chalk.green(
          `✅ Mixedbread platform login successful!${userIdentifier ? ` Logged in as ${chalk.bold(userIdentifier)}` : ""}${selectedOrg ? ` (${chalk.bold(selectedOrg.name)})` : ""}.`,
        ),
      );
    }
  } catch (err) {
    spinner.stop();
    console.error(`${err instanceof Error ? err.message : "Unknown error"}`);
    process.exit(1);
  }
}

export const login = new Command("login")
  .description("Login to the Mixedbread platform")
  .action(loginAction);
