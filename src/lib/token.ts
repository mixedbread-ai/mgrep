import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import yoctoSpinner from "yocto-spinner";
import { type AuthClient, SERVER_URL } from "./auth.js";

const CONFIG_DIR = path.join(os.homedir(), ".mgrep");
const TOKEN_FILE = path.join(CONFIG_DIR, "token.json");

export async function pollForToken(
  authClient: AuthClient,
  deviceCode: string,
  clientId: string,
  initialInterval: number,
  expiresIn: number,
): Promise<TokenData> {
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
              "user-agent": "mgrep",
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

export async function storeToken(token: TokenData) {
  try {
    // Ensure config directory exists
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    // Store token with metadata
    const tokenData = {
      access_token: token.access_token,
      token_type: token.token_type || "Bearer",
      scope: token.scope,
      expires_in: token.expires_in,
      created_at: new Date().toISOString(),
    };

    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokenData, null, 2), "utf-8");
  } catch (_error) {
    console.warn("Failed to store authentication token locally");
  }
}

interface TokenData {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
}

/**
 * Checks if a token is expiring within 3 days
 */
function isTokenExpiringSoon(
  token: TokenData & { created_at: string },
): boolean {
  const createdAt = new Date(token.created_at).getTime();
  const expiresAt = createdAt + token.expires_in * 1000;
  const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
  return expiresAt - Date.now() < threeDaysInMs;
}

/**
 * Refreshes an expiring token by calling the refresh endpoint
 */
async function refreshToken(currentToken: string): Promise<TokenData> {
  const response = await fetch(`${SERVER_URL}/api/refresh-device-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${currentToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to refresh token");
  }

  return await response.json();
}

export async function getStoredToken(): Promise<
  (TokenData & { created_at: string }) | null
> {
  try {
    const data = await fs.readFile(TOKEN_FILE, "utf-8");
    const token = JSON.parse(data);

    // Check if token is expiring within 3 days and refresh if needed
    if (isTokenExpiringSoon(token)) {
      try {
        const refreshedToken = await refreshToken(token.access_token);
        await storeToken(refreshedToken);
        return { ...refreshedToken, created_at: new Date().toISOString() };
      } catch (error) {
        console.warn(
          "Failed to refresh token:",
          error instanceof Error ? error.message : "Unknown error",
        );
        return token;
      }
    }

    return token;
  } catch {
    return null;
  }
}

export async function deleteToken() {
  try {
    await fs.unlink(TOKEN_FILE);
  } catch (error) {
    // Ignore error if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
