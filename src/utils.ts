import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { cancel, confirm, isCancel } from "@clack/prompts";
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
 * Reads stdin if data is available (non-blocking check + read)
 * Returns null if stdin is a TTY or no data is available
 */
export async function tryReadStdin(): Promise<Buffer | null> {
  // If stdin is a TTY (interactive terminal), no piped data
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: Buffer[] = [];

  return new Promise((resolve) => {
    // Set a short timeout to check if data is available
    // If no data arrives quickly, assume no stdin data
    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners();
      process.stdin.pause();
      if (chunks.length === 0) {
        resolve(null);
      } else {
        resolve(Buffer.concat(chunks));
      }
    }, 100);

    process.stdin.on("data", (chunk) => {
      clearTimeout(timeout);
      chunks.push(Buffer.from(chunk));
    });

    process.stdin.on("end", () => {
      clearTimeout(timeout);
      if (chunks.length === 0) {
        resolve(null);
      } else {
        resolve(Buffer.concat(chunks));
      }
    });

    process.stdin.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });

    // Start reading
    process.stdin.resume();
  });
}

/**
 * Uploads a buffer directly to the store
 */
export async function uploadBuffer(
  store: Store,
  storeId: string,
  buffer: Buffer,
  externalId: string,
): Promise<boolean> {
  if (buffer.length === 0) {
    return false;
  }

  const hash = computeBufferHash(buffer);
  const options = {
    external_id: externalId,
    overwrite: true,
    metadata: {
      path: externalId,
      hash,
    },
  };

  await store.uploadFile(
    storeId,
    new File([new Uint8Array(buffer)], "stdin.txt", { type: "text/plain" }),
    options,
  );
  return true;
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

export function isDevelopment(): boolean {
  if (process.env.NODE_ENV === "development" || isTest) {
    return true;
  }

  return false;
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
