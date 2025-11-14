#!/usr/bin/env node
import { program, Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import chokidar from "chokidar";
import { Mixedbread, toFile } from "@mixedbread/sdk";
import { lookup as lookupMime } from "mime-types";
const BINARY_MIME_OVERRIDES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};
import {
  isIgnoredByGit,
  getGitRepoFiles,
  computeBufferHash,
  getGitRoot,
  getRepoRelativePath,
} from "./utils";
import { CredentialsStore, resolveCredentials, type CredentialResolutionResult } from "./auth";

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
  const mimeType = determineMimeType(repoRelativePath);
  const file = await toFile(fileBuffer, repoRelativePath, { type: mimeType });
  const uploaded = await client.stores.files.upload(
    store,
    file,
    {
      external_id: repoRelativePath,
      overwrite: true,
      metadata: {
        path: repoRelativePath,
        hash,
        mime: mimeType,
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
        try {
          await uploadFile(client, store, filePath, repoRelativePath, remoteFiles, buffer);
          console.log(`Uploaded initial ${repoRelativePath}`);
        } catch (err) {
          const error = err as { status?: number; message?: string };
          console.error("Failed to process initial file:", filePath, error);
        }
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
  .option("--watch", "Continue watching after the initial sync")
  .action(async (cmd) => {
    const options = getOptions(cmd);
    const ctx = await createClientContext(options);
    const repoRoot = getGitRoot(process.cwd()) ?? process.cwd();
    console.log(`Syncing ${repoRoot} to store ${ctx.storeIdentifier}`);
    const cache = await initialSync(ctx.client, ctx.storeIdentifier, repoRoot);
    console.log("Sync complete.");
    const watchRequested =
      typeof (cmd as any).opts === "function" ? (cmd as Command).opts().watch === true : false;
    if (watchRequested) {
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
  .action(async (cmd) => {
    const options = getOptions(cmd);
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

function getOptions(cmd?: Command): GlobalCLIOptions {
  if (cmd && typeof (cmd as any).optsWithGlobals === "function") {
    return cmd.optsWithGlobals();
  }
  return program.optsWithGlobals();
}

function determineMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  const binaryOverride = BINARY_MIME_OVERRIDES[ext];
  if (binaryOverride) {
    return binaryOverride;
  }
  const detected = lookupMime(filePath) || "text/plain";
  if (detected.startsWith("text/") && !detected.includes("charset")) {
    return `${detected}; charset=utf-8`;
  }
  if (detected === "application/octet-stream") {
    return "text/plain; charset=utf-8";
  }
  if (detected === "application/json") {
    return "text/plain; charset=utf-8";
  }
  if (detected === "video/mp2t") {
    return "text/plain; charset=utf-8";
  }
  if (detected.startsWith("application/") && !binaryOverride) {
    return "text/plain; charset=utf-8";
  }
  return detected;
}
