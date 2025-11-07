import { describe, expect, it } from "vitest";
import {
  buildPreview,
  extractResultPath,
  extractResultText,
  normalizeSearchResult,
  parseFuzzyThreshold,
  parsePositiveInteger,
  parseStoreList,
  toMetadataRecord,
  type MixedbreadSearchResult,
} from "./search-helpers";

describe("parseStoreList", () => {
  it("splits and trims values", () => {
    expect(parseStoreList(" foo,bar , baz ")).toEqual(["foo", "bar", "baz"]);
  });

  it("returns empty when undefined", () => {
    expect(parseStoreList()).toEqual([]);
  });
});

describe("parsePositiveInteger", () => {
  it("accepts valid ints", () => {
    expect(parsePositiveInteger("5", "limit")).toBe(5);
  });

  it("rejects invalid values", () => {
    expect(() => parsePositiveInteger("-1", "limit")).toThrowError();
  });
});

describe("parseFuzzyThreshold", () => {
  it("accepts decimals between 0 and 1", () => {
    expect(parseFuzzyThreshold("0.25")).toBeCloseTo(0.25);
  });

  it("rejects out of range", () => {
    expect(() => parseFuzzyThreshold("1.5")).toThrowError();
  });
});

describe("result normalization", () => {
  const makeTextChunk = (overrides: Partial<MixedbreadSearchResult> = {}): MixedbreadSearchResult => ({
    chunk_index: 0,
    score: 0.9,
    file_id: "file-1",
    filename: "src/index.ts",
    store_id: "store-1",
    metadata: { path: "src/index.ts", summary: "summary" },
    type: "text",
    text: "const foo = 1;",
    ...overrides,
  } as MixedbreadSearchResult);

  it("keeps metadata paths and text", () => {
    const normalized = normalizeSearchResult(makeTextChunk(), "store-1");
    expect(normalized.path).toBe("src/index.ts");
    expect(normalized.text).toContain("const foo");
    expect(normalized.store).toBe("store-1");
  });

  it("falls back to filename and OCR text", () => {
    const item = makeTextChunk({
      type: "image_url",
      text: undefined,
      metadata: {},
      ocr_text: "diagram text",
      filename: "diagram.png",
    } as MixedbreadSearchResult);
    const normalized = normalizeSearchResult(item, "store-2");
    expect(normalized.path).toBe("diagram.png");
    expect(normalized.text).toBe("diagram text");
  });
});

describe("metadata helpers", () => {
  it("coerces plain objects", () => {
    expect(toMetadataRecord({ foo: "bar" })).toEqual({ foo: "bar" });
  });

  it("returns empty for non-objects", () => {
    expect(toMetadataRecord(null)).toEqual({});
  });
});

describe("preview + extraction", () => {
  const chunk = {
    chunk_index: 0,
    score: 0.1,
    file_id: "f",
    filename: "f.txt",
    store_id: "s",
    metadata: {},
    type: "text",
    text: "hello world",
  } as MixedbreadSearchResult;

  it("builds short previews", () => {
    expect(buildPreview("hello\nworld\t!", 20)).toBe("hello world !");
  });

  it("extracts snippets from metadata", () => {
    const metadata = { snippet: "from meta" };
    expect(extractResultText(chunk, metadata)).toBe("hello world");
    expect(extractResultPath(chunk, metadata)).toBe("f.txt");
  });
});
