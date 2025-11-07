# mgrep

A CLI replacement for `grep` that runs semantic searches on Mixedbread stores and keeps repositories in sync.

## Installation

```bash
# Use mgrep ad-hoc without installing
npx mgrep search "where do we handle auth?"
bunx mgrep watch

# Add to a project (installs the binary locally)
pnpm add -D mgrep
bun add mgrep

# Install globally so the `mgrep` command is always on your PATH
npm install -g mgrep
```

## Core commands

```bash
# Search the current repository/store (default command)
mgrep <pattern>
mgrep search "raft snapshot"

# Upload a snapshot and exit
mgrep sync

# Keep Mixedbread up to date as you edit
mgrep sync --watch          # one flag to keep syncing
mgrep watch                 # dedicated long-running command

# Forget cached credentials
mgrep logout

# Provide explicit credentials if you don't want the browser flow
mgrep --api-key <api-key> --store <store-id> <pattern>
```

### Parallel + fuzzy search

`mgrep search` now accepts multiple stores and fuzzy filtering so agents get high-signal results immediately.

```bash
# Query three stores at once
mgrep search "metrics handler" --stores app-store,api-store,infra-store

# Pull 20 hits per store and disable fuzzy re-ranking
mgrep search "auth hook" --stores app-store,api-store --per-store 20 --no-fuzzy

# Tighten fuzzy threshold and dump JSON output
mgrep search "controller init" --fuzzy-threshold 0.2 --json
```

- `--stores <comma,list>` – search those stores in parallel (falls back to your default store).
- `--per-store <number>` – how many matches to request from each store (default 10).
- `--limit <number>` – cap the merged result count.
- `--no-fuzzy` / `--fuzzy-threshold <0-1>` – opt out or tune fuzzy filtering of the merged set.
- `--json` – print structured output for downstream tooling.

### File sync

- `mgrep sync` performs a one-shot upload of every non-ignored file in the current git repo.
- `mgrep sync --watch` or `mgrep watch` performs the initial sync, then uses `chokidar` to watch for adds/edits/deletions and mirrors them to Mixedbread using repo-relative paths.

## Authentication

- On the first run, `mgrep` launches a Mixedbread login page in your browser. After you finish the flow, the CLI receives an API key and caches it locally in `~/.config/mgrep/credentials.json` (or `%APPDATA%\mgrep\credentials.json` on Windows).
- To skip the browser flow, pass `--api-key`, set `MXBAI_API_KEY`, or place the key inside the credentials file above. You can also set a preferred store via `--store` or `MXBAI_STORE`.
- Use `--auth-url` (or `MGREP_AUTH_URL`) to point at a staging FE auth server, and `--non-interactive` (or `MGREP_NON_INTERACTIVE=1`) inside CI to force a failure instead of opening a browser.
- The CLI opens `https://app.mixedbread.ai/mgrep/auth` by default. Keep your terminal process running until the page confirms it sent the key to `http://127.0.0.1:<port>/callback`. If it fails, click **Open callback manually** on that page or set `MXBAI_API_KEY` yourself.
- Set `MGREP_CONFIG_DIR` if you need to relocate where credentials are persisted.
- Run `mgrep logout` to delete the cached credentials file if you need to switch accounts or rotate keys locally without removing the file manually.

## Development

```bash
pnpm install
pnpm dev

# Build once to produce TypeScript output
npm run build

# Run auth/unit tests
npm test
```
