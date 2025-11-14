import Mixedbread from "@mixedbread/sdk";
import { ensureAuthenticated, isDevelopment } from "../utils";
import { getJWTToken } from "./auth";
import { type Git, NodeGit } from "./git";
import { MixedbreadStore, type Store } from "./store";

const BASE_URL = isDevelopment()
  ? "http://localhost:8000"
  : "https://api.mixedbread.com";

/**
 * Creates an authenticated Store instance
 * Supports authentication via MIXEDBREAD_API_KEY env var or OAuth token
 */
export async function createStore(): Promise<Store> {
  await ensureAuthenticated();
  const jwtToken = await getJWTToken();
  const client = new Mixedbread({
    baseURL: BASE_URL,
    apiKey: jwtToken,
  });
  return new MixedbreadStore(client);
}

/**
 * Creates a Git instance
 */
export function createGit(): Git {
  return new NodeGit();
}
