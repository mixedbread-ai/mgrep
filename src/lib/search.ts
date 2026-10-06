import { isAbsolute, join, normalize, relative } from "node:path";
import type {
  AskResponse,
  ChunkType,
  FileMetadata,
  SearchResponse,
  Store,
} from "./store.js";

export interface RunSearchOptions {
  store: string;
  query: string;
  path: string;
  maxCount: number;
  content: boolean;
  answer: boolean;
  web: boolean;
  rerank: boolean;
  agentic: boolean;
}

/**
 * Resolves the search filter path without changing absolute paths.
 * @param root The absolute search root.
 * @param execPath An optional relative or absolute search path.
 * @returns The absolute path used by the starts_with filter.
 */
export function resolveSearchPath(root: string, execPath?: string): string {
  return execPath !== undefined && isAbsolute(execPath)
    ? execPath
    : normalize(join(root, execPath ?? ""));
}

/**
 * Searches indexed files or generates an answer without syncing files.
 * @param store The authenticated store implementation.
 * @param options Search, filter, and output options.
 * @param root The absolute root used to make result paths relative.
 * @returns The formatted text shared by the CLI and MCP tool.
 */
export async function runSearch(
  store: Store,
  options: RunSearchOptions,
  root: string,
): Promise<string> {
  const storeIds = options.web
    ? [options.store, "mixedbread/web"]
    : [options.store];
  const filters = {
    all: [
      { key: "path", operator: "starts_with" as const, value: options.path },
    ],
  };
  const searchOptions = {
    rerank: options.rerank,
    ...(options.agentic && { agentic: true }),
  };

  if (options.answer) {
    const results = await store.ask(
      storeIds,
      options.query,
      options.maxCount,
      searchOptions,
      filters,
    );
    return formatAskResponse(results, options.content, root);
  }

  const results = await store.search(
    storeIds,
    options.query,
    options.maxCount,
    searchOptions,
    filters,
  );
  return formatSearchResponse(results, options.content, root);
}

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

function formatAskResponse(
  response: AskResponse,
  show_content: boolean,
  root: string,
): string {
  const sources = extractSources(response);
  const sourceEntries = Object.entries(sources).map(
    ([index, chunk]) => `${index}: ${formatChunk(chunk, show_content, root)}`,
  );
  return `${response.answer}\n\n${sourceEntries.join("\n")}`;
}

function formatSearchResponse(
  response: SearchResponse,
  show_content: boolean,
  root: string,
): string {
  return response.data
    .map((chunk) => formatChunk(chunk, show_content, root))
    .join("\n");
}

function isWebResult(chunk: ChunkType): boolean {
  return (
    "filename" in chunk &&
    typeof chunk.filename === "string" &&
    chunk.filename.startsWith("http")
  );
}

function formatChunk(
  chunk: ChunkType,
  show_content: boolean,
  root: string,
): string {
  if (isWebResult(chunk) && chunk.type === "text") {
    const url = "filename" in chunk ? chunk.filename : "Unknown URL";
    const content = show_content ? chunk.text : "";
    return `${url} (${(chunk.score * 100).toFixed(2)}% match)${content ? `\n${content}` : ""}`;
  }

  const filePath = (chunk.metadata as FileMetadata)?.path;
  const path = filePath ? `./${relative(root, filePath)}` : ".Unknown path";
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

  return `${path}${line_range} (${(chunk.score * 100).toFixed(2)}% match)${content ? `\n${content}` : ""}`;
}
