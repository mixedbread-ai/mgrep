import { Command } from "commander";
import pidCwd from "pid-cwd";
import psList from "ps-list";

interface WatcherInfo {
  pid: number;
  directory: string;
}

async function getWatchers(): Promise<WatcherInfo[]> {
  const processes = await psList();
  const watchers: WatcherInfo[] = [];

  for (const proc of processes) {
    const cmd = proc.cmd || "";
    if (cmd.includes("mgrep watch")) {
      const cwd = await pidCwd(proc.pid).catch(() => null);
      if (cwd) {
        watchers.push({ pid: proc.pid, directory: cwd });
      }
    }
  }

  return watchers;
}

export async function listAction(): Promise<void> {
  if (process.platform === "win32") {
    console.error("mgrep list is not supported on Windows.");
    process.exitCode = 1;
    return;
  }

  const watchers = await getWatchers();

  if (watchers.length === 0) {
    console.error("No active mgrep watch processes found.");
    process.exitCode = 0;
    return;
  }

  for (const w of watchers) {
    console.log(w.directory);
  }
}

export const list = new Command("list")
  .description("List active mgrep watch processes")
  .action(async () => {
    await listAction();
  });
