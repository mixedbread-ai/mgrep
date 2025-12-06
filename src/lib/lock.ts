import * as fs from "node:fs";
import * as path from "node:path";

const LOCK_DIR = "/tmp";
const LOCK_PREFIX = "mgrep-watch-lock-";

/**
 * Generates a lock file path based on the directory being watched.
 * Uses a hash of the directory path to create a unique lock file name.
 */
function getLockFilePath(watchDir: string): string {
  const normalizedPath = path.resolve(watchDir);
  const hash = Buffer.from(normalizedPath).toString("base64url");
  return path.join(LOCK_DIR, `${LOCK_PREFIX}${hash}.lock`);
}

/**
 * Attempts to acquire a lock for the given directory.
 * Returns true if the lock was acquired, false if another process holds it.
 */
export function acquireLock(watchDir: string): boolean {
  const lockFile = getLockFilePath(watchDir);

  try {
    if (fs.existsSync(lockFile)) {
      const content = fs.readFileSync(lockFile, "utf-8");
      const pid = Number.parseInt(content.trim(), 10);

      if (!Number.isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          fs.unlinkSync(lockFile);
        }
      }
    }

    fs.writeFileSync(lockFile, process.pid.toString(), { flag: "wx" });
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

/**
 * Releases the lock for the given directory.
 * Only removes the lock file if this process owns it.
 */
export function releaseLock(watchDir: string): void {
  const lockFile = getLockFilePath(watchDir);

  try {
    if (fs.existsSync(lockFile)) {
      const content = fs.readFileSync(lockFile, "utf-8");
      const pid = Number.parseInt(content.trim(), 10);

      if (pid === process.pid) {
        fs.unlinkSync(lockFile);
      }
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Checks if a lock exists for the given directory.
 * Returns true if the lock is held by a running process.
 */
export function isLocked(watchDir: string): boolean {
  const lockFile = getLockFilePath(watchDir);

  try {
    if (!fs.existsSync(lockFile)) {
      return false;
    }

    const content = fs.readFileSync(lockFile, "utf-8");
    const pid = Number.parseInt(content.trim(), 10);

    if (Number.isNaN(pid)) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
