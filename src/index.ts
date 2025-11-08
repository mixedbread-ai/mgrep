#!/usr/bin/env node
import { program } from "commander";
import * as fs from "fs";
import * as path from "path";
import { Mixedbread } from "@mixedbread/sdk";
import { isIgnoredByGit, getGitRepoFiles, computeBufferHash } from "./utils";
import ora from "ora";
import pLimit from "p-limit";
import { login, loginAction } from "./login";
import { logout } from "./logout";
import { getJWTToken } from "./lib/auth";
import { createMxbaiClient } from "./lib/mxbai";
import { confirm, isCancel, cancel } from "@clack/prompts";
import { getStoredToken } from "./token";

async function listStoreFileHashes(
  client: Mixedbread,
  store: string,
): Promise<Map<string, string | undefined>> {
  const byExternalId = new Map<string, string | undefined>();
  let after: string | null | undefined = undefined;
  do {
    const resp = await client.stores.files.list(store, { limit: 100, after });
    for (const f of resp.data) {
      const externalId = f.external_id ?? undefined;
      if (!externalId) continue;
      const metadata = (f.metadata as any) || {};
      const hash: string | undefined =
        typeof metadata?.hash === "string" ? metadata.hash : undefined;
      byExternalId.set(externalId, hash);
    }
    after = resp.pagination?.has_more
      ? (resp.pagination?.last_cursor ?? undefined)
      : undefined;
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
  fileName: string,
): Promise<boolean> {
  const buffer = await fs.promises.readFile(filePath);
  if (buffer.length === 0) {
    return false;
  }
  const hash = computeBufferHash(buffer);
  await client.stores.files.upload(
    store,
    new File([buffer], fileName, { type: "text/plain" }),
    {
      external_id: filePath,
      overwrite: true,
      metadata: {
        path: filePath,
        hash,
      },
    },
  );
  return true;
}

async function initialSync(
  client: Mixedbread,
  store: string,
  repoRoot: string,
  onProgress?: (info: {
    processed: number;
    uploaded: number;
    total: number;
    filePath?: string;
  }) => void,
): Promise<{ processed: number; uploaded: number; total: number }> {
  const storeHashes = await listStoreFileHashes(client, store);
  const repoFiles = filterRepoFiles(getGitRepoFiles(repoRoot), repoRoot);
  const total = repoFiles.length;
  let processed = 0;
  let uploaded = 0;

  const concurrency = 100;
  const limit = pLimit(concurrency);

  await Promise.all(
    repoFiles.map((filePath) =>
      limit(async () => {
        try {
          const buffer = await fs.promises.readFile(filePath);
          const hash = computeBufferHash(buffer);
          const existingHash = storeHashes.get(filePath);
          processed += 1;
          if (!existingHash || existingHash !== hash) {
            const didUpload = await uploadFile(
              client,
              store,
              filePath,
              path.basename(filePath),
            );
            if (didUpload) {
              uploaded += 1;
            }
          }
          onProgress?.({ processed, uploaded, total, filePath });
        } catch (err) {
          console.error("Failed to process initial file:", filePath, err);
          onProgress?.({ processed, uploaded, total, filePath });
        }
      }),
    ),
  );
  return { processed, uploaded, total };
}

async function ensureAuthenticated(): Promise<void> {
  const token = await getStoredToken();
  if (token) {
    return;
  }

  const shouldLogin = await confirm({
    message: "You are not logged in. Would you like to login now?",
    initialValue: true,
  });

  if (isCancel(shouldLogin) || !shouldLogin) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  await loginAction();
}

program
  .version(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "../package.json"), {
        encoding: "utf-8",
      }),
    ).version,
  )
  .option(
    "--store <string>",
    "The store to use",
    process.env.MXBAI_STORE || "mgrep",
  );

program
  .command("search", { isDefault: true })
  .description("File pattern searcher")
  .argument("<pattern>", "The pattern to search for")
  .action(async (pattern, _options, cmd) => {
    const options: { store: string } = cmd.optsWithGlobals();

    await ensureAuthenticated();

    try {
      const jwtToken = await getJWTToken();
      const mxbai = createMxbaiClient(jwtToken);

      const path = process.cwd();

      const results = await mxbai.stores.search({
        query: pattern,
        store_identifiers: [options.store],
        filters: {
          all: [
            {
              key: "path",
              operator: "starts_with",
              value: path,
            },
          ],
        },
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to search:", message);
      process.exitCode = 1;
    }
  });

program
  .command("watch")
  .description("Watch for file changes")
  .action(async (_args, cmd) => {
    const options: { store: string } = cmd.optsWithGlobals();

    await ensureAuthenticated();

    try {
      const jwtToken = await getJWTToken();
      const mxbai = createMxbaiClient(jwtToken);

      const watchRoot = process.cwd();

      const spinner = ora({ text: "Indexing files..." }).start();
      let lastProcessed = 0;
      let lastUploaded = 0;
      let lastTotal = 0;
      try {
        const result = await initialSync(
          mxbai,
          options.store,
          watchRoot,
          (info) => {
            lastProcessed = info.processed;
            lastUploaded = info.uploaded;
            lastTotal = info.total;
            const rel =
              info.filePath && info.filePath.startsWith(watchRoot)
                ? path.relative(watchRoot, info.filePath)
                : (info.filePath ?? "");
            spinner.text = `Indexing files (${lastProcessed}/${lastTotal}) • uploaded ${lastUploaded} ${rel}`;
          },
        );
        spinner.succeed(
          `Initial sync complete (${result.processed}/${result.total}) • uploaded ${result.uploaded}`,
        );
      } catch (e) {
        spinner.fail("Initial upload failed");
        throw e;
      }

      console.log("Watching for file changes in", watchRoot);
      fs.watch(watchRoot, { recursive: true }, (eventType, rawFilename) => {
        const filename = rawFilename?.toString();
        if (!filename) {
          return;
        }
        const filePath = path.join(watchRoot, filename);
        console.log(`${eventType}: ${filePath}`);

        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            return;
          }
        } catch {
          return;
        }

        if (isIgnoredByGit(filePath, watchRoot)) {
          return;
        }

        uploadFile(mxbai, options.store, filePath, filename).catch((err) => {
          console.error("Failed to upload changed file:", filePath, err);
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to start watcher:", message);
      process.exitCode = 1;
    }
  });

program.addCommand(login);
program.addCommand(logout);

program.parse();
