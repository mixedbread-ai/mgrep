import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".mgrep");
const UPDATE_CHECK_FILE = path.join(CONFIG_DIR, "update-check.json");
const REGISTRY_URL = "https://registry.npmjs.org/@mixedbread/mgrep/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_TIMEOUT_MS = 3000;
const SNOOZE_DEFAULT_DAYS = 1;

export interface UpdateCheckCache {
  latestVersion: string;
  checkedAt: string;
  snoozedUntil?: string;
}

/**
 * Reads the cached update-check state. Returns null on missing or corrupt file.
 */
export async function getCachedUpdate(): Promise<UpdateCheckCache | null> {
  try {
    const raw = await fs.readFile(UPDATE_CHECK_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.latestVersion === "string" &&
      typeof parsed?.checkedAt === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCachedUpdate(data: UpdateCheckCache) {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(
      UPDATE_CHECK_FILE,
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  } catch {
    // Silent failure - we'll retry on next invocation
  }
}

async function deleteCachedUpdate() {
  try {
    await fs.unlink(UPDATE_CHECK_FILE);
  } catch {
    // Already absent
  }
}

/**
 * Records that the user declined the update prompt. Suppresses re-prompts
 * for the same latestVersion until the snooze window expires.
 */
export async function snoozeUpdate(
  latestVersion: string,
  days: number = SNOOZE_DEFAULT_DAYS,
) {
  const cached = await getCachedUpdate();
  const snoozedUntil = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toISOString();
  await writeCachedUpdate({
    latestVersion,
    checkedAt: cached?.checkedAt ?? new Date().toISOString(),
    snoozedUntil,
  });
}

/**
 * True if the cache is missing or the last check is older than the interval.
 */
export function shouldCheck(
  cached: UpdateCheckCache | null,
  intervalMs: number = CHECK_INTERVAL_MS,
) {
  if (!cached) return true;
  const checkedAt = Date.parse(cached.checkedAt);
  if (Number.isNaN(checkedAt)) return true;
  return Date.now() - checkedAt > intervalMs;
}

/**
 * True if the user is currently snoozed against the given latest version.
 * A new latest version invalidates the snooze.
 */
export function isSnoozed(
  cached: UpdateCheckCache | null,
  latestVersion: string,
) {
  if (!cached?.snoozedUntil) return false;
  if (cached.latestVersion !== latestVersion) return false;
  const snoozedUntil = Date.parse(cached.snoozedUntil);
  if (Number.isNaN(snoozedUntil)) return false;
  return snoozedUntil > Date.now();
}

/**
 * Naive semver comparison. Pre-release versions (containing "-") are ignored
 * entirely - we only ever signal stable updates.
 */
export function isNewer(latest: string, current: string) {
  if (latest.includes("-") || current.includes("-")) return false;
  const latestParts = latest.split(".").map((p) => Number.parseInt(p, 10));
  const currentParts = current.split(".").map((p) => Number.parseInt(p, 10));
  if (latestParts.some(Number.isNaN) || currentParts.some(Number.isNaN))
    return false;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Spawns a detached, unref'd child process re-execing the same binary with
 * MGREP_INTERNAL_VERSION_CHECK=1, which triggers the registry fetch path in
 * src/index.ts. Fire-and-forget - never blocks or surfaces errors.
 */
export function triggerBackgroundCheck() {
  try {
    const binary = process.argv[1];
    if (!binary) return;
    const child = spawn(process.execPath, [binary], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, MGREP_INTERNAL_VERSION_CHECK: "1" },
    });
    child.unref();
  } catch {
    // Silent - retry next invocation
  }
}

/**
 * Worker side: fetches the latest version from the npm registry. If newer
 * than currentVersion, writes it to the cache file. Otherwise deletes the
 * cache file so the SessionStart hook (which reads blindly) doesn't surface
 * stale notices. Hard 3s timeout. All errors swallowed silently.
 */
export async function runVersionCheck(currentVersion: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(REGISTRY_URL, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return;

    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== "string") return;

    const latest = body.version;
    if (!isNewer(latest, currentVersion)) {
      await deleteCachedUpdate();
      return;
    }
    const existing = await getCachedUpdate();
    await writeCachedUpdate({
      latestVersion: latest,
      checkedAt: new Date().toISOString(),
      snoozedUntil:
        existing?.snoozedUntil && existing.latestVersion === latest
          ? existing.snoozedUntil
          : undefined,
    });
  } catch {
    // Silent
  }
}
