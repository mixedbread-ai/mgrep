#!/usr/bin/env node
import { program } from "commander";
import type { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import chokidar from "chokidar";
import { Mixedbread, toFile } from "@mixedbread/sdk";
import Fuse from "fuse.js";
import {
  isIgnoredByGit,
  getGitRepoFiles,
  computeBufferHash,
  getGitRoot,
  getRepoRelativePath,
} from "./utils";
import { CredentialsStore, resolveCredentials, type CredentialResolutionResult } from "./auth";
import {
  DisplaySearchResult,
  normalizeSearchResult,
  parseFuzzyThreshold,
  parsePositiveInteger,
  parseStoreList,
  SearchCommandOptions,
} from "./search-helpers";

const KNOWN_COMMANDS = new Set(["search", "sync", "watch", "logout"]);

type GlobalCLIOptions = {
  apiKey?: string;
  store?: string;
  authUrl?: string;
  nonInteractive?: boolean;
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
};

type MixedbreadSearchResult = Awaited<
  ReturnType<Mixedbread["stores"]["search"]>
>["data"][number];

async function createClientContext(
  opts: GlobalCLIOptions,
  ensureStoreCreation = true,
): Promise<ClientContext> {
  const storePreference = opts.store ?? process.env.MXBAI_STORE;
  const authUrl = opts.authUrl ?? process.env.MGREP_AUTH_URL;
  const credentialsStore = new CredentialsStore();
  const credentials = await resolveCredentials(
    {
      cliApiKey: opts.apiKey,
      cliStore: storePreference,
      authUrl,
      nonInteractive: opts.nonInteractive,
    },
    { credentialsStore },
  );

  const client = new Mixedbread({ apiKey: credentials.apiKey });
  const storeIdentifier = ensureStoreCreation
    ? await ensureStore(client, opts.store ?? storePreference ?? credentials.store)
    : opts.store ?? storePreference ?? credentials.store ?? "mgrep";

  return { client, credentials, storeIdentifier };
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
  .option("--verbose", "Enable verbose logging output");

program
  .command("search", { isDefault: true })
  .description("Semantic search across one or more Mixedbread stores")
  .argument("<pattern>", "The pattern to search for")
  .option(
    "--stores <stores>",
    "Comma-separated store identifiers to search (defaults to your current store)",
  )
  .option(
    "--per-store <number>",
    "Number of results to request from each store",
    (value) => parsePositiveInteger(value, "per-store"),
    10,
  )
  .option(
    "--limit <number>",
    "Total number of results to print after merging",
    (value) => parsePositiveInteger(value, "limit"),
  )
  .option("--no-fuzzy", "Disable fuzzy re-ranking/filtering")
  .option(
    "--fuzzy-threshold <number>",
    "Fuzzy threshold between 0 (strict) and 1 (loose)",
    (value) => parseFuzzyThreshold(value),
    0.4,
  )
  .option("--json", "Print JSON output instead of human-friendly text")
  .action(async function (this: Command, pattern: string) {
    const options = getOptions();
    const ctx = await createClientContext(options, false);
    const cmdOptions = this.opts<SearchCommandOptions>();
    const searchOptions: SearchCommandOptions = {
      fuzzy: true,
      fuzzyThreshold: 0.4,
      perStore: 10,
      ...cmdOptions,
    };
    const explicitStores = parseStoreList(searchOptions.stores);
    const storeList = explicitStores.length > 0 ? explicitStores : [ctx.storeIdentifier];
    const uniqueStoreList = Array.from(new Set(storeList));
    const perStoreLimit = searchOptions.perStore ?? 10;

    const searchResponses = await Promise.all(
      uniqueStoreList.map(async (storeId) => {
        try {
          const response = await ctx.client.stores.search({
            query: pattern,
            store_identifiers: [storeId],
            top_k: perStoreLimit,
          });
          return response.data.map((item) => ({ storeId, item }));
        } catch (err) {
          console.error(`Search failed for store "${storeId}": ${formatError(err)}`);
          return [];
        }
      }),
    );

    const flattened = searchResponses.flat();
    if (flattened.length === 0) {
      console.log("No results found.");
      return;
    }

    const normalized = flattened.map(({ storeId, item }) => normalizeSearchResult(item, storeId));
    const resultLimit =
      searchOptions.limit ??
      Math.min(normalized.length, perStoreLimit * uniqueStoreList.length);

    let ranked: DisplaySearchResult[];
    if (searchOptions.fuzzy) {
      const fuse = new Fuse(normalized, {
        keys: ["text", "path"],
        includeScore: true,
        threshold: searchOptions.fuzzyThreshold ?? 0.4,
        ignoreLocation: true,
      });
      const fuzzyMatches = fuse.search(pattern, { limit: resultLimit });
      ranked =
        fuzzyMatches.length > 0
          ? fuzzyMatches.map(({ item, score }) => ({
              ...item,
              fuzzyScore: typeof score === "number" ? score : undefined,
            }))
          : normalized.slice(0, resultLimit);
    } else {
      ranked = normalized.slice(0, resultLimit);
    }

    if (searchOptions.json) {
      console.log(JSON.stringify(ranked, null, 2));
      return;
    }

    for (const result of ranked) {
      printResult(result);
    }
  });

program
  .command("sync")
  .description("Upload a repository snapshot once and exit")
  .option("--watch", "Continue watching after the initial sync")
  .action(async function (this: Command) {
    const options = getOptions();
    const ctx = await createClientContext(options);
    const cmdOptions = this.opts<{ watch?: boolean }>();
    const repoRoot = getGitRoot(process.cwd()) ?? process.cwd();
    console.log(`Syncing ${repoRoot} to store ${ctx.storeIdentifier}`);
    const cache = await initialSync(ctx.client, ctx.storeIdentifier, repoRoot);
    console.log("Sync complete.");
    if (cmdOptions.watch) {
      console.log("Watcher enabled. Listening for file changes…");
      startWatcher({
        client: ctx.client,
        store: ctx.storeIdentifier,
        repoRoot,
        cache,
        verbose: options.verbose ?? false,
      });
    }
  });

program
  .command("watch")
  .description("Watch for file changes")
  .action(async function () {
    const options = getOptions();
    const ctx = await createClientContext(options);

    const watchRoot = process.cwd();
    const repoRoot = getGitRoot(watchRoot) ?? watchRoot;
    console.log("Watching for file changes in", repoRoot);
    try {
      const remoteFiles = await initialSync(ctx.client, ctx.storeIdentifier, repoRoot);
      startWatcher({
        client: ctx.client,
        store: ctx.storeIdentifier,
        repoRoot,
        cache: remoteFiles,
        verbose: options.verbose ?? false,
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

function getOptions(): GlobalCLIOptions {
  return program.optsWithGlobals();
}

function printResult(result: DisplaySearchResult): void {
  const metrics: string[] = [];
  if (typeof result.apiScore === "number") {
    metrics.push(`api=${result.apiScore.toFixed(4)}`);
  }
  if (typeof result.fuzzyScore === "number") {
    metrics.push(`fuzzy=${result.fuzzyScore.toFixed(4)}`);
  }
  const header = metrics.length > 0 ? `[${metrics.join(", ")}]` : "";
  console.log(`${result.store}:${result.path} ${header}`.trim());
  console.log(`  ${result.preview}`);
}

function formatError(err: unknown): string {
  if (!err) {
    return "Unknown error";
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
