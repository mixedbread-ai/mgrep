import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const gitRepoCache = new Map<string, boolean>();

/**
 * Checks if a directory is a git repository by attempting to run git rev-parse.
 * Results are cached per directory path to avoid repeated git commands.
 *
 * @param dir - The directory path to check
 * @returns True if the directory is a git repository, false otherwise
 */
export function isGitRepository(dir: string): boolean {
  const normalizedDir = path.resolve(dir);

  if (gitRepoCache.has(normalizedDir)) {
    return gitRepoCache.get(normalizedDir) ?? false;
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

  gitRepoCache.set(normalizedDir, isGit);
  return isGit;
}

function isHiddenFile(filePath: string, root: string): boolean {
  const relativePath = path.relative(root, filePath);
  const parts = relativePath.split(path.sep);
  return parts.some(
    (part) => part.startsWith(".") && part !== "." && part !== "..",
  );
}

function getAllFilesRecursive(dir: string, root: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (isHiddenFile(fullPath, root)) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...getAllFilesRecursive(fullPath, root));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // Error handling
  }
  return files;
}

/**
 * Retrieves all files in a directory, preferring git-based file listing when available.
 * If the directory is a git repository, uses `git ls-files` to get tracked and untracked
 * (but not ignored) files. Otherwise, falls back to recursive filesystem traversal.
 *
 * @param dirRoot - The root directory to scan for files
 * @returns Array of absolute file paths
 */
export function getDirectoryFiles(dirRoot: string): string[] {
  if (isGitRepository(dirRoot)) {
    const run = (args: string[]) => {
      const res = spawnSync("git", args, { cwd: dirRoot, encoding: "utf-8" });
      if (res.error) return "";
      return res.stdout as string;
    };

    const tracked = run(["ls-files", "-z"]).split("\u0000").filter(Boolean);

    const untracked = run(["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\u0000")
      .filter(Boolean);

    const allRel = Array.from(new Set([...tracked, ...untracked]));
    return allRel.map((rel) => path.join(dirRoot, rel));
  }

  return getAllFilesRecursive(dirRoot, dirRoot);
}

/**
 * Determines if a file should be ignored based on git ignore rules and hidden file patterns.
 * Always ignores hidden files (starting with '.'). If the directory is a git repository,
 * also checks git's ignore rules using `git check-ignore`.
 *
 * @param filePath - The absolute path to the file to check
 * @param repoRoot - The root directory of the repository
 * @returns True if the file should be ignored, false otherwise
 */
export function isIgnoredByGit(filePath: string, repoRoot: string): boolean {
  if (isHiddenFile(filePath, repoRoot)) {
    return true;
  }

  if (isGitRepository(repoRoot)) {
    try {
      const result = spawnSync("git", ["check-ignore", "-q", "--", filePath], {
        cwd: repoRoot,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Filters an array of file paths to include only valid files that are not ignored by git.
 * Removes directories, files that cannot be accessed, and files that match git ignore patterns.
 *
 * @param files - Array of file paths to filter
 * @param repoRoot - The root directory of the repository for ignore checking
 * @returns Array of filtered file paths
 */
export function filterRepoFiles(files: string[], repoRoot: string): string[] {
  const filtered: string[] = [];
  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    if (isIgnoredByGit(filePath, repoRoot)) continue;
    filtered.push(filePath);
  }
  return filtered;
}
