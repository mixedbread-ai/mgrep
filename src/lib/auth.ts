import { createAuthClient } from "better-auth/client";
import {
  deviceAuthorizationClient,
  organizationClient,
} from "better-auth/client/plugins";
import { getStoredToken } from "./token.js";
import { isDevelopment } from "./utils.js";

export const SERVER_URL = isDevelopment()
  ? "http://localhost:3001"
  : "https://www.platform.mixedbread.com";

export const authClient = createAuthClient({
  baseURL: SERVER_URL,
  plugins: [deviceAuthorizationClient(), organizationClient()],
});

export type AuthClient = typeof authClient;

/**
 * Gets the API key from environment variable or exchanges stored token for JWT
 */
export async function getJWTToken(): Promise<string> {
  // Check for API key in environment variable first
  const apiKey = process.env.MXBAI_API_KEY;
  if (apiKey) {
    return apiKey;
  }

  // Fall back to OAuth token exchange
  const token = await getStoredToken();
  if (!token) {
    throw new Error(
      "No authentication token found. Please run 'mgrep login' to authenticate or set MXBAI_API_KEY environment variable.",
    );
  }

  const response = await fetch(`${SERVER_URL}/api/auth/token`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      "Failed to get JWT token. You token might have expired. Please run 'mgrep login' to authenticate.",
    );
  }

  const data = await response.json();
  if (!data.token) {
    throw new Error(
      "Failed to get JWT token. You token might have expired. Please run 'mgrep login' to authenticate.",
    );
  }

  return data.token;
}
