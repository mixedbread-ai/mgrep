import { createAuthClient } from "better-auth/client";
import { isDevelopment } from "../utils";
import { deviceAuthorizationClient } from "better-auth/plugins";
import { getStoredToken } from "../token";

const SERVER_URL = isDevelopment()
  ? "http://localhost:3001"
  : "https://www.platform.mixedbread.com";

export const authClient = createAuthClient({
  baseURL: SERVER_URL,
  plugins: [deviceAuthorizationClient()],
});

export async function getJWTToken(): Promise<string> {
  const token = await getStoredToken();

  const response = await fetch(`${SERVER_URL}/api/auth/token`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  if (!response.ok) {
    throw new Error("Failed to get JWT token");
  }

  const data = await response.json();
  if (!data.token) {
    throw new Error("Failed to get JWT token");
  }

  return data.token;
}
