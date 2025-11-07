# mgrep

A command line tool for searching using Mixedbread.

## Installation

```bash
# Use mgrep ad-hoc without installing
npx @mixedbread/grep search "where do we handle auth?"
bunx @mixedbread/grep watch

# Add to a project (installs the mgrep binary locally)
pnpm add -D @mixedbread/grep

# Install globally so the `mgrep` command is always on your PATH
npm install -g @mixedbread/grep
```

## Usage

```bash
# Search the current repository
mgrep <pattern>

# Keep Mixedbread up to date as you edit
mgrep watch

# Forget cached credentials
mgrep logout

# Provide explicit credentials if you don't want the browser flow
mgrep --api-key <api-key> --store <store-id> <pattern>
```

## Authentication

- On the first run, `mgrep` launches a Mixedbread login page in your browser. After you finish the flow, the CLI receives an API key and caches it locally in `~/.config/mgrep/credentials.json` (or `%APPDATA%\mgrep\credentials.json` on Windows).
- To skip the browser flow, pass `--api-key`, set `MXBAI_API_KEY`, or place the key inside the credentials file above. You can also set a preferred store via `--store` or `MXBAI_STORE`.
- Use `--auth-url` (or `MGREP_AUTH_URL`) to point at a staging FE auth server, and `--non-interactive` (or `MGREP_NON_INTERACTIVE=1`) inside CI to force a failure instead of opening a browser.
- The CLI opens `https://app.mixedbread.ai/mgrep/auth` by default. Keep your terminal process running until the page confirms it sent the key to `http://127.0.0.1:<port>/callback`. If it fails, click **Open callback manually** on that page or set `MXBAI_API_KEY` yourself.
- Set `MGREP_CONFIG_DIR` if you need to relocate where credentials are persisted.
- Run `mgrep logout` to delete the cached credentials file if you need to switch accounts or rotate keys locally without removing the file manually.

## File sync

- `mgrep watch` now uses a cross-platform watcher and tracks additions, edits, and deletions. It uploads files using repo-relative paths, so identical filenames in different folders no longer collide remotely.

## Development

```bash
pnpm install
pnpm dev

# Run once to produce TypeScript output
npm run build

# Run auth/unit tests
npm test
```
