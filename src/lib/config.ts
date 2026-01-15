import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const LOCAL_CONFIG_FILES = [".mgreprc.yaml", ".mgreprc.yml"] as const;
const GLOBAL_CONFIG_DIR = ".config/mgrep";
const GLOBAL_CONFIG_FILES = ["config.yaml", "config.yml"] as const;
const ENV_PREFIX = "MGREP_";
const DEFAULT_MAX_FILE_SIZE = 1 * 1024 * 1024;
const DEFAULT_MAX_FILE_COUNT = 1000;

const ConfigSchema = z.object({
  maxFileSize: z.number().positive().optional(),
  maxFileCount: z.number().positive().optional(),
});

/**
 * CLI options that can override config
 */
export interface CliConfigOptions {
  maxFileSize?: number;
  maxFileCount?: number;
}

/**
 * Mgrep configuration options
 */
export interface MgrepConfig {
  /**
   * Maximum file size in bytes that is allowed to upload.
   * Files larger than this will be skipped during sync.
   * @default 1048576 (1 MB)
   */
  maxFileSize: number;

  /**
   * Maximum number of files that can be uploaded in a single sync operation.
   * If the folder contains more files than this limit, an error will be thrown.
   * @default 1000
   */
  maxFileCount: number;
}

const DEFAULT_CONFIG: MgrepConfig = {
  maxFileSize: DEFAULT_MAX_FILE_SIZE,
  maxFileCount: DEFAULT_MAX_FILE_COUNT,
};

const configCache = new Map<string, MgrepConfig>();

/**
 * Reads and parses a YAML config file
 *
 * @param filePath - The path to the config file
 * @returns The parsed config object or null if file doesn't exist or is invalid
 */
function readYamlConfig(filePath: string): Partial<MgrepConfig> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(content);
    const validated = ConfigSchema.parse(parsed);
    return validated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Warning: Failed to parse config file ${filePath}: ${message}`,
    );
    return null;
  }
}

/**
 * Finds and reads the first existing config file from a list of candidates
 *
 * @param candidates - List of file paths to check
 * @returns The parsed config or null if none found
 */
function findConfig(candidates: string[]): Partial<MgrepConfig> | null {
  for (const filePath of candidates) {
    const config = readYamlConfig(filePath);
    if (config !== null) {
      return config;
    }
  }
  return null;
}

function getGlobalConfigPaths(): string[] {
  const configDir = path.join(os.homedir(), GLOBAL_CONFIG_DIR);
  return GLOBAL_CONFIG_FILES.map((file) => path.join(configDir, file));
}

function getLocalConfigPaths(dir: string): string[] {
  return LOCAL_CONFIG_FILES.map((file) => path.join(dir, file));
}

/**
 * Loads configuration from environment variables
 *
 * @returns The config values from environment variables
 */
function loadEnvConfig(): Partial<MgrepConfig> {
  const config: Partial<MgrepConfig> = {};

  const maxFileSizeEnv = process.env[`${ENV_PREFIX}MAX_FILE_SIZE`];
  if (maxFileSizeEnv) {
    const parsed = Number.parseInt(maxFileSizeEnv, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.maxFileSize = parsed;
    }
  }

  const maxFileCountEnv = process.env[`${ENV_PREFIX}MAX_FILE_COUNT`];
  if (maxFileCountEnv) {
    const parsed = Number.parseInt(maxFileCountEnv, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.maxFileCount = parsed;
    }
  }

  return config;
}

/**
 * Loads mgrep configuration with the following precedence (highest to lowest):
 * 1. CLI flags (passed as cliOptions)
 * 2. Environment variables (MGREP_MAX_FILE_SIZE, MGREP_MAX_FILE_COUNT)
 * 3. Local config file (.mgreprc.yaml or .mgreprc.yml in project directory)
 * 4. Global config file (~/.config/mgrep/config.yaml or config.yml)
 * 5. Default values
 *
 * @param dir - The directory to load local configuration from
 * @param cliOptions - CLI options that override all other config sources
 * @returns The merged configuration
 */
export function loadConfig(
  dir: string,
  cliOptions: CliConfigOptions = {},
): MgrepConfig {
  const absoluteDir = path.resolve(dir);
  const cacheKey = `${absoluteDir}:${JSON.stringify(cliOptions)}`;

  if (configCache.has(cacheKey)) {
    return configCache.get(cacheKey) as MgrepConfig;
  }

  const globalConfig = findConfig(getGlobalConfigPaths());
  const localConfig = findConfig(getLocalConfigPaths(absoluteDir));
  const envConfig = loadEnvConfig();

  const config: MgrepConfig = {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...localConfig,
    ...envConfig,
    ...filterUndefinedCliOptions(cliOptions),
  };

  configCache.set(cacheKey, config);
  return config;
}

function filterUndefinedCliOptions(
  options: CliConfigOptions,
): Partial<MgrepConfig> {
  const result: Partial<MgrepConfig> = {};
  if (options.maxFileSize !== undefined) {
    result.maxFileSize = options.maxFileSize;
  }
  if (options.maxFileCount !== undefined) {
    result.maxFileCount = options.maxFileCount;
  }
  return result;
}

/**
 * Clears the configuration cache.
 * Useful for testing or when config files may have changed.
 */
export function clearConfigCache(): void {
  configCache.clear();
}

/**
 * Checks if a file exceeds the maximum allowed file size
 *
 * @param filePath - The path to the file to check
 * @param maxFileSize - The maximum allowed file size in bytes
 * @returns True if the file exceeds the limit, false otherwise
 */
export function exceedsMaxFileSize(
  filePath: string,
  maxFileSize: number,
): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.size > maxFileSize;
  } catch {
    return false;
  }
}

/**
 * Formats a file size in bytes to a human-readable string
 *
 * @param bytes - The file size in bytes
 * @returns Human-readable file size string
 */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}
