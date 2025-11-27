import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { createFileSystem, createStore } from "../lib/context";
import {
  createIndexingSpinner,
  formatDryRunSummary,
} from "../lib/sync-helpers";
import { deleteFile, initialSync, uploadFile } from "../utils";

export async function startWatch(options: {
  store: string;
  dryRun: boolean;
}): Promise<void> {
  try {
    const store = await createStore();
    const fileSystem = createFileSystem({
      ignorePatterns: ["*.lock", "*.bin", "*.ipynb", "*.pyc", "*.safetensors"],
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
      spinner.succeed(
        `Initial sync complete (${result.processed}/${result.total}) • uploaded ${result.uploaded}${deletedInfo}`,
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

      if (fileSystem.isIgnored(filePath, watchRoot)) {
        return;
      }

      let fileExists = false;
      try {
        const stat = fs.statSync(filePath);
        fileExists = stat.isFile();
      } catch {
        fileExists = false;
      }

      if (fileExists) {
        console.log(`${eventType}: ${filePath}`);
        uploadFile(store, options.store, filePath, filename).catch((err) => {
          console.error("Failed to upload changed file:", filePath, err);
        });
      } else if (filePath.startsWith(watchRoot)) {
        console.log(`delete: ${filePath}`);
        deleteFile(store, options.store, filePath).catch((err) => {
          console.error("Failed to delete file:", filePath, err);
        });
      }
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
