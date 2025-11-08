import fs from "fs/promises";
import chalk from "chalk";
import path from "path";
import os from "os";
import yoctoSpinner from "yocto-spinner";

const CONFIG_DIR = path.join(os.homedir(), ".mgrep");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.json");

export async function pollForToken(
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
              "user-agent": `mgrep`,
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

export async function storeToken(token: any): Promise<void> {
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

interface TokenData {
  access_token: string;
  token_type: string;
  scope: string;
  created_at: string;
}

export async function getStoredToken(): Promise<TokenData | null> {
  try {
    const data = await fs.readFile(TOKEN_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function deleteToken(): Promise<void> {
  try {
    await fs.unlink(TOKEN_FILE);
  } catch (error) {
    // Ignore error if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
