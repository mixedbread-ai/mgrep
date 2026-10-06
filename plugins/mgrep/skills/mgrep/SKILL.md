---
name: mgrep
description: Semantic search for conceptual questions about project files, alongside Grep and rg for exact matches.
license: Apache 2.0
---

Use `mgrep search "<natural-language question>"` from the project directory for
conceptual or cross-file questions when you do not know the exact identifier,
such as "where is authentication handled". An optional path scopes the search.
Results contain file paths and line ranges; read the relevant ranges.

Use Grep or rg for exact strings, symbol names and regexes. Both approaches are
fine; choose whichever fits the question.

```bash
mgrep search "how are failed uploads retried"
mgrep search "where is authentication handled" ./src
mgrep --web --answer "how does this API work"
```

Use `-m` to limit results. `-c` includes full matching content and can produce
large output. Start with paths and line ranges, then read the relevant ranges.
The repository is already indexed; searches do not need `--sync` or a watcher.
