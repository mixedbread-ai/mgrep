import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { createFileSystem, createStore } from "../lib/context";
import { DEFAULT_IGNORE_PATTERNS } from "../lib/file";
import {
  createIndexingSpinner,
  formatDryRunSummary,
} from "../lib/sync-helpers";
import {
  deleteFile,
  initialSync,
  QuotaExceededError,
  uploadFile,
} from "../lib/utils";

export async function startWatch(options: {
  store: string;
  dryRun: boolean;
}): Promise<void> {
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
      spinner.fail("Initial upload failed");
      throw e;
    }

    console.log("Watching for file changes in", watchRoot);
    fileSystem.loadMgrepignore(watchRoot);
    fs.watch(watchRoot, { recursive: true }, (eventType, rawFilename) => {
      const filename = rawFilename?.toString();
      if (!filename) {
        return;
      }
      const filePath = path.join(watchRoot, filename);

      if (fileSystem.isIgnored(filePath, watchRoot)) {
        return;
      }

      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          return;
        }

        console.log(`${eventType}: ${filePath}`);
        uploadFile(store, options.store, filePath, filename).catch((err) => {
          console.error("Failed to upload changed file:", filePath, err);
        });
      } catch {
        if (filePath.startsWith(watchRoot) && !fs.existsSync(filePath)) {
          console.log(`delete: ${filePath}`);
          deleteFile(store, options.store, filePath).catch((err) => {
            console.error("Failed to delete file:", filePath, err);
          });
        }
      }
    });
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
  .description("Watch for file changes")
  .action(async (_args, cmd) => {
    const options: { store: string; dryRun: boolean } = cmd.optsWithGlobals();
    await startWatch(options);
  });
