<div align="center">
  <a href="https://github.com/mixedbread-ai/mgrep">
    <img src="public/logo_mb.svg" alt="mgrep" width="96" height="96" />
  </a>
  <h1>mgrep</h1>
  <p><em>A calm, CLI-native way to semantically grep everything, like code, images, pdfs and more.</em></p>
  <a href="https://www.npmjs.com/package/@mixedbread/mgrep"><img src="https://badge.fury.io/js/@mixedbread%2Fcli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0" /></a><br>
  <a href="https://demo.mgrep.mixedbread.com"><img src="https://img.shields.io/badge/Playground-Try%20it%20now-brightgreen" alt="Playground: Try it now" /></a>
  <a href="https://join.slack.com/t/mixedbreadcommunity/shared_invite/zt-3kagj5m36-wwM_hryIFby7B2wlcOaHaQ"><img src="https://img.shields.io/badge/Slack-Join%20Community-4A154B?logo=slack" alt="Slack Community" /></a>

  <br>

  <p align="center">
    <video src="https://github.com/user-attachments/assets/7cb6d2ab-f96b-4092-9088-abbca85b0d52" controls="controls" style="max-width: 730px;">
      Your browser does not support the video tag.
    </video>
  </p>
</div>

## Why mgrep?
- Natural-language search that feels as immediate as `grep`.
- Semantic, multilingual & multimodal (audio, video support coming soon!)
- Smooth background indexing via `mgrep watch`, designed to detect and keep up-to-date everything that matters inside any git repository.
- Friendly device-login flow and first-class coding agent integrations.
- Built for agents and humans alike, and **designed to be a helpful tool**, not a restrictive harness: quiet output, thoughtful defaults, and escape hatches everywhere.
- Reduces the token usage of your agent by 2x while maintaining superior performance

```bash
# index once
mgrep watch

# then ask your repo things in natural language
mgrep "where do we set up auth?"
```

## Quick Start

1. **Install**
   ```bash
   npm install -g @mixedbread/mgrep    # or pnpm / bun
   ```

2. **Sign in once**
   ```bash
   mgrep login
   ```
   A browser window (or verification URL) guides you through Mixedbread authentication.

   **Alternative: API Key Authentication**
   For CI/CD or headless environments, set the `MXBAI_API_KEY` environment variable:
   ```bash
   export MXBAI_API_KEY=your_api_key_here
   ```
   This bypasses the browser login flow entirely.

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
   Searches default to the current working directory unless you pass a path.

**Today, `mgrep` works great on:** code, text, PDFs, images.  
**Coming soon:** audio & video.

## Using it with Coding Agents

`mgrep` supports assisted installation commands for many agents:
- `mgrep install-claude-code` for Claude Code
- `mgrep install-opencode` for OpenCode
- `mgrep install-codex` for Codex
- `mgrep install-droid` for Factory Droid

These commands sign you in (if needed) and add Mixedbread `mgrep` support to the
agent. After that you only have to start the agent in your project folder, thats
it.

### More Agents Coming Soon

More agents (Cursor, Windsurf, etc.) are on the way—this section will grow as soon as each integration lands.

## Making your agent smarter

We plugged `mgrep` into Claude Code and ran a benchmark of 50 QA tasks to evaluate the economics of `mgrep` against `grep`.

![mgrep benchmark](public/bench.jpg)

In our 50-task benchmark, `mgrep`+Claude Code used ~2x fewer tokens than grep-based workflows at similar or better judged quality.

`mgrep` finds the relevant snippets in a few semantic queries first, and the model spends its capacity on reasoning instead of scanning through irrelevant code from endless `grep` attempts. You can [Try it yourself](http://demo.mgrep.mixedbread.com).

*Note: Win Rate (%) was calculated by using an LLM as a judge.*

## Why we built mgrep

`grep` is an amazing tool. It's lightweight, compatible with just about every machine on the planet, and will reliably surface any potential match within any target folder.

But grep is **from 1973**, and it carries the limitations of its era: you need exact patterns and it slows down considerably in the cases where you need it most, on large codebases.

Worst of all, if you're looking for deeply-buried critical business logic, you cannot describe it: you have to be able to accurately guess what kind of naming patterns would have been used by the previous generations of engineers at your workplace for `grep` to find it. This will often result in watching a coding agent desperately try hundreds of patterns, filling its token window, and your upcoming invoice, with thousands of tokens. 

But it doesn't have to be this way. Everything else in our toolkit is increasingly tailored to understand us, and so should our search tools. `mgrep` is our way to bring `grep` to 2025, integrating all of the advances in semantic understanding and code-search, without sacrificing anything that has made `grep` such a useful tool. 

Under the hood, `mgrep` is powered by [Mixedbread Search](https://www.mixedbread.com/blog/mixedbread-search), our full-featured search solution. It combines state-of-the-art semantic retrieval models with context-aware parsing and optimized inference methods to provide you with a natural language companion to `grep`. We believe both tools belong in your toolkit: use `grep` for exact matches, `mgrep` for semantic understanding and intent.


## When to use what

We designed `mgrep` to complement `grep`, not replace it. The best code search combines `mgrep` with `grep`.

| Use `grep` (or `ripgrep`) for... | Use `mgrep` for... |
| --- | --- |
| **Exact Matches** | **Intent Search** |
| Symbol tracing, Refactoring, Regex | Code exploration, Feature discovery, Onboarding |


## Commands at a Glance

| Command | Purpose |
| --- | --- |
| `mgrep` / `mgrep search <pattern> [path]` | Natural-language search with many `grep`-style flags (`-i`, `-r`, `-m`...). |
| `mgrep watch` | Index current repo and keep the Mixedbread store in sync via file watchers. |
| `mgrep login` & `mgrep logout` | Manage device-based authentication with Mixedbread. |
| `mgrep install-claude-code` | Authenticate, add the Mixedbread mgrep plugin to Claude Code. |
| `mgrep install-opencode` | Authenticate and add the Mixedbread mgrep to OpenCode. |
| `mgrep install-codex` | Authenticate and add the Mixedbread mgrep to Codex. |
| `mgrep install-droid` | Authenticate and add the Mixedbread mgrep hooks/skills to Factory Droid. |

### mgrep search

`mgrep search` is the default command. It can be used to search the current
directory for a pattern.

| Option | Description |
| --- | --- |
| `-m <max_count>` | The maximum number of results to return |
| `-c`, `--content` | Show content of the results |
| `-a`, `--answer` | Generate an answer to the question based on the results |
| `-s`, `--sync` | Sync the local files to the store before searching |
| `-d`, `--dry-run` | Dry run the search process (no actual file syncing) |
| `--no-rerank` | Disable reranking of search results |

All search options can also be configured via environment variables (see
[Environment Variables](#environment-variables) section below).

**Examples:**
```bash
mgrep "What code parsers are available?"  # search in the current directory
mgrep "How are chunks defined?" src/models  # search in the src/models directory
mgrep -m 10 "What is the maximum number of concurrent workers in the code parser?"  # limit the number of results to 10
mgrep -a "What code parsers are available?"  # generate an answer to the question based on the results
```

### mgrep watch

`mgrep watch` is used to index the current repository and keep the Mixedbread
store in sync via file watchers.

It respects the current `.gitignore`, as well as a `.mgrepignore` file in the
root of the repository. The `.mgrepignore` file follows the same syntax as the
[`.gitignore`](https://git-scm.com/docs/gitignore) file.

**Examples:**
```bash
mgrep watch  # index the current repository and keep the Mixedbread store in sync via file watchers
```

## Mixedbread under the hood

- Every file is pushed into a Mixedbread Store using the same SDK your apps get.
- Searches request top-k matches with Mixedbread reranking enabled by default
  for tighter relevance (can be disabled with `--no-rerank` or
  `MGREP_RERANK=0`).
- Results include relative paths plus contextual hints (line ranges for text, page numbers for PDFs, etc.) for a skim-friendly experience.
- Because stores are cloud-backed, agents and teammates can query the same corpus without re-uploading.

## Configuration Tips

- `--store <name>` lets you isolate workspaces (per repo, per team, per experiment). Stores are created on demand if they do not exist yet.
- Ignore rules come straight from git, so temp files, build outputs, and vendored deps stay out of your embeddings.
- `watch` reports progress (`processed / uploaded`) as it scans; leave it running in a terminal tab to keep your store fresh.
- `search` accepts most `grep`-style switches, and politely ignores anything it cannot support, so existing muscle memory still works.

## Environment Variables

All search options can be configured via environment variables, which is
especially useful for CI/CD pipelines or when you want to set defaults for all
searches.

### Authentication & Store

- `MXBAI_API_KEY`: Set this to authenticate without browser login (ideal for CI/CD)
- `MXBAI_STORE`: Override the default store name (default: `mgrep`)

### Search Options

- `MGREP_MAX_COUNT`: Maximum number of results to return (default: `10`)
- `MGREP_CONTENT`: Show content of the results (set to `1` or `true` to enable)
- `MGREP_ANSWER`: Generate an answer based on the results (set to `1` or `true` to enable)
- `MGREP_SYNC`: Sync files before searching (set to `1` or `true` to enable)
- `MGREP_DRY_RUN`: Enable dry run mode (set to `1` or `true` to enable)
- `MGREP_RERANK`: Enable reranking of search results (set to `0` or `false` to disable, default: enabled)

**Examples:**
```bash
# Set default max results to 25
export MGREP_MAX_COUNT=25
mgrep "search query"

# Always show content in results
export MGREP_CONTENT=1
mgrep "search query"

# Disable reranking globally
export MGREP_RERANK=0
mgrep "search query"

# Use multiple options together
export MGREP_MAX_COUNT=20
export MGREP_CONTENT=1
export MGREP_ANSWER=1
mgrep "search query"
```

Note: Command-line options always override environment variables.

## Development

```bash
pnpm install
pnpm build        # or pnpm dev for a quick compile + run
pnpm format       # biome formatting + linting
```

- The executable lives at `dist/index.js` (built from TypeScript via `tsc`).
- Husky is wired via `pnpx husky init` (run `npx husky init` once after cloning).
- Tests are not wired up yet—`pnpm typecheck` is your best friend before
  publishing.
- To connect to a local Mixedbread api set the `export NODE_ENV=development`.

### Testing

```bash
pnpm test
```

The tests are written using [bats](https://bats-core.readthedocs.io/en/stable/).

## Troubleshooting

- **Login keeps reopening**: run `mgrep logout` to clear cached tokens, then try `mgrep login` again.
- **Watcher feels noisy**: set `MXBAI_STORE` or pass `--store` to separate experiments, or pause the watcher and restart after large refactors.
- **Need a fresh store**: delete it from the Mixedbread dashboard, then run `mgrep watch`. It will auto-create a new one.

## Support

For usage questions, feedback, or other support, please reach out on the [Mixedbread Slack](https://join.slack.com/t/mixedbreadcommunity/shared_invite/zt-3kagj5m36-wwM_hryIFby7B2wlcOaHaQ).

## License

Apache-2.0. See the [LICENSE](https://opensource.org/licenses/Apache-2.0) file for details.
