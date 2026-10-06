import type { Command } from "commander";
import { Command as CommanderCommand, InvalidArgumentError } from "commander";
import {
  type CliConfigOptions,
  loadConfig,
  type MgrepConfig,
} from "../lib/config.js";
import { createFileSystem, createStore } from "../lib/context.js";
import { DEFAULT_IGNORE_PATTERNS } from "../lib/file.js";
import { resolveSearchPath, runSearch } from "../lib/search.js";
import type { Store } from "../lib/store.js";
import {
  createIndexingSpinner,
  formatDryRunSummary,
} from "../lib/sync-helpers.js";
import {
  initialSync,
  isAtOrAboveHomeDirectory,
  MaxFileCountExceededError,
  QuotaExceededError,
} from "../lib/utils.js";

function parseBooleanEnv(
  envVar: string | undefined,
  defaultValue: boolean,
): boolean {
  if (envVar === undefined) return defaultValue;
  const lower = envVar.toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes" || lower === "y";
}

/**
 * Syncs local files to the store with progress indication.
 * @param store The authenticated store.
 * @param storeName The store to sync.
 * @param root The absolute directory to sync.
 * @param dryRun Whether to report changes without applying them.
 * @param config The project indexing limits and settings.
 * @returns true if the caller should return early (dry-run mode), false otherwise
 */
export async function syncFiles(
  store: Store,
  storeName: string,
  root: string,
  dryRun: boolean,
  config?: MgrepConfig,
): Promise<boolean> {
  const { spinner, onProgress } = createIndexingSpinner(root);

  try {
    const fileSystem = createFileSystem({
      ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
    });
    const result = await initialSync(
      store,
      fileSystem,
      storeName,
      root,
      dryRun,
      onProgress,
      config,
    );

    while (true) {
      const info = await store.getInfo(storeName);
      spinner.text = `Indexing ${info.counts.pending + info.counts.in_progress} file(s)`;
      if (info.counts.pending === 0 && info.counts.in_progress === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    spinner.succeed("Indexing complete");

    if (dryRun) {
      console.log(
        formatDryRunSummary(result, {
          actionDescription: "would have indexed",
        }),
      );
      return true;
    }

    return false;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

export const search: Command = new CommanderCommand("search")
  .description("File pattern searcher")
  .option("-i", "Makes the search case-insensitive", false)
  .option("-r", "Recursive search", false)
  .option(
    "-m, --max-count <max_count>",
    "The maximum number of results to return",
    process.env.MGREP_MAX_COUNT || "10",
  )
  .option(
    "-c, --content",
    "Show content of the results",
    parseBooleanEnv(process.env.MGREP_CONTENT, false),
  )
  .option(
    "-a, --answer",
    "Generate an answer to the question based on the results",
    parseBooleanEnv(process.env.MGREP_ANSWER, false),
  )
  .option(
    "-s, --sync",
    "Syncs the local files to the store before searching",
    parseBooleanEnv(process.env.MGREP_SYNC, false),
  )
  .option(
    "-d, --dry-run",
    "Dry run the search process (no actual file syncing)",
    parseBooleanEnv(process.env.MGREP_DRY_RUN, false),
  )
  .option(
    "--no-rerank",
    "Disable reranking of search results",
    parseBooleanEnv(process.env.MGREP_RERANK, true), // `true` here means that reranking is enabled by default
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
    "-w, --web",
    "Include web search results from mixedbread/web store",
    parseBooleanEnv(process.env.MGREP_WEB, false),
  )
  .option(
    "--agentic",
    "Enable agentic search to automatically refine queries and perform multiple searches",
    parseBooleanEnv(process.env.MGREP_AGENTIC, false),
  )
  .argument("<pattern>", "The pattern to search for")
  .argument("[path]", "The path to search in")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (pattern, exec_path, _options, cmd) => {
    const options: {
      store: string;
      maxCount: string;
      content: boolean;
      answer: boolean;
      sync: boolean;
      dryRun: boolean;
      rerank: boolean;
      maxFileSize?: number;
      maxFileCount?: number;
      web: boolean;
      agentic: boolean;
    } = cmd.optsWithGlobals();
    if (exec_path?.startsWith("--")) {
      exec_path = "";
    }

    const root = process.cwd();
    const cliOptions: CliConfigOptions = {
      maxFileSize: options.maxFileSize,
      maxFileCount: options.maxFileCount,
    };
    const config = loadConfig(root, cliOptions);

    const search_path = resolveSearchPath(root, exec_path);

    if (options.sync && isAtOrAboveHomeDirectory(search_path)) {
      console.error(
        "Error: Cannot sync home directory or any parent directory.",
      );
      console.error(
        "Please run this command from within a specific project subdirectory.",
      );
      process.exitCode = 1;
      return;
    }

    try {
      const store = await createStore();

      if (options.sync) {
        const shouldReturn = await syncFiles(
          store,
          options.store,
          search_path,
          options.dryRun,
          config,
        );
        if (shouldReturn) {
          return;
        }
      }

      const response = await runSearch(
        store,
        {
          store: options.store,
          query: pattern,
          path: search_path,
          maxCount: parseInt(options.maxCount, 10),
          content: options.content,
          answer: options.answer,
          web: options.web,
          rerank: options.rerank,
          agentic: options.agentic,
        },
        root,
      );

      console.log(response);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        console.error(
          "Free tier quota exceeded. You've reached the monthly limit of 2,000,000 store tokens.",
        );
        console.error(
          "   Upgrade your plan at https://platform.mixedbread.com to continue syncing.\n",
        );
      } else if (error instanceof MaxFileCountExceededError) {
        console.error(`${error.message}`);
        console.error(
          "   Increase the limit with --max-file-count or MGREP_MAX_FILE_COUNT environment variable.\n",
        );
      } else {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to search: ${message}`);
      }
      process.exitCode = 1;
    }
  });
