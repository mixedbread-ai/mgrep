import { cancel, confirm, intro, isCancel, outro } from "@clack/prompts";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import chalk from "chalk";
import { Command } from "commander";
import fs from "fs/promises";
import open from "open";
import os from "os";
import path from "path";
import yoctoSpinner from "yocto-spinner";
import * as z from "zod";
import { isDevelopment } from "./utils";

const PLATFORM_URL = isDevelopment()
  ? "http://localhost:3001"
  : "https://www.platform.mixedbread.com";
const CLIENT_ID = "mgrep";
const CONFIG_DIR = path.join(os.homedir(), ".mgrep");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.json");

export async function loginAction(opts: any) {
  const options = z
    .object({
      serverUrl: z.string().optional(),
      clientId: z.string().optional(),
    })
    .parse(opts);

  const serverUrl = options.serverUrl || PLATFORM_URL;
  const clientId = options.clientId || CLIENT_ID;

  intro(chalk.bold("🔐 Mixedbread Login"));

  // Check if already logged in
  const existingToken = await getStoredToken();
  if (existingToken) {
    if (!isDevelopment()) {
      outro(chalk.blue("✅ You're already logged in"));
      process.exit(0);
    }

    const shouldReauth = await confirm({
      message: "You're already logged in. Do you want to log in again?",
      initialValue: false,
    });

    if (isCancel(shouldReauth) || !shouldReauth) {
      cancel("Login cancelled");
      process.exit(0);
    }
  }

  // Create the auth client
  const authClient = createAuthClient({
    baseURL: serverUrl,
    plugins: [deviceAuthorizationClient()],
  });

  const spinner = yoctoSpinner({ text: "Requesting device authorization..." });
  spinner.start();

  try {
    // Request device code
    const { data, error } = await authClient.device.code({
      client_id: clientId,
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
      `Please visit: ${chalk.underline.blue(`${verification_uri}?user_code=${user_code}`)}`,
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
      clientId,
      interval,
      expires_in,
    );

    if (token) {
      // Store the token
      await storeToken(token);

      // Get user info
      const { data: session } = await authClient.getSession({
        fetchOptions: {
          headers: {
            Authorization: `Bearer ${token.access_token}`,
          },
        },
      });

      outro(
        chalk.green(
          `✅ Mixedbread platform login successful! Logged in as ${session?.user?.name || session?.user?.email || "User"}`,
        ),
      );
    }
  } catch (err) {
    spinner.stop();
    console.error(`${err instanceof Error ? err.message : "Unknown error"}`);
    process.exit(1);
  }
}

async function pollForToken(
  authClient: any,
  deviceCode: string,
  clientId: string,
  initialInterval: number,
  expiresIn: number,
): Promise<any> {
  let pollingInterval = initialInterval;
  const spinner = yoctoSpinner({ text: "", color: "cyan" });
  let dots = 0;

  return new Promise((resolve, reject) => {
    let pollTimeout: NodeJS.Timeout | null = null;
    let expirationTimeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (pollTimeout) clearTimeout(pollTimeout);
      if (expirationTimeout) clearTimeout(expirationTimeout);
      spinner.stop();
    };

    // Set up expiration timeout
    expirationTimeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Device code has expired. Please run the login command again.",
        ),
      );
    }, expiresIn * 1000);

    const poll = async () => {
      // Update spinner text with animated dots
      dots = (dots + 1) % 4;
      spinner.text = chalk.gray(
        `Polling for authorization${".".repeat(dots)}${" ".repeat(3 - dots)}`,
      );
      if (!spinner.isSpinning) spinner.start();

      try {
        const { data, error } = await authClient.device.token({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientId,
          fetchOptions: {
            headers: {
              "user-agent": `Mgrep`,
            },
          },
        });

        if (data?.access_token) {
          cleanup();
          resolve(data);
          return;
        } else if (error) {
          switch (error.error) {
            case "authorization_pending":
              // Continue polling
              break;
            case "slow_down":
              pollingInterval += 5;
              spinner.text = chalk.yellow(
                `Slowing down polling to ${pollingInterval}s`,
              );
              break;
            case "access_denied":
              cleanup();
              reject(new Error("Access was denied by the user"));
              return;
            case "expired_token":
              cleanup();
              reject(
                new Error("The device code has expired. Please try again."),
              );
              return;
            default:
              cleanup();
              reject(new Error(error.error_description || "Unknown error"));
              return;
          }
        }
      } catch (err) {
        cleanup();
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        reject(new Error(`Network error: ${errorMessage}`));
        return;
      }

      pollTimeout = setTimeout(poll, pollingInterval * 1000);
    };

    // Start polling after initial interval
    pollTimeout = setTimeout(poll, pollingInterval * 1000);
  });
}

async function storeToken(token: any): Promise<void> {
  try {
    // Ensure config directory exists
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    // Store token with metadata
    const tokenData = {
      access_token: token.access_token,
      token_type: token.token_type || "Bearer",
      scope: token.scope,
      created_at: new Date().toISOString(),
    };

    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokenData, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to store authentication token locally");
  }
}

async function getStoredToken(): Promise<any> {
  try {
    const data = await fs.readFile(TOKEN_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export const login = new Command("login")
  .description("Login to the Mixedbread platform")
  .option("--server-url <url>", "The Mixedbread platform URL", PLATFORM_URL)
  .option("--client-id <id>", "The OAuth client ID", CLIENT_ID)
  .action(loginAction);
