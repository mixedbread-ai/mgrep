import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getRepoRelativePath, toPosixPath, walkDirectoryFiles } from "./utils";

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

describe("walkDirectoryFiles", () => {
  it("skips ignored directories during fallback traversal", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mgrep-utils-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "// hello");

      fs.mkdirSync(path.join(tmpDir, "node_modules", "leftpad"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "node_modules", "leftpad", "index.js"), "module.exports = 1;");

      fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".git", "config"), "[core]");

      const files = walkDirectoryFiles(tmpDir);
      expect(files).toContain(path.join(tmpDir, "src", "index.ts"));
      expect(files).not.toContain(path.join(tmpDir, "node_modules", "leftpad", "index.js"));
      expect(files).not.toContain(path.join(tmpDir, ".git", "config"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
