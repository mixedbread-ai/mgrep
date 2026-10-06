import { readFileSync } from "node:fs";

/**
 * Reads the version from the installed package relative to this module.
 * @returns The package version used by the CLI and MCP server.
 */
export function getPackageVersion(): string {
  return JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
  ).version as string;
}
