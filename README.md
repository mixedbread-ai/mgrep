<div align="center">
  <a href="https://github.com/mixedbread-ai/mgrep">
    <img src="public/logo_mb.svg" alt="mgrep" width="96" height="96" />
  </a>
  <h1>mgrep</h1>
  <p><em>A calm, CLI-native way to search every corner of your repo with Mixedbread.</em></p>
  <a href="https://www.npmjs.com/package/@mixedbread/mgrep"><img src="https://badge.fury.io/js/@mixedbread%2Fcli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0" /></a>
</div>

## Why mgrep

- Natural-language search that feels as immediate as `grep`.
- Powered by [Mixedbread Search](https://www.mixedbread.com/blog/mixedbread-search).
- Seamless background indexing via `mgrep watch`, perfectly happy inside git repos.
- Friendly device-login flow plus optional coding agent integrations.
- Built for agents and humans alike: quiet output, thoughtful defaults, and escape hatches everywhere.

## Quick Start

1. **Install**
   ```bash
   pnpm install -g @mixedbread/mgrep    # or npm / bun
   ```

2. **Sign in once**
   ```bash
   mgrep login
   ```
   A browser window (or verification URL) guides you through Mixedbread authentication.

3. **Index a project**
   ```bash
   cd path/to/repo
   mgrep watch
   ```
   `watch` performs an initial sync, respects `.gitignore`, then keeps the Mixedbread store updated as files change.

4. **Search anything**
   ```bash
   mgrep "where do we set up auth?" src/lib
   mgrep -m 25 "store schema"
   ```
   Searches default to your current working directory unless you pass a path.

## Using it with Coding Agents

- **Claude Code (today)**  
  1. Run `mgrep install-claude-code`. The command signs you in (if needed), adds the Mixedbread mgrep plugin to the marketplace, and installs it.  
  2. Open Claude Code, enable the plugin, and point your agent at the repo you are indexing with `mgrep watch`.  
  3. Ask Claude something just like you do locally; results stream straight into the chat with file paths and line hints.  
  
- More agents (Codex, Cursor, Windsurf, etc.) are on the way—this section will grow as soon as each integration lands.

## Commands at a Glance

| Command | Purpose |
| --- | --- |
| `mgrep` / `mgrep search <pattern> [path]` | Natural-language search with many `grep`-style flags (`-i`, `-r`, `-m`...). |
| `mgrep watch` | Index current repo and keep the Mixedbread store in sync via file watchers. |
| `mgrep login` & `mgrep logout` | Manage device-based authentication with Mixedbread. |
| `mgrep install-claude-code` | Log in, add the Mixedbread mgrep plugin to Claude Code, and install it for you. |
| `mgrep --store my-store ...` | Use or create a specific Mixedbread store instead of the default `mgrep`. |



## Mixedbread under the hood

- Every file is pushed into a Mixedbread Store using the same SDK your apps get.
- Searches request top-k matches with Mixedbread reranking enabled for tighter relevance.
- Results include relative paths plus contextual hints (line ranges for text, page numbers for PDFs, etc.) for a skim-friendly experience.
- Because stores are cloud-backed, agents and teammates can query the same corpus without re-uploading.

## Configuration Tips

- `--store <name>` lets you isolate workspaces (per repo, per team, per experiment). Stores are created on demand if they do not exist yet.
- Ignore rules come straight from git, so temp files, build outputs, and vendored deps stay out of your embeddings.
- `watch` reports progress (`processed / uploaded`) as it scans; leave it running in a terminal tab to keep your store fresh.
- `search` accepts most `grep`-style switches, and politely ignores anything it cannot support, so existing muscle memory still works.

## Development

```bash
pnpm install
pnpm build        # or pnpm dev for a quick compile + run
pnpm format       # biome formatting + linting
```

- The executable lives at `dist/index.js` (built from TypeScript via `tsc`).
- Husky is wired via `pnpx husky init` (run `npx husky init` once after cloning).
- Tests are not wired up yet—`pnpm typecheck` is your best friend before publishing.

## Troubleshooting

- **Login keeps reopening**: run `mgrep logout` to clear cached tokens, then try `mgrep login` again.
- **Watcher feels noisy**: set `MXBAI_STORE` or pass `--store` to separate experiments, or pause the watcher and restart after large refactors.
- **Need a fresh store**: delete it from the Mixedbread dashboard, then run `mgrep watch`. It will auto-create a new one.

## License

Apache-2.0. See the [LICENSE](https://opensource.org/licenses/Apache-2.0) file for details.
