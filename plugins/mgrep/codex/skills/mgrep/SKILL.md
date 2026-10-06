---
name: mgrep
description: Semantic search for conceptual questions about project files, alongside rg and grep for exact matches.
---

Use the mgrep MCP server's `search` tool for conceptual or cross-file questions
when you do not know the exact identifier, such as "where is authentication
handled". Provide a natural-language `query`; `path` is optional and defaults
to the session's project directory. Results contain file paths and line ranges;
read only those ranges. The MCP server keeps the session's project directory synced.

Use rg or grep for exact strings, symbol names, and regexes. Both approaches are
fine; choose whichever fits the question.

Outside MCP, use the CLI from your project directory:

```bash
mgrep search "how are failed uploads retried"
mgrep search --sync "where is authentication handled" ./src
mgrep search --web --answer "how does this API work"
```

Prefer the MCP tool inside Codex to avoid shell network approval prompts. The CLI
works in a terminal or when MCP is unavailable. Set `web` and `answer` to true
for an MCP web lookup. Use `maxCount` (CLI `-m`) to limit results.

`content: true` and CLI `-c` include full matching content and can produce large
output. Start with paths and line ranges, then read the relevant ranges.
