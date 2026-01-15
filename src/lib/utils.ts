import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cancel, confirm, isCancel } from "@clack/prompts";
import { isText } from "istextorbinary";
import pLimit from "p-limit";
import xxhashWasm from "xxhash-wasm";
import { loginAction } from "../commands/login.js";
import { exceedsMaxFileSize, type MgrepConfig } from "./config.js";
import type { FileSystem } from "./file.js";
import type { Store } from "./store.js";
import type { InitialSyncProgress, InitialSyncResult } from "./sync-helpers.js";

import { getStoredToken } from "./token.js";

export const isTest = process.env.MGREP_IS_TEST === "1";

/** Error thrown when the free tier quota is exceeded */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/** Error thrown when the file count to sync exceeds the configured limit */
export class MaxFileCountExceededError extends Error {
  constructor(filesToSync: number, maxFileCount: number) {
    super(
      `Files to sync (${filesToSync}) exceeds the maximum allowed (${maxFileCount}). No files were synced.`,
    );
    this.name = "MaxFileCountExceededError";
  }
}

/** Check if an error message indicates a quota issue */
function isQuotaError(errorMessage: string): boolean {
  return (
    errorMessage.includes("Free tier") ||
    errorMessage.includes("quota") ||
    errorMessage.includes("Upgrade your plan")
  );
}

function isSubpath(parent: string, child: string): boolean {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);

  const parentWithSep = parentPath.endsWith(path.sep)
    ? parentPath
    : parentPath + path.sep;

  return childPath.startsWith(parentWithSep);
}

/**
 * Checks if a path is at or above the home directory.
 * Returns true if the path is the home directory, a parent of it, or the root.
 *
 * @param targetPath - The path to check
 * @returns true if the path is at or above home directory, false if it's a subdirectory of home
 */
export function isAtOrAboveHomeDirectory(targetPath: string): boolean {
  const homeDir = os.homedir();
  const resolvedTarget = path.resolve(targetPath);
  const resolvedHome = path.resolve(homeDir);

  if (resolvedTarget === resolvedHome) {
    return true;
  }

  const targetWithSep = resolvedTarget.endsWith(path.sep)
    ? resolvedTarget
    : resolvedTarget + path.sep;

  if (resolvedHome.startsWith(targetWithSep)) {
    return true;
  }

  return false;
}

const XXHASH_PREFIX = "xxh64:";

/** Lazily initialized xxhash instance */
const xxhashPromise = xxhashWasm();

/**
 * Computes SHA-256 hash of a buffer (used for backward compatibility)
 */
function computeSha256Hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Computes xxhash64 hash of a buffer.
 * Returns the hash prefixed with "xxh64:" to identify the algorithm.
 */
export async function computeBufferHash(buffer: Buffer): Promise<string> {
  const { h64Raw } = await xxhashPromise;
  const hash = h64Raw(new Uint8Array(buffer)).toString(16).padStart(16, "0");
  return XXHASH_PREFIX + hash;
}

/**
 * Computes a hash of the file using xxhash64.
 */
export async function computeFileHash(
  filePath: string,
  readFileSyncFn: (p: string) => Buffer,
): Promise<string> {
  const buffer = readFileSyncFn(filePath);
  return computeBufferHash(buffer);
}

/**
 * Checks if a stored hash matches the computed hash of a buffer.
 * Supports both old SHA-256 hashes (no prefix) and new xxhash64 hashes (xxh64: prefix).
 */
export async function hashesMatch(
  storedHash: string,
  buffer: Buffer,
): Promise<boolean> {
  if (storedHash.startsWith(XXHASH_PREFIX)) {
    const computedHash = await computeBufferHash(buffer);
    return storedHash === computedHash;
  }
  const computedSha256 = computeSha256Hash(buffer);
  return storedHash === computedSha256;
}

export function isDevelopment(): boolean {
  if (process.env.NODE_ENV === "development" || isTest) {
    return true;
  }

  return false;
}

/** Metadata stored for each file in the store */
export interface StoredFileMetadata {
  hash?: string;
  mtime?: number;
}

/**
 * Lists file metadata from the store, optionally filtered by path prefix.
 *
 * @param store - The store instance
 * @param storeId - The ID of the store
 * @param pathPrefix - Optional path prefix to filter files (only files starting with this path are returned)
 * @returns A map of external IDs to their metadata (hash and mtime)
 */
export async function listStoreFileMetadata(
  store: Store,
  storeId: string,
  pathPrefix?: string,
): Promise<Map<string, StoredFileMetadata>> {
  const byExternalId = new Map<string, StoredFileMetadata>();
  for await (const file of store.listFiles(storeId, { pathPrefix })) {
    const externalId = file.external_id ?? undefined;
    if (!externalId) continue;
    const metadata = file.metadata;
    const hash: string | undefined =
      metadata && typeof metadata.hash === "string" ? metadata.hash : undefined;
    const mtime: number | undefined =
      metadata && typeof metadata.mtime === "number"
        ? metadata.mtime
        : undefined;
    byExternalId.set(externalId, { hash, mtime });
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

/**
 * Converts an absolute file path to a relative path from the project root.
 * Used in shared mode to store files with relative paths.
 *
 * @param absolutePath - The absolute file path
 * @param projectRoot - The project root directory
 * @returns The relative path from the project root
 */
export function toRelativePath(
  absolutePath: string,
  projectRoot: string,
): string {
  const relative = path.relative(projectRoot, absolutePath);
  // Ensure consistent forward slashes for cross-platform compatibility
  return relative.split(path.sep).join("/");
}

/**
 * Converts a relative path to an absolute path using the project root.
 *
 * @param relativePath - The relative file path (may use forward slashes)
 * @param projectRoot - The project root directory
 * @returns The absolute path
 */
export function toAbsolutePath(
  relativePath: string,
  projectRoot: string,
): string {
  // Handle forward slashes from stored paths
  const normalizedRelative = relativePath.split("/").join(path.sep);
  return path.join(projectRoot, normalizedRelative);
}

/**
 * Gets the storage path for a file based on whether shared mode is enabled.
 *
 * @param absolutePath - The absolute file path on disk
 * @param projectRoot - The project root directory
 * @param shared - Whether shared mode is enabled
 * @returns The path to use for storage (relative if shared, absolute otherwise)
 */
export function getStoragePath(
  absolutePath: string,
  projectRoot: string,
  shared: boolean,
): string {
  return shared ? toRelativePath(absolutePath, projectRoot) : absolutePath;
}

export async function deleteFile(
  store: Store,
  storeId: string,
  filePath: string,
): Promise<void> {
  await store.deleteFile(storeId, filePath);
}

/**
 * Uploads a file to the store.
 *
 * @param store - The store instance
 * @param storeId - The ID of the store
 * @param filePath - The absolute path to the file on disk
 * @param fileName - The file name for display
 * @param projectRoot - The project root directory (used for path storage)
 * @param config - Optional configuration
 * @returns True if the file was uploaded, false if skipped
 */
export async function uploadFile(
  store: Store,
  storeId: string,
  filePath: string,
  fileName: string,
  projectRoot: string,
  config?: MgrepConfig,
): Promise<boolean> {
  if (config && exceedsMaxFileSize(filePath, config.maxFileSize)) {
    return false;
  }

  const [buffer, stat] = await Promise.all([
    fs.promises.readFile(filePath),
    fs.promises.stat(filePath),
  ]);
  if (buffer.length === 0) {
    return false;
  }

  const hash = await computeBufferHash(buffer);

  // Use relative paths in shared mode, absolute paths otherwise
  const storagePath = getStoragePath(
    filePath,
    projectRoot,
    config?.shared ?? false,
  );

  const options = {
    external_id: storagePath,
    overwrite: true,
    metadata: {
      path: storagePath,
      hash,
      mtime: stat.mtimeMs,
    },
  };

  try {
    await store.uploadFile(
      storeId,
      fs.createReadStream(filePath) as unknown as File | ReadableStream,
      options,
    );
  } catch (streamErr) {
    const streamErrMsg =
      streamErr instanceof Error ? streamErr.message : String(streamErr);

    // Check for quota errors and throw immediately to stop processing
    if (isQuotaError(streamErrMsg)) {
      throw new QuotaExceededError(streamErrMsg);
    }

    if (!isText(filePath)) {
      return false;
    }
    try {
      await store.uploadFile(
        storeId,
        new File([buffer], fileName, { type: "text/plain" }),
        options,
      );
    } catch (fileErr) {
      const fileErrMsg =
        fileErr instanceof Error ? fileErr.message : String(fileErr);

      // Check for quota errors and throw immediately to stop processing
      if (isQuotaError(fileErrMsg)) {
        throw new QuotaExceededError(fileErrMsg);
      }

      throw fileErr;
    }
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
  config?: MgrepConfig,
): Promise<InitialSyncResult> {
  const shared = config?.shared ?? false;

  // In shared mode, files are stored with relative paths, so we don't filter by path prefix
  // In normal mode, we filter by absolute path prefix
  const pathPrefix = shared ? undefined : repoRoot;
  const storeMetadata = await listStoreFileMetadata(store, storeId, pathPrefix);
  const allFiles = Array.from(fileSystem.getFiles(repoRoot));
  const repoFiles = allFiles.filter(
    (filePath) => !fileSystem.isIgnored(filePath, repoRoot),
  );

  // Build a set of storage paths for comparison
  const repoStoragePaths = new Set(
    repoFiles.map((filePath) => getStoragePath(filePath, repoRoot, shared)),
  );

  // Find files to delete - files in store but not in repo
  const filesToDelete = Array.from(storeMetadata.keys()).filter((storagePath) => {
    if (shared) {
      return !repoStoragePaths.has(storagePath);
    }
    return isSubpath(repoRoot, storagePath) && !repoStoragePaths.has(storagePath);
  });

  // Check files that potentially need uploading (new or modified)
  const filesToPotentiallyUpload = repoFiles.filter((filePath) => {
    if (config && exceedsMaxFileSize(filePath, config.maxFileSize)) {
      return false;
    }
    const storagePath = getStoragePath(filePath, repoRoot, shared);
    const stored = storeMetadata.get(storagePath);
    if (!stored) {
      return true;
    }
    if (!stored.mtime) {
      return true;
    }
    try {
      const stat = fs.statSync(filePath);
      return stat.mtimeMs > stored.mtime;
    } catch {
      return true;
    }
  });

  const filesToSync = filesToPotentiallyUpload.length + filesToDelete.length;
  if (config && filesToSync > config.maxFileCount) {
    throw new MaxFileCountExceededError(filesToSync, config.maxFileCount);
  }

  const total = repoFiles.length + filesToDelete.length;
  let processed = 0;
  let uploaded = 0;
  let deleted = 0;
  let errors = 0;
  let quotaExceeded = false;
  let quotaErrorMessage = "";

  const concurrency = 100;
  const limit = pLimit(concurrency);

  await Promise.all([
    ...repoFiles.map((filePath) =>
      limit(async () => {
        // Skip if quota exceeded
        if (quotaExceeded) {
          processed += 1;
          return;
        }

        try {
          if (config && exceedsMaxFileSize(filePath, config.maxFileSize)) {
            processed += 1;
            onProgress?.({
              processed,
              uploaded,
              deleted,
              errors,
              total,
              filePath,
            });
            return;
          }

          const storagePath = getStoragePath(filePath, repoRoot, shared);
          const stored = storeMetadata.get(storagePath);
          const stat = await fs.promises.stat(filePath);

          // Bloom filter: if mtime unchanged, file definitely unchanged
          if (stored?.mtime && stat.mtimeMs <= stored.mtime) {
            processed += 1;
            onProgress?.({
              processed,
              uploaded,
              deleted,
              errors,
              total,
              filePath,
            });
            return;
          }

          // mtime changed or no stored mtime - need to check hash
          const buffer = await fs.promises.readFile(filePath);
          processed += 1;
          const hashMatches = stored?.hash
            ? await hashesMatch(stored.hash, buffer)
            : false;
          const shouldUpload = !hashMatches;
          if (dryRun && shouldUpload) {
            console.log("Dry run: would have uploaded", filePath);
            uploaded += 1;
          } else if (shouldUpload) {
            const didUpload = await uploadFile(
              store,
              storeId,
              filePath,
              path.basename(filePath),
              repoRoot,
              config,
            );
            if (didUpload) {
              uploaded += 1;
            }
          }
          onProgress?.({
            processed,
            uploaded,
            deleted,
            errors,
            total,
            filePath,
          });
        } catch (err) {
          // Check if quota exceeded
          if (err instanceof QuotaExceededError) {
            quotaExceeded = true;
            quotaErrorMessage = err.message;
            onProgress?.({
              processed,
              uploaded,
              deleted,
              errors,
              total,
              filePath,
              lastError: quotaErrorMessage,
            });
            return;
          }

          errors += 1;
          const errorMessage = err instanceof Error ? err.message : String(err);
          onProgress?.({
            processed,
            uploaded,
            deleted,
            errors,
            total,
            filePath,
            lastError: errorMessage,
          });
        }
      }),
    ),
    ...filesToDelete.map((filePath) =>
      limit(async () => {
        // Skip if quota exceeded
        if (quotaExceeded) {
          processed += 1;
          return;
        }

        try {
          if (dryRun) {
            console.log("Dry run: would have deleted", filePath);
          } else {
            await store.deleteFile(storeId, filePath);
          }
          deleted += 1;
          processed += 1;
          onProgress?.({
            processed,
            uploaded,
            deleted,
            errors,
            total,
            filePath,
          });
        } catch (err) {
          processed += 1;
          errors += 1;
          const errorMessage = err instanceof Error ? err.message : String(err);
          onProgress?.({
            processed,
            uploaded,
            deleted,
            errors,
            total,
            filePath,
            lastError: errorMessage,
          });
        }
      }),
    ),
  ]);

  // If quota was exceeded, throw the error after cleanup
  if (quotaExceeded) {
    throw new QuotaExceededError(quotaErrorMessage);
  }

  return { processed, uploaded, deleted, errors, total };
}
