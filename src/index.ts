#!/usr/bin/env node
import { program, Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import chokidar from "chokidar";
import { Mixedbread, toFile } from "@mixedbread/sdk";
import {
  isIgnoredByGit,
  getGitRepoFiles,
  computeBufferHash,
  getGitRoot,
  getRepoRelativePath,
} from "./utils";
import { CredentialsStore, resolveCredentials, type CredentialResolutionResult } from "./auth";
import { loadConfig, saveConfig, updateConfig, getConfigPath, type MgrepConfig } from "./config";

const KNOWN_COMMANDS = new Set([
  "search",
  "sync",
  "status",
  "watch",
  "logout",
  "config",
  "stores",
]);

type GlobalCLIOptions = {
  apiKey?: string;
  store?: string;
  authUrl?: string;
  nonInteractive?: boolean;
  config?: string;
  verbose?: boolean;
};

type StoreFileCacheEntry = {
  id: string;
  hash?: string;
};

type StoreFileCache = Map<string, StoreFileCacheEntry>;

type ClientContext = {
  client: Mixedbread;
  credentials: CredentialResolutionResult;
  storeIdentifier: string;
  config: MgrepConfig;
  configDir?: string;
};

function getConfigContext(options: GlobalCLIOptions): { config: MgrepConfig; configDir?: string } {
  const configDir = options.config;
  const config = loadConfig({ configDir });
  return { config, configDir };
}

function telemetryEnabled(config: MgrepConfig): boolean {
  if (process.env.MGREP_DISABLE_TELEMETRY?.toLowerCase() === "true") {
    return false;
  }
  return config.telemetry !== false;
}

async function createClientContext(
  opts: GlobalCLIOptions,
  ensureStoreCreation = true,
): Promise<ClientContext> {
  const { config, configDir } = getConfigContext(opts);
  const storePreference = opts.store ?? config.store;
  const authUrl = opts.authUrl ?? config.authUrl;
  const credentialsStore = new CredentialsStore(configDir);
  const credentials = await resolveCredentials(
    {
      cliApiKey: opts.apiKey,
      cliStore: storePreference,
      authUrl,
      nonInteractive: opts.nonInteractive,
      configDir,
    },
    { credentialsStore },
  );

  const client = new Mixedbread({ apiKey: credentials.apiKey });
  const storeIdentifier = ensureStoreCreation
    ? await ensureStore(client, opts.store ?? config.store ?? credentials.store)
    : opts.store ?? config.store ?? credentials.store ?? "mgrep";

  return { client, credentials, storeIdentifier, config, configDir };
}

function mergeConfigValue(config: MgrepConfig, key: string, value: string): MgrepConfig {
  switch (key) {
    case "store":
      return { ...config, store: value };
    case "authUrl":
      return { ...config, authUrl: value || undefined };
    case "telemetry":
      return { ...config, telemetry: !isFalseLike(value) };
    case "logLevel":
      return { ...config, logLevel: value === "silent" ? "silent" : "info" };
    default:
      throw new Error(`Unknown config key: ${key}`);
  }
}

function isFalseLike(value: string): boolean {
  return ["0", "false", "no", "off"].includes(value.toLowerCase());
}

async function listStoreFileInfos(client: Mixedbread, store: string): Promise<StoreFileCache> {
  const byExternalId: StoreFileCache = new Map();
  let after: string | null | undefined = undefined;
  do {
    const resp = await client.stores.files.list(store, { limit: 100, after });
    for (const f of resp.data) {
      const externalId = f.external_id ?? undefined;
      if (!externalId) continue;
      const metadata = (f.metadata as any) || {};
      const hash: string | undefined = typeof metadata?.hash === "string" ? metadata.hash : undefined;
      byExternalId.set(externalId, {
        id: f.id,
        hash,
      });
    }
    after = resp.pagination?.has_more ? resp.pagination?.last_cursor ?? undefined : undefined;
  } while (after);
  return byExternalId;
}

function filterRepoFiles(files: string[], repoRoot: string): string[] {
  const filtered: string[] = [];
  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    if (isIgnoredByGit(filePath, repoRoot)) continue;
    filtered.push(filePath);
  }
  return filtered;
}

async function uploadFile(
  client: Mixedbread,
  store: string,
  filePath: string,
  repoRelativePath: string,
  cache: StoreFileCache,
  buffer?: Buffer,
): Promise<StoreFileCacheEntry> {
  const fileBuffer = buffer ?? fs.readFileSync(filePath);
  const hash = computeBufferHash(fileBuffer);
  const file = await toFile(fileBuffer, repoRelativePath, { type: "text/plain" });
  const uploaded = await client.stores.files.upload(
    store,
    file,
    {
      external_id: repoRelativePath,
      overwrite: true,
      metadata: {
        path: repoRelativePath,
        hash,
      },
    },
  );
  const entry = {
    id: uploaded.id,
    hash,
  };
  cache.set(repoRelativePath, entry);
  return entry;
}

async function initialSync(client: Mixedbread, store: string, repoRoot: string): Promise<StoreFileCache> {
  const remoteFiles = await listStoreFileInfos(client, store);
  const repoFiles = filterRepoFiles(getGitRepoFiles(repoRoot), repoRoot);
  for (const filePath of repoFiles) {
    try {
      const buffer = fs.readFileSync(filePath);
      const hash = computeBufferHash(buffer);
      const repoRelativePath = getRepoRelativePath(filePath, repoRoot);
      if (repoRelativePath === null) {
        continue;
      }
      const existingEntry = remoteFiles.get(repoRelativePath);
      if (!existingEntry || existingEntry.hash !== hash) {
        await uploadFile(client, store, filePath, repoRelativePath, remoteFiles, buffer);
        console.log(`Uploaded initial ${repoRelativePath}`);
      }
    } catch (err) {
      console.error("Failed to process initial file:", filePath, err);
    }
  }
  return remoteFiles;
}

program
  .version(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "../package.json"), {
        encoding: "utf-8",
      }),
    ).version,
  )
  .option("--api-key <string>", "The API key to use")
  .option("--store <string>", "The store to use")
  .option("--auth-url <string>", "Override the Mixedbread auth URL")
  .option("--non-interactive", "Disable browser-based login and fail if no credentials are available")
  .option("--config <path>", "Directory that stores mgrep config and credentials")
  .option("--verbose", "Enable verbose logging output");

program
  .command("search", { isDefault: true })
  .description("File pattern searcher")
  .argument("<pattern>", "The pattern to search for")
  .action(async (pattern, _options, cmd) => {
    const options = getOptions(cmd);
    const ctx = await createClientContext(options);

    const results = await ctx.client.stores.search({
      query: pattern,
      store_identifiers: [ctx.storeIdentifier],
    });

    console.log(
      results.data
        .map((result) => {
          let content =
            result.type == "text"
              ? result.text
              : `Not a text chunk! (${result.type})`;
          content = JSON.stringify(content);
          return `${(result.metadata as any)?.path ?? "Unknown path"}: ${content}`;
        })
        .join("\n"),
    );
  });

program
  .command("sync")
  .description("Upload a repository snapshot once and exit")
  .action(async (_args, cmd) => {
    const options = getOptions(cmd);
    const ctx = await createClientContext(options);
    const repoRoot = getGitRoot(process.cwd()) ?? process.cwd();
    console.log(`Syncing ${repoRoot} to store ${ctx.storeIdentifier}`);
    await initialSync(ctx.client, ctx.storeIdentifier, repoRoot);
    console.log("Sync complete.");
  });

program
  .command("status")
  .description("Show configuration and credential status")
  .action(async (_args, cmd) => {
    const options = getOptions(cmd);
    const { config, configDir } = getConfigContext(options);
    const credentialsStore = new CredentialsStore(configDir);
    const cached = credentialsStore.read();

    console.log(`Config file: ${getConfigPath(configDir)}`);
    console.log(`Default store: ${config.store ?? "mgrep"}`);
    console.log(`Auth URL override: ${config.authUrl ?? "<default>"}`);
    console.log(`Telemetry: ${telemetryEnabled(config) ? "enabled" : "disabled"}`);
    console.log(`Credentials: ${cached ? "cached" : "missing"}`);
    if (cached) {
      console.log(`  Cached store: ${cached.store ?? "unknown"}`);
      console.log(`  Cached at: ${cached.createdAt}`);
    }
  });

program
  .command("watch")
  .description("Watch for file changes")
  .action(async (_args, cmd) => {
    const options = getOptions(cmd);
    const ctx = await createClientContext(options);

    const watchRoot = process.cwd();
    const repoRoot = getGitRoot(watchRoot) ?? watchRoot;
    console.log("Watching for file changes in", repoRoot);
    if (!telemetryEnabled(ctx.config)) {
      console.log("Telemetry disabled (no usage data collected).");
    }
    try {
      const remoteFiles = await initialSync(ctx.client, ctx.storeIdentifier, repoRoot);
      startWatcher({
        client: ctx.client,
        store: ctx.storeIdentifier,
        repoRoot,
        cache: remoteFiles,
        verbose: options.verbose ?? ctx.config.logLevel !== "silent",
      });
    } catch (err) {
      console.error("Failed to start watcher:", err);
      process.exitCode = 1;
    }
  });

program
  .command("logout")
  .description("Clear cached Mixedbread credentials")
  .action(() => {
    const store = new CredentialsStore();
    store.clear();
    console.log("Cleared cached mgrep credentials.");
  });

const configCommand = program.command("config").description("Inspect or update CLI configuration");

configCommand
  .command("path")
  .description("Show the path to the config file")
  .action((cmd) => {
    const options = getOptions(cmd);
    console.log(getConfigPath(options.config));
  });

configCommand
  .command("get <key>")
  .description("Show a config value (store, authUrl, telemetry, logLevel)")
  .action((key, _args, cmd) => {
    const options = getOptions(cmd);
    const { config } = getConfigContext(options);
    const value = (config as Record<string, unknown>)[key];
    if (value === undefined) {
      console.log("<undefined>");
      return;
    }
    console.log(value);
  });

configCommand
  .command("set <key> <value>")
  .description("Persist a configuration value")
  .action((key, value, cmd) => {
    const options = getOptions(cmd);
    try {
      const next = updateConfig((current) => mergeConfigValue(current, key, value), {
        configDir: options.config,
      });
      console.log(`Updated ${key}.`);
      if (key === "store") {
        console.log(`Default store is now ${next.store}`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

const storesCommand = program.command("stores").description("Manage Mixedbread stores");

storesCommand
  .command("list")
  .option("--limit <number>", "Number of stores to display", (value) => Number.parseInt(value, 10), 10)
  .action(async (_args, cmd) => {
    const options = getOptions(cmd);
    const ctx = await createClientContext(options, false);
    let printed = 0;
    let cursor: string | undefined;
    const limit: number = cmd.opts().limit;
    while (printed < limit) {
      const pageSize = Math.min(100, limit - printed);
      const page = await ctx.client.stores.list({ limit: pageSize, after: cursor });
      for (const store of page.data) {
        console.log(`${store.name ?? store.id}  (${store.id})`);
        printed += 1;
        if (printed >= limit) break;
      }
      if (!page.pagination?.has_more) {
        break;
      }
      cursor = page.pagination.last_cursor ?? undefined;
    }
    if (printed === 0) {
      console.log("No stores found for this account.");
    }
  });

injectImplicitSearchCommand();
program.parse();

async function ensureStore(
  client: Mixedbread,
  storePreference: string | undefined,
  options?: { allowCreate?: boolean },
): Promise<string> {
  const target = storePreference || "mgrep";
  try {
    const store = await client.stores.retrieve(target);
    return store.id ?? store.name ?? target;
  } catch (err) {
    if (!isNotFoundError(err) || options?.allowCreate === false) {
      throw err;
    }
    console.log(`Store "${target}" not found. Creating a new store...`);
    const created = await client.stores.create({
      name: target,
    });
    console.log(`Created Mixedbread store "${created.name}" (${created.id}).`);
    return created.id ?? created.name ?? target;
  }
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  if ("status" in err) {
    const status = (err as { status?: number }).status;
    return status === 404;
  }
  return false;
}

function startWatcher({
  client,
  store,
  repoRoot,
  cache,
  verbose,
}: {
  client: Mixedbread;
  store: string;
  repoRoot: string;
  cache: StoreFileCache;
  verbose: boolean;
}): void {
  const watcher = chokidar.watch(repoRoot, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
    followSymlinks: false,
    ignored: (targetPath: string) => isIgnoredPath(targetPath, repoRoot),
  });

  const pendingCounts: Record<string, number> = { add: 0, change: 0, unlink: 0 };
  let flushTimer: NodeJS.Timeout | null = null;

  function scheduleFlush(): void {
    if (verbose) {
      return;
    }
    if (flushTimer) {
      return;
    }
    flushTimer = setTimeout(() => {
      const summary = Object.entries(pendingCounts)
        .filter(([, count]) => count > 0)
        .map(([evt, count]) => `${evt} ${count}`)
        .join(", ");
      if (summary) {
        console.log(`Synced changes (${summary})`);
      }
      pendingCounts.add = pendingCounts.change = pendingCounts.unlink = 0;
      flushTimer = null;
    }, 500);
  }

  const record = (event: "add" | "change" | "unlink", filePath: string) => {
    pendingCounts[event] += 1;
    if (verbose) {
      console.log(`${event}: ${filePath}`);
    } else {
      scheduleFlush();
    }
  };

  const syncFile = async (filePath: string, event: "add" | "change") => {
    const repoRelative = getRepoRelativePath(filePath, repoRoot);
    if (repoRelative === null) {
      return;
    }
    try {
      await uploadFile(client, store, filePath, repoRelative, cache);
      record(event, repoRelative);
    } catch (err) {
      console.error("Failed to upload changed file:", repoRelative, err);
    }
  };

  const deleteFile = async (filePath: string) => {
    const repoRelative = getRepoRelativePath(filePath, repoRoot);
    if (repoRelative === null) {
      return;
    }
    const entry = cache.get(repoRelative);
    if (!entry) {
      return;
    }
    try {
      await client.stores.files.delete(entry.id, { store_identifier: store });
      cache.delete(repoRelative);
      record("unlink", repoRelative);
    } catch (err) {
      console.error("Failed to delete remote file:", repoRelative, err);
    }
  };

  watcher
    .on("add", (filePath) => {
      void syncFile(filePath, "add");
    })
    .on("change", (filePath) => {
      void syncFile(filePath, "change");
    })
    .on("unlink", deleteFile)
    .on("error", (err) => {
      console.error("Watcher error:", err);
    })
    .on("ready", () => {
      console.log("Watcher ready. Listening for file changes...");
    });
}

function isIgnoredPath(targetPath: string, repoRoot: string): boolean {
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory() && path.basename(targetPath) === ".git") {
      return true;
    }
  } catch {
    // ignore
  }
  return isIgnoredByGit(targetPath, repoRoot);
}

function injectImplicitSearchCommand(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    return;
  }
  const first = argv[0];
  if (first.startsWith("-")) {
    return;
  }
  if (KNOWN_COMMANDS.has(first)) {
    return;
  }
  process.argv.splice(2, 0, "search");
}

function getOptions(cmd?: Command): GlobalCLIOptions {
  const fn = cmd?.optsWithGlobals ?? program.optsWithGlobals.bind(program);
  return fn();
}
