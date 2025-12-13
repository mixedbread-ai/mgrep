import Mixedbread from "@mixedbread/sdk";
import { getJWTToken } from "./auth.js";
import {
  type FileSystem,
  type FileSystemOptions,
  NodeFileSystem,
} from "./file.js";
import { type Git, NodeGit } from "./git.js";
import { MixedbreadStore, type Store, TestStore } from "./store.js";
import { ensureAuthenticated, isDevelopment, isTest } from "./utils.js";

const BASE_URL = isDevelopment()
  ? "http://localhost:8000"
  : "https://api.mixedbread.com";

/**
 * Creates an authenticated Store instance
 * Supports authentication via MXBAI_API_KEY env var or OAuth token
 */
export async function createStore(): Promise<Store> {
  if (isTest) {
    return new TestStore();
  }

  await ensureAuthenticated();

  async function createClient() {
    const jwtToken = await getJWTToken();
    return new Mixedbread({
      baseURL: BASE_URL,
      apiKey: jwtToken,
    });
  }

  const client = await createClient();
  return new MixedbreadStore(client, createClient);
}

/**
 * Creates a Git instance
 */
export function createGit(): Git {
  return new NodeGit();
}

/**
 * Creates a FileSystem instance
 */
export function createFileSystem(
  options: FileSystemOptions = { ignorePatterns: [] },
): FileSystem {
  return new NodeFileSystem(createGit(), options);
}
