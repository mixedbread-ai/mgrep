import { Command } from 'commander';
import psList from 'ps-list';
import pidCwd from 'pid-cwd';

interface WatcherInfo {
  pid: number;
  directory: string;
}

async function getWatchers(): Promise<WatcherInfo[]> {
  const processes = await psList();
  const watchers: WatcherInfo[] = [];

  for (const proc of processes) {
    const cmd = proc.cmd || '';
    if (cmd.includes('mgrep') && cmd.includes('watch')) {
      const cwd = await pidCwd(proc.pid).catch(() => null);
      if (cwd) {
        watchers.push({ pid: proc.pid, directory: cwd });
      }
    }
  }

  return watchers;
}

export async function listAction(): Promise<void> {
  const watchers = await getWatchers();

  if (watchers.length === 0) {
    console.log('No active mgrep watch processes found.');
    return;
  }

  for (const w of watchers) {
    console.log(w.directory);
  }
}

export const list = new Command('list')
  .description('List active mgrep watch processes')
  .action(async () => {
    await listAction();
  });
