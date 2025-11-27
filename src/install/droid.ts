import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { ensureAuthenticated } from "../utils";

const PLUGIN_ROOT =
  process.env.DROID_PLUGIN_ROOT ||
  path.resolve(__dirname, "../../plugins/mgrep");
const PLUGIN_HOOKS_DIR = path.join(PLUGIN_ROOT, "hooks");
const PLUGIN_SKILL_PATH = path.join(
  PLUGIN_ROOT,
  "skills",
  "mgrep",
  "SKILL.md",
);

function resolveDroidRoot(): string {
  const root = path.join(os.homedir(), ".factory");
  return fs.existsSync(root) ? root : root;
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

function parseJsonWithComments(content: string): any {
  const stripped = content
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
  return JSON.parse(stripped);
}

function loadSettings(settingsPath: string): Record<string, unknown> {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  const raw = fs.readFileSync(settingsPath, "utf-8");
  return parseJsonWithComments(raw);
}

function saveSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function mergeHooks(
  existingHooks: Record<string, any> | undefined,
  newHooks: Record<string, any>,
): Record<string, any> {
  const merged: Record<string, any> = existingHooks
    ? JSON.parse(JSON.stringify(existingHooks))
    : {};
  for (const [event, entries] of Object.entries(newHooks)) {
    const current = Array.isArray(merged[event]) ? merged[event] : [];
    for (const entry of entries as any[]) {
      const command = entry?.hooks?.[0]?.command;
      const matcher = entry?.matcher ?? null;
      const duplicate = current.some(
        (item: any) =>
          item?.matcher === matcher &&
          item?.hooks?.[0]?.command === command &&
          item?.hooks?.[0]?.type === entry?.hooks?.[0]?.type,
      );
      if (!duplicate) {
        current.push(entry);
      }
    }
    merged[event] = current;
  }
  return merged;
}

async function installPlugin() {
  const root = resolveDroidRoot();
  const hooksDir = path.join(root, "hooks", "mgrep");
  const skillsDir = path.join(root, "skills", "mgrep");
  const settingsPath = path.join(root, "settings.json");

  const watchHook = readPluginAsset(
    path.join(PLUGIN_HOOKS_DIR, "mgrep_watch.py"),
  );
  const killHook = readPluginAsset(
    path.join(PLUGIN_HOOKS_DIR, "mgrep_watch_kill.py"),
  );
  const skillContent = readPluginAsset(PLUGIN_SKILL_PATH);

  const watchPy = path.join(hooksDir, "mgrep_watch.py");
  const killPy = path.join(hooksDir, "mgrep_watch_kill.py");
  writeFileIfChanged(watchPy, watchHook);
  writeFileIfChanged(killPy, killHook);

  const hookConfig = {
    SessionStart: [
      {
        matcher: "startup|resume",
        hooks: [
          {
            type: "command",
            command: `python3 "${watchPy}"`,
            timeout: 10,
          },
        ],
      },
    ],
    SessionEnd: [
      {
        hooks: [
          {
            type: "command",
            command: `python3 "${killPy}"`,
            timeout: 10,
          },
        ],
      },
    ],
  };
  writeFileIfChanged(
    path.join(skillsDir, "SKILL.md"),
    skillContent.trimStart(),
  );

  const settings = loadSettings(settingsPath);
  settings.enableHooks = true;
  settings.allowBackgroundProcesses = true;
  settings.hooks = mergeHooks(
    typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, any>)
      : {},
    hookConfig,
  );
  saveSettings(settingsPath, settings as Record<string, unknown>);

  console.log(`Installed the mgrep hooks and skill for Factory Droid in ${root}`);
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
      const settings = loadSettings(settingsPath) as Record<string, any>;
      if (
        settings.hooks &&
        typeof settings.hooks === "object" &&
        !Array.isArray(settings.hooks)
      ) {
        const removeCommand = (cmd: string) => {
          for (const event of Object.keys(settings.hooks)) {
            settings.hooks[event] = (settings.hooks[event] as any[]).filter(
              (entry: any) => entry?.hooks?.[0]?.command !== cmd,
            );
          }
        };
        removeCommand(`python3 "${path.join(hooksDir, "mgrep_watch.py")}"`);
        removeCommand(`python3 "${path.join(hooksDir, "mgrep_watch_kill.py")}"`);
        saveSettings(settingsPath, settings as Record<string, unknown>);
      }
    } catch (error) {
      console.warn(
        `Failed to update Factory Droid settings during uninstall: ${error}`,
      );
    }
  }
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
