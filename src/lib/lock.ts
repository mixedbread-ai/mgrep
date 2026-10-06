import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hasLocalConfig } from "./config.js";
import { isSubpath } from "./utils.js";

/** An active watcher's exclusive directory claim. */
export interface WatchClaim {
  pid: number;
  root: string;
  store: string;
  startedAt: number;
}

const INVALID_CLAIM_STALE_MS = 30_000;

function registryDir(): string {
  const dir =
    process.env.MGREP_WATCH_REGISTRY_DIR ??
    path.join(os.homedir(), ".mgrep", "watchers");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function claimPath(store: string, root: string): string {
  const name = Buffer.from(`${store}\0${root}`).toString("base64url");
  return path.join(registryDir(), `${name}.json`);
}

function readClaim(file: string): WatchClaim | undefined {
  try {
    const claim: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      typeof claim === "object" &&
      claim !== null &&
      "pid" in claim &&
      typeof claim.pid === "number" &&
      Number.isInteger(claim.pid) &&
      claim.pid > 0 &&
      "root" in claim &&
      typeof claim.root === "string" &&
      path.isAbsolute(claim.root) &&
      "store" in claim &&
      typeof claim.store === "string" &&
      "startedAt" in claim &&
      typeof claim.startedAt === "number" &&
      Number.isFinite(claim.startedAt)
    ) {
      return claim as WatchClaim;
    }
  } catch {
    // A concurrent O_EXCL writer may not have finished writing its JSON yet.
  }
  return undefined;
}

function isMgrepProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).includes("mgrep");
  } catch {
    return true;
  }
}

function unlinkClaim(file: string, claim: WatchClaim): void {
  try {
    const current = readClaim(file);
    if (current?.pid === claim.pid && current.startedAt === claim.startedAt) {
      fs.unlinkSync(file);
    }
  } catch {
    // Another process may already have removed the claim.
  }
}

function unlinkStaleInvalidClaim(file: string): boolean {
  try {
    const before = fs.statSync(file);
    if (Date.now() - before.mtimeMs <= INVALID_CLAIM_STALE_MS) return false;
    if (readClaim(file)) return false;
    const current = fs.statSync(file);
    // Preserve a concurrent writer's replacement or newly updated claim.
    if (
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.mtimeMs !== before.mtimeMs ||
      current.size !== before.size
    ) {
      return false;
    }
    fs.unlinkSync(file);
    return true;
  } catch {
    // Another process may already have removed the claim.
    return false;
  }
}

/**
 * Claims a canonical directory using the upstream lock design's O_EXCL write.
 * @param store - Store identifier
 * @param root - Directory to watch (resolved to its realpath)
 * @param startedAt - Session start timestamp
 * @returns The owned claim, or null when a live process holds it
 */
export function claimWatch(
  store: string,
  root: string,
  startedAt: number,
): WatchClaim | null {
  const claim = {
    pid: process.pid,
    root: fs.realpathSync(root),
    store,
    startedAt,
  };
  const file = claimPath(store, claim.root);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(claim), { flag: "wx" });
      return claim;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
      const existing = readClaim(file);
      if (!existing) {
        if (!unlinkStaleInvalidClaim(file)) return null;
      } else {
        if (isMgrepProcess(existing.pid)) return null;
        unlinkClaim(file, existing);
      }
    }
  }
  return null;
}

/**
 * Releases a claim only while its file still belongs to this pid.
 * @param claim - Owned directory claim
 * @returns Nothing
 */
export function releaseWatch(claim: WatchClaim): void {
  try {
    if (claim.pid === process.pid) {
      unlinkClaim(claimPath(claim.store, claim.root), claim);
    }
  } catch {
    // Cleanup must remain safe even if the registry directory becomes unavailable.
  }
}

/**
 * Restores a missing claim with O_EXCL, without replacing another owner.
 * @param claim - Owned directory claim
 * @returns Nothing
 */
export function ensureClaim(claim: WatchClaim): void {
  try {
    fs.writeFileSync(
      claimPath(claim.store, claim.root),
      JSON.stringify(claim),
      {
        flag: "wx",
      },
    );
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "EEXIST")
    ) {
      throw error;
    }
  }
}

/**
 * Lists live watchers and prunes dead pids and invalid claims older than 30 seconds.
 * @param store - Store identifier
 * @returns Live claims for the store
 */
export function listActiveWatches(store: string): WatchClaim[] {
  const dir = registryDir();
  const claims: WatchClaim[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    const claim = readClaim(file);
    if (!claim) {
      unlinkStaleInvalidClaim(file);
      continue;
    }
    if (!isMgrepProcess(claim.pid)) {
      unlinkClaim(file, claim);
    } else if (claim.store === store) {
      claims.push(claim);
    }
  }
  return claims;
}

/**
 * Finds the earliest watcher covering a directory without crossing local config.
 * @param root - Canonical directory to cover
 * @param mine - This session's timestamp and pid, used to order claims
 * @param claims - Live claims on the same store
 * @returns The covering earlier watcher, if any
 */
export function findCoveringWatch(
  root: string,
  mine: { startedAt: number; pid: number },
  claims: WatchClaim[],
): WatchClaim | undefined {
  const realRoot = fs.realpathSync(root);
  return claims
    .filter((claim) => {
      if (
        claim.pid === mine.pid ||
        claim.startedAt > mine.startedAt ||
        (claim.startedAt === mine.startedAt && claim.pid >= mine.pid)
      )
        return false;
      let claimRoot: string;
      try {
        claimRoot = fs.realpathSync(claim.root);
      } catch {
        return false;
      }
      if (claimRoot === realRoot) return true;
      if (!isSubpath(claimRoot, realRoot)) return false;
      for (let dir = realRoot; dir !== claimRoot; dir = path.dirname(dir)) {
        if (hasLocalConfig(dir)) return false;
      }
      return true;
    })
    .sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid)[0];
}
