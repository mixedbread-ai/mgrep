import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { ensureAuthenticated } from "../lib/utils";
import { promisify } from "node:util";
import { exec } from "node:child_process";

const PLUGIN_ROOT =
  process.env.DROID_PLUGIN_ROOT ||
  path.resolve(__dirname, "../../dist/plugins/mgrep");
const PLUGIN_SKILL_PATH = path.join(PLUGIN_ROOT, "skills", "mgrep", "SKILL.md");

const shell =
  process.env.SHELL ||
  (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");

const execAsync = promisify(exec);


type HookCommand = {
  type: "command";
  command: string;
  timeout: number;
};

type HookEntry = {
  matcher?: string | null;
  hooks: HookCommand[];
};

type HooksConfig = Record<string, HookEntry[]>;

type Settings = {
  hooks?: HooksConfig;
  enableHooks?: boolean;
  allowBackgroundProcesses?: boolean;
} & Record<string, unknown>;

function resolveDroidRoot(): string {
  const root = path.join(os.homedir(), ".factory");
  if (!fs.existsSync(root)) {
    throw new Error(
      `Factory Droid directory not found at ${root}. Start Factory Droid once to initialize it, then re-run the install.`,
    );
  }
  return root;
}

function writeFileIfChanged(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const already = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8")
    : undefined;
  if (already !== content) {
    fs.writeFileSync(filePath, content);
  }
}

function readPluginAsset(assetPath: string): string {
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Plugin asset missing: ${assetPath}`);
  }
  return fs.readFileSync(assetPath, "utf-8");
}

function parseJsonWithComments(content: string): Record<string, unknown> {
  const stripped = content
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
  const parsed: unknown = JSON.parse(stripped);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Factory Droid settings must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function loadSettings(settingsPath: string): Settings {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  const raw = fs.readFileSync(settingsPath, "utf-8");
  const parsed = parseJsonWithComments(raw);
  return parsed as Settings;
}

function saveSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function isHooksConfig(value: unknown): value is HooksConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => Array.isArray(entry));
}

async function installPlugin() {
  const root = resolveDroidRoot();
  const skillsDir = path.join(root, "skills", "mgrep");

  const skillContent = readPluginAsset(PLUGIN_SKILL_PATH);

  writeFileIfChanged(
    path.join(skillsDir, "SKILL.md"),
    skillContent.trimStart(),
  );

    await execAsync("droid mcp add mgrep -- mgrep mcp", {
      shell,
      env: process.env,
    });

  console.log(
    `Installed the mgrep hooks and skill for Factory Droid in ${root}`,
  );
}

async function uninstallPlugin() {
  const root = resolveDroidRoot();
  const hooksDir = path.join(root, "hooks", "mgrep");
  const skillsDir = path.join(root, "skills", "mgrep");
  const settingsPath = path.join(root, "settings.json");

  if (fs.existsSync(hooksDir)) {
    fs.rmSync(hooksDir, { recursive: true, force: true });
    console.log("Removed mgrep hooks from Factory Droid");
  } else {
    console.log("No mgrep hooks found for Factory Droid");
  }

  if (fs.existsSync(skillsDir)) {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    console.log("Removed mgrep skill from Factory Droid");
  } else {
    console.log("No mgrep skill found for Factory Droid");
  }

  if (fs.existsSync(settingsPath)) {
    try {
      const settings = loadSettings(settingsPath);
      const hooks = isHooksConfig(settings.hooks) ? settings.hooks : undefined;
      if (hooks) {
        for (const event of Object.keys(hooks)) {
          const filtered = hooks[event].filter(
            (entry) =>
              entry?.hooks?.[0]?.command !==
                `python3 "${path.join(hooksDir, "mgrep_watch.py")}"` &&
              entry?.hooks?.[0]?.command !==
                `python3 "${path.join(hooksDir, "mgrep_watch_kill.py")}"`,
          );
          if (filtered.length === 0) {
            delete hooks[event];
          } else {
            hooks[event] = filtered;
          }
        }
        if (Object.keys(hooks).length === 0) {
          delete settings.hooks;
        }
        saveSettings(settingsPath, settings as Record<string, unknown>);
      }
    } catch (error) {
    }
  }

  await execAsync("droid mcp remove mgrep", {
    shell,
    env: process.env,
  });

  console.log("Removed mgrep from Factory Droid");
}

export const installDroid = new Command("install-droid")
  .description("Install the mgrep hooks and skill for Factory Droid")
  .action(async () => {
    await ensureAuthenticated();
    await installPlugin();
  });

export const uninstallDroid = new Command("uninstall-droid")
  .description("Uninstall the mgrep hooks and skill for Factory Droid")
  .action(async () => {
    await uninstallPlugin();
  });
