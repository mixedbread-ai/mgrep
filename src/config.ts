import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type MgrepConfig = {
  store?: string;
  authUrl?: string;
  telemetry?: boolean;
  logLevel?: "info" | "silent";
};

const DEFAULT_CONFIG: MgrepConfig = {
  store: "mgrep",
  telemetry: true,
  logLevel: "info",
};

export function getConfigDir(customDir?: string): string {
  if (customDir) return customDir;
  if (process.env.MGREP_CONFIG_DIR) return process.env.MGREP_CONFIG_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "mgrep");
  }
  return path.join(os.homedir(), ".config", "mgrep");
}

export function getConfigPath(customDir?: string): string {
  return path.join(getConfigDir(customDir), "config.json");
}

export function loadConfig(options?: { configDir?: string }): MgrepConfig {
  const filePath = getConfigPath(options?.configDir);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    console.warn("Failed to read mgrep config, falling back to defaults", err);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: MgrepConfig, options?: { configDir?: string }): void {
  const dir = getConfigDir(options?.configDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = getConfigPath(options?.configDir);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function updateConfig(updater: (current: MgrepConfig) => MgrepConfig, options?: { configDir?: string }): MgrepConfig {
  const current = loadConfig(options);
  const next = updater(current);
  saveConfig(next, options);
  return next;
}
