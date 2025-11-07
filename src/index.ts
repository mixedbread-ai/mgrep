#!/usr/bin/env node
import { program } from "commander";
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
import { CredentialsStore, resolveCredentials } from "./auth";

type GlobalCLIOptions = {
  apiKey?: string;
  store?: string;
  authUrl?: string;
  nonInteractive?: boolean;
};

type StoreFileCacheEntry = {
  id: string;
  hash?: string;
};

type StoreFileCache = Map<string, StoreFileCacheEntry>;

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
  .option("--non-interactive", "Disable browser-based login and fail if no credentials are available");

program
  .command("search", { isDefault: true })
  .description("File pattern searcher")
  .argument("<pattern>", "The pattern to search for")
  .action(async (pattern, _options, cmd) => {
    const options: GlobalCLIOptions = cmd.optsWithGlobals();

    const credentials = await resolveCredentials({
      cliApiKey: options.apiKey,
      cliStore: options.store,
      authUrl: options.authUrl,
      nonInteractive: options.nonInteractive,
    });

    const mixedbread = new Mixedbread({
      apiKey: credentials.apiKey,
    });

    const storeIdentifier = await ensureStore(mixedbread, credentials.store);

    const results = await mixedbread.stores.search({
      query: pattern,
      store_identifiers: [storeIdentifier],
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
  .command("watch")
  .description("Watch for file changes")
  .action(async (_args, cmd) => {
    const options: GlobalCLIOptions = cmd.optsWithGlobals();

    const credentials = await resolveCredentials({
      cliApiKey: options.apiKey,
      cliStore: options.store,
      authUrl: options.authUrl,
      nonInteractive: options.nonInteractive,
    });

    const mixedbread = new Mixedbread({
      apiKey: credentials.apiKey,
    });

    const storeIdentifier = await ensureStore(mixedbread, credentials.store);

    const watchRoot = process.cwd();
    const repoRoot = getGitRoot(watchRoot) ?? watchRoot;
    console.log("Watching for file changes in", repoRoot);
    try {
      const remoteFiles = await initialSync(mixedbread, storeIdentifier, repoRoot);
      startWatcher({
        client: mixedbread,
        store: storeIdentifier,
        repoRoot,
        cache: remoteFiles,
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

program.parse();

async function ensureStore(client: Mixedbread, storePreference: string | undefined): Promise<string> {
  const target = storePreference || "mgrep";
  try {
    const store = await client.stores.retrieve(target);
    return store.id ?? store.name ?? target;
  } catch (err) {
    if (!isNotFoundError(err)) {
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
}: {
  client: Mixedbread;
  store: string;
  repoRoot: string;
  cache: StoreFileCache;
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

  const syncFile = async (filePath: string) => {
    const repoRelative = getRepoRelativePath(filePath, repoRoot);
    if (repoRelative === null) {
      return;
    }
    try {
      await uploadFile(client, store, filePath, repoRelative, cache);
      console.log(`Synced ${repoRelative}`);
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
      console.log(`Deleted remote ${repoRelative}`);
    } catch (err) {
      console.error("Failed to delete remote file:", repoRelative, err);
    }
  };

  watcher
    .on("add", syncFile)
    .on("change", syncFile)
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
