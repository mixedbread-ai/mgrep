import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getConfigDir, getConfigPath, loadConfig, saveConfig, updateConfig, MgrepConfig } from "./config";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mgrep-config-test-"));
}

describe("config helpers", () => {
  it("computes config dir", () => {
    const custom = getConfigDir("/tmp/mgrep");
    expect(custom).toBe("/tmp/mgrep");
  });

  it("loads defaults when file missing", () => {
    const dir = tempDir();
    const config = loadConfig({ configDir: dir });
    expect(config.store).toBe("mgrep");
  });

  it("saves and loads config", () => {
    const dir = tempDir();
    const config: MgrepConfig = { store: "custom", telemetry: false };
    saveConfig(config, { configDir: dir });
    const roundTrip = loadConfig({ configDir: dir });
    expect(roundTrip.store).toBe("custom");
    expect(roundTrip.telemetry).toBe(false);
  });

  it("updates config", () => {
    const dir = tempDir();
    const updated = updateConfig((current) => ({ ...current, store: "abc" }), { configDir: dir });
    expect(updated.store).toBe("abc");
    const reread = loadConfig({ configDir: dir });
    expect(reread.store).toBe("abc");
  });

  it("returns config path", () => {
    const dir = tempDir();
    const configPath = getConfigPath(dir);
    expect(configPath.startsWith(dir)).toBe(true);
  });
});
