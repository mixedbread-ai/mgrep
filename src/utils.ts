import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

export function computeBufferHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function computeFileHash(filePath: string, readFileSyncFn: (p: string) => Buffer): string {
  const buffer = readFileSyncFn(filePath);
  return computeBufferHash(buffer);
}

export function getGitRepoFiles(repoRoot: string): string[] {
  const run = (args: string[]) => {
    const res = spawnSync("git", args, { cwd: repoRoot, encoding: "utf-8" });
    if (res.error) return "";
    return res.stdout as string;
  };

  // Tracked files
  const tracked = run(["ls-files", "-z"])
    .split("\u0000")
    .filter(Boolean);

  // Untracked but not ignored
  const untracked = run(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\u0000")
    .filter(Boolean);

  const combined = Array.from(new Set([...tracked, ...untracked]));
  if (combined.length === 0) {
    return walkDirectoryFiles(repoRoot);
  }
  return combined.map((rel) => path.join(repoRoot, rel));
}

export function isIgnoredByGit(filePath: string, repoRoot: string): boolean {
  const relative = getRepoRelativePath(filePath, repoRoot);
  if (relative === null) {
    return true;
  }
  try {
    const result = spawnSync("git", ["check-ignore", "-q", "--", relative || "."], {
      cwd: repoRoot,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function getGitRoot(startDir: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startDir,
      encoding: "utf-8",
    });
    if (result.status !== 0 || result.error) {
      return null;
    }
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export function getRepoRelativePath(filePath: string, repoRoot: string): string | null {
  const relative = path.relative(repoRoot, filePath);
  if (!relative) {
    return null;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return toPosixPath(relative);
}

export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function walkDirectoryFiles(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  return results;
}
