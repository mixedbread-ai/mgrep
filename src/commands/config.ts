import * as fs from "node:fs";
import type { Command } from "commander";
import { Command as CommanderCommand } from "commander";
import {
  CONFIG_KEYS,
  type ConfigKey,
  DEFAULT_CONFIG,
  getGlobalConfigFilePath,
  readGlobalConfig,
  writeGlobalConfig,
} from "../lib/config.js";

/**
 * Parses a string value into the correct type for a given config key.
 *
 * @param key - The config key
 * @param value - The raw string value
 * @returns The parsed value
 */
function parseConfigValue(
  key: ConfigKey,
  value: string,
): number | boolean {
  switch (key) {
    case "maxFileSize":
    case "maxFileCount": {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Value for "${key}" must be a positive integer.`);
      }
      return parsed;
    }
    case "shared": {
      const lower = value.toLowerCase();
      if (
        lower === "true" ||
        lower === "1" ||
        lower === "yes" ||
        lower === "y"
      ) {
        return true;
      }
      if (
        lower === "false" ||
        lower === "0" ||
        lower === "no" ||
        lower === "n"
      ) {
        return false;
      }
      throw new Error(
        `Value for "${key}" must be a boolean (true/false, 1/0, yes/no).`,
      );
    }
  }
}

/**
 * Validates that a string is a valid config key.
 *
 * @param key - The string to validate
 * @returns The validated config key
 */
function validateKey(key: string): ConfigKey {
  if (!CONFIG_KEYS.includes(key as ConfigKey)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}`,
    );
  }
  return key as ConfigKey;
}

const set = new CommanderCommand("set")
  .description("Set a global config value")
  .argument("<key>", `Config key (${CONFIG_KEYS.join(", ")})`)
  .argument("<value>", "Config value")
  .action((rawKey: string, rawValue: string) => {
    try {
      const key = validateKey(rawKey);
      const value = parseConfigValue(key, rawValue);
      writeGlobalConfig({ [key]: value });
      console.log(`Set ${key} = ${value}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

const get = new CommanderCommand("get")
  .description("Get a global config value")
  .argument("<key>", `Config key (${CONFIG_KEYS.join(", ")})`)
  .action((rawKey: string) => {
    try {
      const key = validateKey(rawKey);
      const globalConfig = readGlobalConfig();
      const value = globalConfig[key];
      if (value === undefined) {
        console.log(`${key} = ${DEFAULT_CONFIG[key]} (default)`);
      } else {
        console.log(`${key} = ${value}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

const list = new CommanderCommand("list")
  .description("List all global config values")
  .action(() => {
    const globalConfig = readGlobalConfig();
    for (const key of CONFIG_KEYS) {
      const value = globalConfig[key];
      if (value === undefined) {
        console.log(`${key} = ${DEFAULT_CONFIG[key]} (default)`);
      } else {
        console.log(`${key} = ${value}`);
      }
    }
  });

const reset = new CommanderCommand("reset")
  .description("Reset global config to defaults")
  .argument("[key]", "Config key to reset (omit to reset all)")
  .action((rawKey?: string) => {
    try {
      if (rawKey) {
        const key = validateKey(rawKey);
        const globalConfig = readGlobalConfig();
        delete globalConfig[key];
        const filePath = getGlobalConfigFilePath();
        if (Object.keys(globalConfig).length === 0) {
          fs.unlinkSync(filePath);
        } else {
          writeGlobalConfig(globalConfig);
        }
        console.log(`Reset ${key} to default (${DEFAULT_CONFIG[key]})`);
      } else {
        const filePath = getGlobalConfigFilePath();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        console.log("Reset all config to defaults");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

export const config: Command = new CommanderCommand("config")
  .description("Manage global mgrep configuration")
  .addCommand(set)
  .addCommand(get)
  .addCommand(list)
  .addCommand(reset);
