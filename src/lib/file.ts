import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import type { Git } from "./git";

/**
 * Default glob patterns to ignore during file indexing.
 * These are not recognized as binary and also can't be uploaded to Mixedbread.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  "*.lock",
  "*.bin",
  "*.ipynb",
  "*.pyc",
  "*.safetensors",
  "*.sqlite",
  "*.pt",
];

/**
 * Configuration options for file system operations
 */
export interface FileSystemOptions {
  /**
   * Additional glob patterns to ignore (in addition to .gitignore and hidden files)
   */
  ignorePatterns: string[];
}

/**
 * Interface for file system operations
 */
export interface FileSystem {
  /**
   * Gets all files in a directory
   */
  getFiles(dirRoot: string): Generator<string>;

  /**
   * Checks if a file should be ignored
   */
  isIgnored(filePath: string, root: string): boolean;

  /**
   * Loads the mgrepignore file for a directory
   */
  loadMgrepignore(dirRoot: string): void;
}

/**
 * Node.js implementation of FileSystem with gitignore support
 */
export class NodeFileSystem implements FileSystem {
  private customIgnoreFilter: ReturnType<typeof ignore>;
  private ignoreCache = new Map<string, ReturnType<typeof ignore>>();

  constructor(
    private git: Git,
    options: FileSystemOptions,
  ) {
    this.customIgnoreFilter = ignore();
    this.customIgnoreFilter.add(options.ignorePatterns);
  }

  /**
   * Checks if a file is a hidden file (starts with .)
   */
  private isHiddenFile(filePath: string, root: string): boolean {
    const relativePath = path.relative(root, filePath);
    const parts = relativePath.split(path.sep);
    return parts.some(
      (part) => part.startsWith(".") && part !== "." && part !== "..",
    );
  }

  /**
   * Gets all files recursively from a directory
   */
  private *getAllFilesRecursive(dir: string, root: string): Generator<string> {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (this.isHiddenFile(fullPath, root)) {
          continue;
        }

        if (this.isIgnored(fullPath, root)) {
          continue;
        }

        if (entry.isDirectory()) {
          yield* this.getAllFilesRecursive(fullPath, root);
        } else if (entry.isFile()) {
          yield fullPath;
        }
      }
    } catch (error) {
      // Log permission or other filesystem errors
      console.error(`Warning: Failed to read directory ${dir}:`, error);
    }
  }

  *getFiles(dirRoot: string): Generator<string> {
    // Preload root .mgrepignore to ensure it's cached
    this.getDirectoryIgnoreFilter(dirRoot);

    if (this.git.isGitRepository(dirRoot)) {
      yield* this.git.getGitFiles(dirRoot);
    } else {
      yield* this.getAllFilesRecursive(dirRoot, dirRoot);
    }
  }

  private getDirectoryIgnoreFilter(dir: string): ReturnType<typeof ignore> {
    if (this.ignoreCache.has(dir)) {
      return this.ignoreCache.get(dir) ?? ignore();
    }

    const ig = ignore();

    // Load .gitignore
    const gitignorePath = path.join(dir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, "utf8"));
    }

    // Load .mgrepignore
    const mgrepignorePath = path.join(dir, ".mgrepignore");
    if (fs.existsSync(mgrepignorePath)) {
      ig.add(fs.readFileSync(mgrepignorePath, "utf8"));
    }

    this.ignoreCache.set(dir, ig);
    return ig;
  }

  isIgnored(filePath: string, root: string): boolean {
    // Always ignore hidden files
    if (this.isHiddenFile(filePath, root)) {
      return true;
    }

    // Check custom ignore patterns (global/CLI)
    const relativeToRoot = path.relative(root, filePath);
    const normalizedRootPath = relativeToRoot.replace(/\\/g, "/");

    // Check if it's a directory
    let isDirectory = false;
    try {
      const stat = fs.statSync(filePath);
      isDirectory = stat.isDirectory();
    } catch {
      isDirectory = false;
    }

    const pathToCheckRoot = isDirectory
      ? `${normalizedRootPath}/`
      : normalizedRootPath;
    if (this.customIgnoreFilter.ignores(pathToCheckRoot)) {
      return true;
    }

    // Hierarchical check
    let currentDir = isDirectory ? filePath : path.dirname(filePath);
    const absoluteRoot = path.resolve(root);

    // Walk up from file directory to root
    while (true) {
      const relativeToCurrent = path.relative(currentDir, filePath);
      if (relativeToCurrent !== "") {
        // If we are checking the directory itself against its own ignore file? No, files inside.
        // But if we are checking a file `a/b.txt`, and we are at `a`, relative is `b.txt`.
        // If we are at `root`, relative is `a/b.txt`.
        const normalizedRelative = relativeToCurrent.replace(/\\/g, "/");
        const pathToCheck = isDirectory
          ? `${normalizedRelative}/`
          : normalizedRelative;

        const filter = this.getDirectoryIgnoreFilter(currentDir);

        // Use internal test() method if available to distinguish ignored vs unignored
        const result = filter.test(pathToCheck);
        if (result.ignored) {
          return true;
        }
        if (result.unignored) {
          return false;
        }
      }

      if (path.resolve(currentDir) === absoluteRoot) {
        break;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break; // Safety break for root of fs
      currentDir = parent;
    }

    return false;
  }

  loadMgrepignore(dirRoot: string): void {
    // Now handled by getDirectoryIgnoreFilter and caching
    this.getDirectoryIgnoreFilter(dirRoot);
  }
}
