import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { cancel, confirm, isCancel } from "@clack/prompts";
import chalk from "chalk";
import { isText } from "istextorbinary";
import pLimit from "p-limit";
import { loginAction } from "./commands/login";
import type { FileSystem } from "./lib/file";
import type { Store } from "./lib/store";
import type {
  InitialSyncProgress,
  InitialSyncResult,
} from "./lib/sync-helpers";

import { getStoredToken } from "./token";

export const isTest = process.env.MGREP_IS_TEST === "1";

/**
 * Returns true if the CLI should use development/local API endpoints.
 * Can be overridden with MGREP_ENV environment variable:
 * - MGREP_ENV=development: force development mode (localhost)
 * - MGREP_ENV=production: force production mode (platform.mixedbread.com)
 */
export function isDevelopment(): boolean {
  const envOverride = process.env.MGREP_ENV;
  if (envOverride === "production") {
    return false;
  }
  if (envOverride === "development") {
    return true;
  }

  // Check if running from node_modules (published package)
  if (__dirname.includes("node_modules")) {
    return false;
  }

  // Check if NODE_ENV is set to development
  if (process.env.NODE_ENV === "development" || isTest) {
    return true;
  }

  // Default to local if we can't determine
  return true;
}

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "ECONNREFUSED";
}

export function printConnectionErrorHint(serverUrl: string): void {
  const devMode = isDevelopment();
  console.error("");
  console.error(chalk.yellow(`isDevelopment: ${devMode}`));
  console.error(chalk.yellow(`Server URL: ${serverUrl}`));
  if (devMode) {
    console.error("");
    console.error(
      chalk.cyan(
        "Hint: Running in development mode, which connects to localhost.",
      ),
    );
    console.error(
      chalk.cyan("To use the production API, set MGREP_ENV=production:"),
    );
    console.error(chalk.gray("  MGREP_ENV=production mgrep <command>"));
  }
}

export function computeBufferHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function computeFileHash(
  filePath: string,
  readFileSyncFn: (p: string) => Buffer,
): string {
  const buffer = readFileSyncFn(filePath);
  return computeBufferHash(buffer);
}

export async function listStoreFileHashes(
  store: Store,
  storeId: string,
): Promise<Map<string, string | undefined>> {
  const byExternalId = new Map<string, string | undefined>();
  for await (const file of store.listFiles(storeId)) {
    const externalId = file.external_id ?? undefined;
    if (!externalId) continue;
    const metadata = file.metadata;
    const hash: string | undefined =
      metadata && typeof metadata.hash === "string" ? metadata.hash : undefined;
    byExternalId.set(externalId, hash);
  }
  return byExternalId;
}

export async function ensureAuthenticated(): Promise<void> {
  // Check if API key is set via environment variable
  if (process.env.MXBAI_API_KEY) {
    return;
  }

  // Check for stored OAuth token
  const token = await getStoredToken();
  if (token) {
    return;
  }

  const shouldLogin = await confirm({
    message: "You are not logged in. Would you like to login now?",
    initialValue: true,
  });

  if (isCancel(shouldLogin) || !shouldLogin) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  await loginAction();
}

export async function uploadFile(
  store: Store,
  storeId: string,
  filePath: string,
  fileName: string,
): Promise<boolean> {
  const buffer = await fs.promises.readFile(filePath);
  if (buffer.length === 0) {
    return false;
  }

  const hash = computeBufferHash(buffer);
  const options = {
    external_id: filePath,
    overwrite: true,
    metadata: {
      path: filePath,
      hash,
    },
  };

  try {
    await store.uploadFile(
      storeId,
      fs.createReadStream(filePath) as unknown as File | ReadableStream,
      options,
    );
  } catch (_err) {
    if (!isText(filePath)) {
      return false;
    }
    await store.uploadFile(
      storeId,
      new File([buffer], fileName, { type: "text/plain" }),
      options,
    );
  }
  return true;
}

export async function initialSync(
  store: Store,
  fileSystem: FileSystem,
  storeId: string,
  repoRoot: string,
  dryRun?: boolean,
  onProgress?: (info: InitialSyncProgress) => void,
): Promise<InitialSyncResult> {
  const storeHashes = await listStoreFileHashes(store, storeId);
  const allFiles = Array.from(fileSystem.getFiles(repoRoot));
  const repoFiles = allFiles.filter(
    (filePath) => !fileSystem.isIgnored(filePath, repoRoot),
  );
  const total = repoFiles.length;
  let processed = 0;
  let uploaded = 0;

  const concurrency = 100;
  const limit = pLimit(concurrency);

  await Promise.all(
    repoFiles.map((filePath) =>
      limit(async () => {
        try {
          const buffer = await fs.promises.readFile(filePath);
          const hash = computeBufferHash(buffer);
          const existingHash = storeHashes.get(filePath);
          processed += 1;
          const shouldUpload = !existingHash || existingHash !== hash;
          if (dryRun && shouldUpload) {
            console.log("Dry run: would have uploaded", filePath);
            uploaded += 1;
          } else if (shouldUpload) {
            const didUpload = await uploadFile(
              store,
              storeId,
              filePath,
              path.basename(filePath),
            );
            if (didUpload) {
              uploaded += 1;
            }
          }
          onProgress?.({ processed, uploaded, total, filePath });
        } catch (_err) {
          onProgress?.({ processed, uploaded, total, filePath });
        }
      }),
    ),
  );
  return { processed, uploaded, total };
}
