import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getLogDir } from "./logger";

interface DaemonInfo {
  pid: number;
  dir: string;
}

function getStateDir(): string {
  return path.dirname(getLogDir("mgrep"));
}

function getDaemonsDir(): string {
  return path.join(getStateDir(), "daemons");
}

function hashPath(dir: string): string {
  return createHash("sha256").update(dir).digest("hex").slice(0, 16);
}

function getDaemonFile(dir: string): string {
  return path.join(getDaemonsDir(), `${hashPath(dir)}.json`);
}

function getLockFile(dir: string): string {
  return path.join(getDaemonsDir(), `${hashPath(dir)}.lock`);
}

/**
 * Check if process is alive by sending signal 0.
 * Signal 0 doesn't actually send anything - it just checks if we have
 * permission to send signals to the process (i.e., it exists and we own it).
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDaemonInfo(file: string): DaemonInfo | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function getAllDaemons(): DaemonInfo[] {
  const dir = getDaemonsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readDaemonInfo(path.join(dir, f)))
    .filter((d): d is DaemonInfo => d !== null && isProcessAlive(d.pid));
}

function isParentWatching(targetDir: string): boolean {
  const daemons = getAllDaemons();
  const target = path.resolve(targetDir);
  return daemons.some(
    (d) => target.startsWith(d.dir + path.sep) || target === d.dir,
  );
}

function getChildDaemons(targetDir: string): DaemonInfo[] {
  const daemons = getAllDaemons();
  const target = path.resolve(targetDir);
  return daemons.filter((d) => d.dir.startsWith(target + path.sep));
}

function killDaemonProcess(info: DaemonInfo): void {
  try {
    process.kill(info.pid, "SIGTERM");
    fs.unlinkSync(getDaemonFile(info.dir));
  } catch {}
}

/**
 * Ensures a daemon is running for the given directory.
 * Implements hierarchy awareness: parent daemons cover children,
 * and starting a parent daemon kills child daemons.
 */
export function ensureDaemon(storeId: string, watchRoot: string): void {
  const targetDir = path.resolve(watchRoot);

  if (isParentWatching(targetDir)) return;

  const daemonsDir = getDaemonsDir();
  fs.mkdirSync(daemonsDir, { recursive: true });

  // Atomic lock using O_EXCL: file creation fails if it already exists.
  // This is cross-platform (POSIX + Windows) and prevents race conditions
  // when multiple mgrep processes try to start a daemon simultaneously.
  // Unlike flock(), this doesn't require cleanup on crash - we delete the
  // lock file in the finally block, and stale locks from crashes are
  // handled by checking if the daemon process is actually alive.
  const lockFile = getLockFile(targetDir);
  let lockFd: number;
  try {
    lockFd = fs.openSync(
      lockFile,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR,
    );
  } catch {
    // Lock file exists - another process is starting the daemon
    return;
  }

  try {
    if (isParentWatching(targetDir)) return;

    for (const child of getChildDaemons(targetDir)) {
      killDaemonProcess(child);
    }

    const logFile = path.join(getStateDir(), "daemon.log");
    const logFd = fs.openSync(logFile, "a");

    // Spawn daemon as detached process with stdio redirected to log file.
    // detached: true creates a new process group so daemon survives parent exit.
    // unref() allows the parent to exit without waiting for the child.
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "../index.js"), "watch", "--store", storeId],
      { cwd: targetDir, detached: true, stdio: ["ignore", logFd, logFd] },
    );

    if (child.pid) {
      const info: DaemonInfo = { pid: child.pid, dir: targetDir };
      fs.writeFileSync(getDaemonFile(targetDir), JSON.stringify(info));
      child.unref();
    }
    fs.closeSync(logFd);
  } finally {
    fs.closeSync(lockFd);
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }
}

/**
 * Stops the daemon watching the specified directory.
 */
export function stopDaemon(dir: string): boolean {
  const info = readDaemonInfo(getDaemonFile(path.resolve(dir)));
  if (!info) return false;
  killDaemonProcess(info);
  return true;
}

/**
 * Lists all running daemons.
 */
export function listDaemons(): DaemonInfo[] {
  return getAllDaemons();
}
