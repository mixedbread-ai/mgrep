import * as fs from "node:fs";
import * as path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import {
  type CliConfigOptions,
  hasLocalConfig,
  loadConfig,
} from "../lib/config.js";
import { createFileSystem, createStore } from "../lib/context.js";
import { DEFAULT_IGNORE_PATTERNS } from "../lib/file.js";
import {
  claimWatch,
  ensureClaim,
  findCoveringWatch,
  listActiveWatches,
  releaseWatch,
  type WatchClaim,
} from "../lib/lock.js";
import type { Store } from "../lib/store.js";
import {
  createIndexingSpinner,
  formatDryRunSummary,
} from "../lib/sync-helpers.js";
import {
  deleteFile,
  initialSync,
  isAtOrAboveHomeDirectory,
  isSubpath,
  MaxFileCountExceededError,
  QuotaExceededError,
  uploadFile,
} from "../lib/utils.js";

export interface WatchOptions {
  store: string;
  dryRun: boolean;
  maxFileSize?: number;
  maxFileCount?: number;
  createStore?: () => Promise<Store>;
  handleSignals?: boolean;
}

/**
 * Starts a watcher, standing by while an earlier session covers its directory.
 * @param options - Store, dry-run mode, file limits, store factory, and signal handling
 * @returns True when covered by another watcher or after initial sync and watcher
 * setup, regardless of per-file errors; false for dry runs or startup failures
 */
export async function startWatch(options: WatchOptions): Promise<boolean> {
  let refreshInterval: NodeJS.Timeout | undefined;
  let coordinationInterval: NodeJS.Timeout | undefined;
  let claim: WatchClaim | null = null;
  const watchers = new Map<string, fs.FSWatcher>();

  let stopped = false;
  const cleanup = (): void => {
    stopped = true;
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (refreshInterval) clearInterval(refreshInterval);
    if (coordinationInterval) clearInterval(coordinationInterval);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    if (claim) {
      releaseWatch(claim);
      claim = null;
    }
  };
  const stop = (): void => {
    cleanup();
    process.exit(0);
  };

  try {
    const watchRoot = fs.realpathSync(process.cwd());
    if (isAtOrAboveHomeDirectory(watchRoot)) {
      console.error(
        "Error: Cannot watch home directory or any parent directory.",
      );
      console.error(
        "Please run this command from within a specific project subdirectory.",
      );
      process.exitCode = 1;
      return false;
    }

    const mine = { startedAt: Date.now(), pid: process.pid };
    const configuredPollMs = Number(process.env.MGREP_WATCH_POLL_MS ?? 5000);
    const pollMs =
      Number.isFinite(configuredPollMs) && configuredPollMs > 0
        ? configuredPollMs
        : 5000;

    let loggedStandby = false;
    function acquireClaim(): boolean {
      if (stopped) return false;
      const claims = listActiveWatches(options.store);
      let owner = findCoveringWatch(watchRoot, mine, claims);
      if (!owner) {
        claim = claimWatch(options.store, watchRoot, mine.startedAt);
        if (claim) {
          // A competing ancestor may have published between listing and claiming.
          owner = findCoveringWatch(
            watchRoot,
            mine,
            listActiveWatches(options.store),
          );
          if (!owner) {
            loggedStandby = false;
            return true;
          }
          releaseWatch(claim);
          claim = null;
        }
      }
      owner ??= claims.find((entry) => entry.root === watchRoot);
      if (owner && !loggedStandby) {
        console.log(
          `Covered by mgrep watch (pid ${owner.pid}) for ${owner.root}; standing by`,
        );
        loggedStandby = true;
      }
      return false;
    }

    let active = options.dryRun;
    if (!options.dryRun) {
      process.on("exit", cleanup);
      if (options.handleSignals !== false) {
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      }
      active = acquireClaim();
    }

    let store: Store;
    let config: ReturnType<typeof loadConfig>;
    async function prepare(): Promise<void> {
      if (store) return;
      const nextStore = await (options.createStore ?? createStore)();
      if (stopped) return;
      config = loadConfig(watchRoot, {
        maxFileSize: options.maxFileSize,
        maxFileCount: options.maxFileCount,
      } satisfies CliConfigOptions);
      store = nextStore;
      console.debug("Watching for file changes in", watchRoot);
      if (!options.dryRun) {
        const REFRESH_INTERVAL = 5 * 60 * 1000;
        refreshInterval = setInterval(async () => {
          try {
            await store.refreshClient?.();
          } catch (err) {
            console.error(
              "Failed to refresh JWT token:",
              err instanceof Error ? err.message : "Unknown error",
            );
          }
        }, REFRESH_INTERVAL);
        refreshInterval.unref();
      }
    }

    const fileSystem = createFileSystem({
      ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
    });
    let boundaryRoots: string[] = [];
    let excludedRoots: string[] = [];
    const configuredQuotaBackoffMs = Number(
      process.env.MGREP_WATCH_QUOTA_BACKOFF_MS ?? 600000,
    );
    const QUOTA_BACKOFF_MS =
      Number.isSafeInteger(configuredQuotaBackoffMs) &&
      configuredQuotaBackoffMs > 0
        ? configuredQuotaBackoffMs
        : 600000;
    let quotaRetryAt = 0;
    let quotaReported = false;

    function collectBoundaries(dir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        console.warn(`Warning: failed to read directory ${dir}:`, error);
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const childPath = path.join(dir, entry.name);
        let child: string;
        try {
          child = fs.realpathSync(childPath);
        } catch (error) {
          console.warn(`Warning: failed to inspect path ${childPath}:`, error);
          continue;
        }
        if (fileSystem.isIgnored(child, watchRoot)) continue;
        if (hasLocalConfig(child)) boundaryRoots.push(child);
        collectBoundaries(child);
      }
    }

    function getExcludedRoots(claims: WatchClaim[]): string[] {
      return [
        ...new Set([
          ...boundaryRoots,
          ...claims
            .filter(
              (entry) =>
                entry.pid !== mine.pid &&
                (entry.startedAt < mine.startedAt ||
                  (entry.startedAt === mine.startedAt &&
                    entry.pid < mine.pid)) &&
                isSubpath(watchRoot, entry.root),
            )
            .map((entry) => entry.root),
        ]),
      ];
    }

    function isExcluded(filePath: string): boolean {
      let realPath = filePath;
      try {
        realPath = fs.realpathSync(filePath);
      } catch {
        // A deleted path retains its canonical parent watcher path.
      }
      return excludedRoots.some(
        (root) => realPath === root || isSubpath(root, realPath),
      );
    }

    function computeBoundaries(): void {
      boundaryRoots = [];
      collectBoundaries(watchRoot);
      excludedRoots = getExcludedRoots(listActiveWatches(options.store));
    }
    async function sync(): Promise<void> {
      await prepare();
      if (stopped) return;
      const { spinner, onProgress } = createIndexingSpinner(watchRoot);
      try {
        try {
          await store.retrieve(options.store);
        } catch {
          await store.create({
            name: options.store,
            description:
              "mgrep store - Mixedbreads multimodal multilingual magic search",
          });
        }
        const result = await initialSync(
          store,
          fileSystem,
          options.store,
          watchRoot,
          options.dryRun,
          onProgress,
          config,
          excludedRoots,
        );
        const deletedInfo =
          result.deleted > 0 ? ` • deleted ${result.deleted}` : "";
        const errorsInfo =
          result.errors > 0 ? ` • errors ${result.errors}` : "";
        if (result.errors > 0) {
          spinner.warn(
            `Initial sync complete (${result.processed}/${result.total}) • uploaded ${result.uploaded}${deletedInfo}${errorsInfo}`,
          );
          console.error(
            `\n⚠️  ${result.errors} file(s) failed to upload. Run with DEBUG=mgrep* for more details.`,
          );
        } else {
          spinner.succeed(
            `Initial sync complete (${result.processed}/${result.total}) • uploaded ${result.uploaded}${deletedInfo}`,
          );
        }
        if (options.dryRun) {
          console.log(
            formatDryRunSummary(result, {
              actionDescription: "found",
              includeTotal: true,
            }),
          );
          return;
        }
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          spinner.fail("Quota exceeded");
          if (!quotaReported) {
            console.error(
              "\n❌ Free tier quota exceeded. You've reached the monthly limit of 2,000,000 store tokens.",
            );
            console.error(
              "   Upgrade your plan at https://platform.mixedbread.com to continue syncing.\n",
            );
          }
          throw e;
        }
        if (e instanceof MaxFileCountExceededError) {
          spinner.fail("File count exceeded");
          console.error(`\n❌ ${e.message}`);
          console.error(
            "   Increase the limit with --max-file-count or MGREP_MAX_FILE_COUNT environment variable.\n",
          );
          throw e;
        }
        spinner.fail("Initial upload failed");
        throw e;
      }
    }

    let watchSetupSucceeded = true;

    // Per-directory watchers avoid allocating handles for ignored subtrees.
    function isMissingPathError(error: unknown): boolean {
      return (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      );
    }

    function getPathStats(filePath: string): fs.Stats | null | undefined {
      try {
        return fs.statSync(filePath);
      } catch (error) {
        if (isMissingPathError(error)) {
          return null;
        }

        watchSetupSucceeded = false;
        console.warn(`Warning: failed to inspect path ${filePath}:`, error);
        return undefined;
      }
    }

    function closeWatcher(dirPath: string): void {
      const watcher = watchers.get(dirPath);
      if (!watcher) {
        return;
      }

      watcher.close();
      watchers.delete(dirPath);
    }

    function closeWatcherSubtree(dirPath: string): void {
      const prefix = `${dirPath}${path.sep}`;

      for (const watchedPath of Array.from(watchers.keys())) {
        if (watchedPath === dirPath || watchedPath.startsWith(prefix)) {
          closeWatcher(watchedPath);
        }
      }
    }

    function handleDeletion(filePath: string): void {
      closeWatcherSubtree(filePath);

      void deleteFile(store, options.store, filePath)
        .then(() => {
          console.log(`delete: ${filePath}`);
        })
        .catch((error) => {
          console.error("Failed to delete file:", filePath, error);
        });
    }

    function handleFileEvent(
      eventType: fs.WatchEventType,
      dirPath: string,
      name: string,
    ): void {
      const filePath = path.join(dirPath, name);

      if (isExcluded(filePath) || fileSystem.isIgnored(filePath, watchRoot)) {
        return;
      }

      const stats = getPathStats(filePath);
      if (stats === undefined) {
        return;
      }

      if (stats === null) {
        handleDeletion(filePath);
        return;
      }

      if (stats.isDirectory()) {
        watchDirectory(filePath);
        return;
      }

      if (!stats.isFile()) {
        return;
      }

      void uploadFile(
        store,
        options.store,
        filePath,
        path.basename(filePath),
        config,
      )
        .then((didUpload) => {
          if (didUpload) {
            console.log(`${eventType}: ${filePath}`);
          }
        })
        .catch((error) => {
          console.error("Failed to upload changed file:", filePath, error);
        });
    }

    function watchDirectory(dirPath: string): void {
      if (stopped) return;
      if (isExcluded(dirPath) || watchers.has(dirPath)) {
        return;
      }

      if (dirPath !== watchRoot && fileSystem.isIgnored(dirPath, watchRoot)) {
        return;
      }

      const stats = getPathStats(dirPath);
      if (!stats?.isDirectory()) {
        return;
      }

      try {
        const watcher = fs.watch(dirPath, (eventType, rawFilename) => {
          const name = rawFilename?.toString();
          if (!name) {
            return;
          }

          handleFileEvent(eventType, dirPath, name);
        });
        watcher.on("error", (error: Error) => {
          watchSetupSucceeded = false;
          console.error(`Failed to watch ${dirPath}:`, error);
          closeWatcher(dirPath);
        });
        watchers.set(dirPath, watcher);
      } catch (error) {
        watchSetupSucceeded = false;
        console.warn(`Warning: failed to watch ${dirPath}:`, error);
        return;
      }

      try {
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
          if (!entry.isDirectory()) {
            continue;
          }

          watchDirectory(path.join(dirPath, entry.name));
        }
      } catch (error) {
        watchSetupSucceeded = false;
        console.warn(`Warning: failed to read directory ${dirPath}:`, error);
      }
    }

    if (active) {
      if (!options.dryRun) computeBoundaries();
      await sync();
      if (options.dryRun || stopped) return false;
      console.log("Watching for file changes in", watchRoot);
      fileSystem.loadMgrepignore(watchRoot);
      watchDirectory(watchRoot);
      // fs.watch can report startup failures asynchronously.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!watchSetupSucceeded || !watchers.has(watchRoot)) {
        cleanup();
        return false;
      }
    }
    let polling = false;
    let needsBoundaries = !active;
    let needsResync = !active;
    const releasedRoots = new Set<string>();
    coordinationInterval = setInterval(() => {
      if (stopped || polling) return;
      polling = true;
      void poll()
        .catch((error: unknown) => {
          console.error(
            "Failed to coordinate watcher:",
            error instanceof Error ? error.message : "Unknown error",
          );
        })
        .finally(() => {
          polling = false;
        });
    }, pollMs);

    async function poll(): Promise<void> {
      if (stopped) return;
      if (!claim && !acquireClaim()) return;
      if (!claim) return;
      ensureClaim(claim);
      let claims = listActiveWatches(options.store);
      const covering = findCoveringWatch(watchRoot, mine, claims);
      const otherOwner = claims.find(
        (entry) => entry.root === watchRoot && entry.pid !== mine.pid,
      );
      if (covering || otherOwner) {
        needsBoundaries = true;
        needsResync = true;
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
        releaseWatch(claim);
        claim = null;
        if (!acquireClaim()) return;
      }
      if (needsBoundaries) {
        computeBoundaries();
        needsBoundaries = false;
        claims = listActiveWatches(options.store);
      }
      const nextExcluded = getExcludedRoots(claims);
      const removed = excludedRoots.filter(
        (root) => !nextExcluded.includes(root),
      );
      excludedRoots = nextExcluded;
      for (const root of excludedRoots) closeWatcherSubtree(root);
      if (removed.length > 0) {
        needsResync = true;
        for (const root of removed) releasedRoots.add(root);
      }
      if (needsResync) {
        if (Date.now() < quotaRetryAt) return;
        try {
          await sync();
        } catch (error) {
          if (error instanceof QuotaExceededError) {
            quotaRetryAt = Date.now() + QUOTA_BACKOFF_MS;
            quotaReported = true;
          }
          throw error;
        }
        quotaRetryAt = 0;
        quotaReported = false;
        if (stopped) return;
        if (!watchers.has(watchRoot)) {
          console.log("Watching for file changes in", watchRoot);
          fileSystem.loadMgrepignore(watchRoot);
        }
        watchDirectory(watchRoot);
        for (const root of releasedRoots) watchDirectory(root);
        releasedRoots.clear();
        needsResync = false;
      }
    }
    return true;
  } catch (error) {
    cleanup();
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      !(error instanceof QuotaExceededError) &&
      !(error instanceof MaxFileCountExceededError)
    ) {
      console.error("Failed to start watcher:", message);
    }
    process.exitCode = 1;
    return false;
  }
}

export const watch = new Command("watch")
  .option(
    "-d, --dry-run",
    "Dry run the watch process (no actual file syncing)",
    false,
  )
  .option(
    "--max-file-size <bytes>",
    "Maximum file size in bytes to upload",
    (value) => {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new InvalidArgumentError("Must be a positive integer.");
      }
      return parsed;
    },
  )
  .option(
    "--max-file-count <count>",
    "Maximum number of files to upload",
    (value) => {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new InvalidArgumentError("Must be a positive integer.");
      }
      return parsed;
    },
  )
  .description("Watch for file changes")
  .action(async (_args, cmd) => {
    const options: WatchOptions = cmd.optsWithGlobals();
    await startWatch(options);
  });
