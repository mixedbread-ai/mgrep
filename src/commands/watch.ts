import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { createFileSystem, createStore } from "../lib/context";
import { DEFAULT_IGNORE_PATTERNS } from "../lib/file";
import {
  createIndexingSpinner,
  formatDryRunSummary,
} from "../lib/sync-helpers";
import { initialSync, uploadFile } from "../utils";

export async function startWatch(options: {
  store: string;
  dryRun: boolean;
}): Promise<void> {
  try {
    const store = await createStore();
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
      spinner.succeed(
        `Initial sync complete (${result.processed}/${result.total}) • uploaded ${result.uploaded}`,
      );
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
      console.log(`${eventType}: ${filePath}`);

      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          return;
        }
      } catch {
        return;
      }

      if (fileSystem.isIgnored(filePath, watchRoot)) {
        return;
      }

      uploadFile(store, options.store, filePath, filename).catch((err) => {
        console.error("Failed to upload changed file:", filePath, err);
      });
    });
  } catch (error) {
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
