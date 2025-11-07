import { describe, expect, it } from "vitest";
import * as path from "path";
import { getRepoRelativePath, toPosixPath } from "./utils";

describe("getRepoRelativePath", () => {
  const repoRoot = path.join("/tmp", "repo");

  it("returns posix paths for nested files", () => {
    const filePath = path.join(repoRoot, "src", "index.ts");
    expect(getRepoRelativePath(filePath, repoRoot)).toBe("src/index.ts");
  });

  it("returns null when file escapes the repo root", () => {
    const sibling = path.join(repoRoot, "..", "other", "file.ts");
    expect(getRepoRelativePath(sibling, repoRoot)).toBeNull();
  });
});

describe("toPosixPath", () => {
  it("normalizes windows separators", () => {
    expect(toPosixPath("src\\app\\main.ts")).toBe("src/app/main.ts");
  });
});
