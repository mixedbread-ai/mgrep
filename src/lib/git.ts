import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Interface for git operations
 */
export interface Git {
  /**
   * Checks if a directory is a git repository
   */
  isGitRepository(dir: string): boolean;

  /**
   * Retrieves all files in a directory, preferring git-based file listing when available
   */
  getDirectoryFiles(dirRoot: string): string[];

  /**
   * Determines if a file should be ignored based on git ignore rules and hidden file patterns
   */
  isIgnoredByGit(filePath: string, repoRoot: string): boolean;

  /**
   * Filters an array of file paths to include only valid files that are not ignored by git
   */
  filterRepoFiles(files: string[], repoRoot: string): string[];
}

/**
 * Node.js implementation of the Git interface using git CLI commands
 */
export class NodeGit implements Git {
  private gitRepoCache = new Map<string, boolean>();

  isGitRepository(dir: string): boolean {
    const normalizedDir = path.resolve(dir);

    const cached = this.gitRepoCache.get(normalizedDir);
    if (cached !== undefined) {
      return cached;
    }

    let isGit = false;
    try {
      const result = spawnSync("git", ["rev-parse", "--git-dir"], {
        cwd: dir,
        encoding: "utf-8",
      });
      isGit = result.status === 0 && !result.error;
    } catch {
      isGit = false;
    }

    this.gitRepoCache.set(normalizedDir, isGit);
    return isGit;
  }

  private isHiddenFile(filePath: string, root: string): boolean {
    const relativePath = path.relative(root, filePath);
    const parts = relativePath.split(path.sep);
    return parts.some(
      (part) => part.startsWith(".") && part !== "." && part !== "..",
    );
  }

  private getAllFilesRecursive(dir: string, root: string): string[] {
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (this.isHiddenFile(fullPath, root)) {
          continue;
        }

        if (entry.isDirectory()) {
          files.push(...this.getAllFilesRecursive(fullPath, root));
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch {
      // Error handling
    }
    return files;
  }

  getDirectoryFiles(dirRoot: string): string[] {
    if (this.isGitRepository(dirRoot)) {
      const run = (args: string[]) => {
        const res = spawnSync("git", args, { cwd: dirRoot, encoding: "utf-8" });
        if (res.error) return "";
        return res.stdout as string;
      };

      const tracked = run(["ls-files", "-z"]).split("\u0000").filter(Boolean);

      const untracked = run([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ])
        .split("\u0000")
        .filter(Boolean);

      const allRel = Array.from(new Set([...tracked, ...untracked]));
      return allRel.map((rel) => path.join(dirRoot, rel));
    }

    return this.getAllFilesRecursive(dirRoot, dirRoot);
  }

  isIgnoredByGit(filePath: string, repoRoot: string): boolean {
    if (this.isHiddenFile(filePath, repoRoot)) {
      return true;
    }

    if (this.isGitRepository(repoRoot)) {
      try {
        const result = spawnSync(
          "git",
          ["check-ignore", "-q", "--", filePath],
          {
            cwd: repoRoot,
          },
        );
        return result.status === 0;
      } catch {
        return false;
      }
    }

    return false;
  }

  filterRepoFiles(files: string[], repoRoot: string): string[] {
    const filtered: string[] = [];
    for (const filePath of files) {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      if (this.isIgnoredByGit(filePath, repoRoot)) continue;
      filtered.push(filePath);
    }
    return filtered;
  }
}
