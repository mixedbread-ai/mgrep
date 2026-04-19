import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { Command, InvalidArgumentError } from "commander";
import { type CliConfigOptions, loadConfig } from "../lib/config.js";
import { createFileSystem, createStore } from "../lib/context.js";
import { DEFAULT_IGNORE_PATTERNS } from "../lib/file.js";
import {
  createIndexingSpinner,
  formatDryRunSummary,
} from "../lib/sync-helpers.js";
import {
  deleteFile,
  initialSync,
  isAtOrAboveHomeDirectory,
  MaxFileCountExceededError,
  QuotaExceededError,
  uploadFile,
} from "../lib/utils.js";

export interface WatchOptions {
  store: string;
  dryRun: boolean;
  maxFileSize?: number;
  maxFileCount?: number;
  shared?: boolean;
}

export async function startWatch(options: WatchOptions): Promise<void> {
  let refreshInterval: NodeJS.Timeout | undefined;

  try {
    const store = await createStore();

    // Refresh JWT token every 5 minutes (before 15-minute expiration)
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
      // Allow process to exit even if interval is active (fs.watch keeps it alive anyway)
      refreshInterval.unref();
    }

    const fileSystem = createFileSystem({
      ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
    });
    const watchRoot = process.cwd();

    if (isAtOrAboveHomeDirectory(watchRoot)) {
      console.error(
        "Error: Cannot watch home directory or any parent directory.",
      );
      console.error(
        "Please run this command from within a specific project subdirectory.",
      );
      process.exitCode = 1;
      return;
    }

    const cliOptions: CliConfigOptions = {
      maxFileSize: options.maxFileSize,
      maxFileCount: options.maxFileCount,
      shared: options.shared,
    };
    const config = loadConfig(watchRoot, cliOptions);
    console.debug(`Store: ${chalk.cyan(options.store)}`);
    if (config.shared) {
      console.debug(chalk.yellow("Shared mode enabled"));
    }
    console.debug("Watching for file changes in", watchRoot);

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
      );
      const deletedInfo =
        result.deleted > 0 ? ` • deleted ${result.deleted}` : "";
      const errorsInfo = result.errors > 0 ? ` • errors ${result.errors}` : "";
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
        console.error(
          "\n❌ Free tier quota exceeded. You've reached the monthly limit of 2,000,000 store tokens.",
        );
        console.error(
          "   Upgrade your plan at https://platform.mixedbread.com to continue syncing.\n",
        );
        process.exit(1);
      }
      if (e instanceof MaxFileCountExceededError) {
        spinner.fail("File count exceeded");
        console.error(`\n❌ ${e.message}`);
        console.error(
          "   Increase the limit with --max-file-count or MGREP_MAX_FILE_COUNT environment variable.\n",
        );
        process.exit(1);
      }
      spinner.fail("Initial upload failed");
      throw e;
    }

    console.log("Watching for file changes in", watchRoot);
    fileSystem.loadMgrepignore(watchRoot);

    // Use per-directory non-recursive watchers to avoid watching ignored
    // directories like .git/, node_modules/, target/, etc. fs.watch with
    // recursive: true allocates inotify watches on ALL subdirectories before
    // the callback filter runs, which exhausts the kernel watcher limit on
    // large repos.
    const watchers = new Map<string, fs.FSWatcher>();

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

      if (fileSystem.isIgnored(filePath, watchRoot)) {
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
      if (watchers.has(dirPath)) {
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
        watchers.set(dirPath, watcher);
      } catch (error) {
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
        console.warn(`Warning: failed to read directory ${dirPath}:`, error);
      }
    }

    watchDirectory(watchRoot);
  } catch (error) {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to start watcher:", message);
    process.exitCode = 1;
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
  .option(
    "-S, --shared",
    "Enable shared mode for multi-user collaboration",
  )
  .description("Watch for file changes")
  .action(async (_args, cmd) => {
    const options: WatchOptions = cmd.optsWithGlobals();
    await startWatch(options);
  });
