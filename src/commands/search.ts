import { join, normalize } from "node:path";
import type { Command } from "commander";
import { Command as CommanderCommand } from "commander";
import { createFileSystem, createStore } from "../lib/context";
import { DEFAULT_IGNORE_PATTERNS } from "../lib/file";
import type {
  AskResponse,
  ChunkType,
  FileMetadata,
  SearchResponse,
} from "../lib/store";
import {
  createIndexingSpinner,
  formatDryRunSummary,
} from "../lib/sync-helpers";
import { initialSync, QuotaExceededError } from "../lib/utils";

function extractSources(response: AskResponse): { [key: number]: ChunkType } {
  const sources: { [key: number]: ChunkType } = {};
  const answer = response.answer;

  // Match ALL cite tags and capture the i="..."
  const citeTags = answer.match(/<cite i="(\d+(?:-\d+)?)"/g) ?? [];

  for (const tag of citeTags) {
    // Extract the index or index range inside the tag.
    const index = tag.match(/i="(\d+(?:-\d+)?)"/)?.[1];
    if (!index) continue;

    // Case 1: Single index
    if (!index.includes("-")) {
      const idx = Number(index);
      if (!Number.isNaN(idx) && idx < response.sources.length) {
        sources[idx] = response.sources[idx];
      }
      continue;
    }

    // Case 2: Range "start-end"
    const [start, end] = index.split("-").map(Number);

    if (
      !Number.isNaN(start) &&
      !Number.isNaN(end) &&
      start >= 0 &&
      end >= start &&
      end < response.sources.length
    ) {
      for (let i = start; i <= end; i++) {
        sources[i] = response.sources[i];
      }
    }
  }

  return sources;
}

function formatAskResponse(response: AskResponse, show_content: boolean) {
  const sources = extractSources(response);
  const sourceEntries = Object.entries(sources).map(
    ([index, chunk]) => `${index}: ${formatChunk(chunk, show_content)}`,
  );
  return `${response.answer}\n\n${sourceEntries.join("\n")}`;
}

function formatSearchResponse(response: SearchResponse, show_content: boolean) {
  return response.data
    .map((chunk) => formatChunk(chunk, show_content))
    .join("\n");
}

function formatChunk(chunk: ChunkType, show_content: boolean) {
  const pwd = process.cwd();
  const path =
    (chunk.metadata as FileMetadata)?.path?.replace(pwd, "") ?? "Unknown path";
  let line_range = "";
  let content = "";
  switch (chunk.type) {
    case "text": {
      const start_line = (chunk.generated_metadata?.start_line as number) + 1;
      const end_line =
        start_line + (chunk.generated_metadata?.num_lines as number);
      line_range = `:${start_line}-${end_line}`;
      content = show_content ? chunk.text : "";
      break;
    }
    case "image_url":
      line_range =
        chunk.generated_metadata?.type === "pdf"
          ? `, page ${chunk.chunk_index + 1}`
          : "";
      break;
    case "audio_url":
      line_range = "";
      break;
    case "video_url":
      line_range = "";
      break;
  }

  return `.${path}${line_range} (${(chunk.score * 100).toFixed(2)}% match)${content ? `\n${content}` : ""}`;
}

function parseBooleanEnv(
  envVar: string | undefined,
  defaultValue: boolean,
): boolean {
  if (envVar === undefined) return defaultValue;
  const lower = envVar.toLowerCase();
  return lower === "1" || lower === "true" || lower === "yes" || lower === "y";
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
    } = cmd.optsWithGlobals();
    if (exec_path?.startsWith("--")) {
      exec_path = "";
    }

    const root = process.cwd();
    const { spinner, onProgress } = createIndexingSpinner(root);

    try {
      const store = await createStore();

      if (options.sync) {
        const fileSystem = createFileSystem({
          ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
        });
        const result = await initialSync(
          store,
          fileSystem,
          options.store,
          root,
          options.dryRun,
          onProgress,
        );
        while (true) {
          const info = await store.getInfo(options.store);
          spinner.text = `Indexing ${info.counts.pending + info.counts.in_progress} file(s)`;
          if (info.counts.pending === 0 && info.counts.in_progress === 0) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        spinner.succeed("Indexing complete");
        if (options.dryRun) {
          console.log(
            formatDryRunSummary(result, {
              actionDescription: "would have indexed",
            }),
          );
          return;
        }
      }

      const search_path = exec_path?.startsWith("/")
        ? exec_path
        : normalize(join(root, exec_path ?? ""));

      let response: string;
      if (!options.answer) {
        const results = await store.search(
          options.store,
          pattern,
          parseInt(options.maxCount, 10),
          { rerank: options.rerank },
          {
            all: [
              {
                key: "path",
                operator: "starts_with",
                value: search_path,
              },
            ],
          },
        );
        response = formatSearchResponse(results, options.content);
      } else {
        const results = await store.ask(
          options.store,
          pattern,
          parseInt(options.maxCount, 10),
          { rerank: options.rerank },
          {
            all: [
              {
                key: "path",
                operator: "starts_with",
                value: search_path,
              },
            ],
          },
        );
        response = formatAskResponse(results, options.content);
      }

      console.log(response);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        spinner.fail(
          "\n❌ Free tier quota exceeded. You've reached the monthly limit of 2,000,000 store tokens.",
        );
        console.error(
          "   Upgrade your plan at https://platform.mixedbread.com to continue syncing.\n",
        );
        return;
      } else {
        spinner.fail("Failed to search");
      }
      process.exitCode = 1;
    }
  });
