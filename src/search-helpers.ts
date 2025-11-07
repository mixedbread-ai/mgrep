import { InvalidArgumentError } from "commander";
import type { Mixedbread } from "@mixedbread/sdk";

export type MixedbreadSearchResult = Awaited<
  ReturnType<Mixedbread["stores"]["search"]>
>["data"][number];

export type NormalizedSearchResult = {
  store: string;
  path: string;
  text: string;
  preview: string;
  type: string;
  apiScore?: number;
  metadata?: Record<string, unknown>;
};

export type DisplaySearchResult = NormalizedSearchResult & {
  fuzzyScore?: number;
};

export type SearchCommandOptions = {
  stores?: string;
  perStore?: number;
  limit?: number;
  fuzzy: boolean;
  fuzzyThreshold: number;
  json?: boolean;
};

export function parseStoreList(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseFuzzyThreshold(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError("fuzzy-threshold must be between 0 and 1");
  }
  return parsed;
}

export function normalizeSearchResult(
  item: MixedbreadSearchResult,
  store: string,
): NormalizedSearchResult {
  const metadata = toMetadataRecord(item?.metadata);
  const pathMeta = extractResultPath(item, metadata);
  const rawText = extractResultText(item, metadata);
  const text =
    rawText ||
    (typeof metadata.summary === "string" ? metadata.summary : "") ||
    JSON.stringify({
      type: item?.type ?? "unknown",
      filename: (item as { filename?: string }).filename,
    });
  return {
    store,
    path: pathMeta,
    text,
    preview: buildPreview(text),
    type: item?.type ?? "unknown",
    apiScore: typeof item?.score === "number" ? item.score : undefined,
    metadata,
  };
}

export function buildPreview(text: string, maxLength = 200): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 1)}…`;
}

export function toMetadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function extractResultPath(
  item: MixedbreadSearchResult,
  metadata: Record<string, unknown>,
): string {
  const metadataPath = metadata.path;
  if (typeof metadataPath === "string" && metadataPath.length > 0) {
    return metadataPath;
  }
  const metadataFile = metadata.file;
  if (typeof metadataFile === "string" && metadataFile.length > 0) {
    return metadataFile;
  }
  const filename = (item as { filename?: string }).filename;
  if (typeof filename === "string" && filename.length > 0) {
    return filename;
  }
  return "Unknown path";
}

export function extractResultText(
  item: MixedbreadSearchResult,
  metadata: Record<string, unknown>,
): string {
  if ("text" in item && typeof item.text === "string") {
    return item.text;
  }
  if ("ocr_text" in item && typeof item.ocr_text === "string" && item.ocr_text) {
    return item.ocr_text;
  }
  if ("transcription" in item && typeof item.transcription === "string" && item.transcription) {
    return item.transcription;
  }
  if ("summary" in item && typeof item.summary === "string" && item.summary) {
    return item.summary;
  }
  const snippet = metadata.snippet;
  if (typeof snippet === "string" && snippet) {
    return snippet;
  }
  return "";
}
