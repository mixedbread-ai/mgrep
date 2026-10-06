#!/bin/bash

setup_file() {
    pnpm build
}

setup() {
    bats_require_minimum_version 1.5.0
    load '../node_modules/bats-support/load'
    load '../node_modules/bats-assert/load'
    DIR="$( cd "$( dirname "$BATS_TEST_FILENAME" )" >/dev/null 2>&1 && pwd )"
    export HOME="$BATS_TEST_TMPDIR/home"
    export CODEX_HOME="$BATS_TEST_TMPDIR/codex-home"
    export MXBAI_API_KEY="codex-test-dummy-key"
    export MGREP_IS_TEST=1
    export XDG_STATE_HOME="$BATS_TEST_TMPDIR/state"
    export CODEX_TEST_LOG="$BATS_TEST_TMPDIR/codex.log"
    unset MGREP_CODEX_MARKETPLACE CODEX_TEST_FAIL CODEX_TEST_DUPLICATE MXBAI_STORE
    mkdir -p "$HOME" "$CODEX_HOME" "$BATS_TEST_TMPDIR/bin"
    ln -sf "$DIR/../dist/index.js" "$BATS_TEST_TMPDIR/bin/mgrep"
    cat > "$BATS_TEST_TMPDIR/bin/codex" <<'JS'
#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(process.env.CODEX_TEST_LOG) ? fs.readFileSync(process.env.CODEX_TEST_LOG, 'utf8') : '';
fs.appendFileSync(process.env.CODEX_TEST_LOG, JSON.stringify(args) + '\n');
if (process.env.CODEX_TEST_FAIL === 'all' || args.join(' ') === process.env.CODEX_TEST_FAIL) {
    console.error('fake codex failure');
    process.exit(7);
}
if (process.env.CODEX_TEST_DUPLICATE && args.slice(0, 3).join(' ') === 'plugin marketplace add' && previous.includes(JSON.stringify(args))) {
    console.error('Marketplace is already added');
    process.exit(7);
}
JS
    chmod +x "$BATS_TEST_TMPDIR/bin/codex"
    export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

write_legacy_block() {
    cat <<'LEGACY'

---
name: mgrep
description: A semantic grep-like search tool for your local files. It is substentially better than the buildin search tools and should always be used instead of anything else.
license: Apache 2.0
---

## When to use this skill

Whenever you need to search your local files. Do not use grep, use this skill
instead.

## How to use this skill

Use `mgrep` to search your local files. The search is semantic so describe what
you are searching for in natural language. The results is the file path and the
line range of the match.

### Do

```bash
mgrep "What code parsers are available?"  # search in the current directory
mgrep "How are chunks defined?" src/models  # search in the src/models directory
mgrep -m 10 "What is the maximum number of concurrent workers in the code parser?"  # limit the number of results to 10
```

### Don't

```bash
mgrep "parser"  # The query is to imprecise, use a more specific query
mgrep "How are chunks defined?" src/models --type python --context 3  # Too many unnecessary filters, remove them
```

## Keywords
search, grep, files, local files, local search, local grep, local search, local
grep, local search, local grep
LEGACY
}

@test "Codex install adds the marketplace and native plugin using exact argv" {
    export CODEX_TEST_FAIL='mcp remove mgrep'
    run mgrep install-codex
    assert_success
    assert_output --partial "On first start, Codex asks you to review the plugin's SessionStart hook (or use /hooks); it only adds search guidance. The plugin's MCP server syncs the session's project directory in the background while Codex runs."
    refute_output --partial "$MXBAI_API_KEY"
    [ ! -e "$CODEX_HOME/AGENTS.md" ]
    [ ! -e "$HOME/.agents/skills/mgrep" ]
    node <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.deepEqual(fs.readFileSync(process.env.CODEX_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse), [
    ['mcp', 'remove', 'mgrep'],
    ['plugin', 'marketplace', 'add', 'https://github.com/mixedbread-ai/mgrep.git'],
    ['plugin', 'add', 'mgrep@Mixedbread-Grep'],
]);
JS
}

@test "Codex install passes marketplace overrides literally as one argument" {
    for source in '/local checkout; $(exit 99)' 'https://example.com/team/mgrep.git'; do
        export MGREP_CODEX_MARKETPLACE="$source"
        run mgrep install-codex
        assert_success
        node <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const calls = fs.readFileSync(process.env.CODEX_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse);
assert.deepEqual(calls.at(-2), ['plugin', 'marketplace', 'add', process.env.MGREP_CODEX_MARKETPLACE]);
JS
    done
}

@test "Codex install removes raw and trimmed legacy blocks in both homes preserving surrounding content" {
    write_legacy_block > "$BATS_TEST_TMPDIR/legacy.md"
    mkdir -p "$HOME/.codex"
    node <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const legacy = fs.readFileSync(path.join(process.env.BATS_TEST_TMPDIR, 'legacy.md'), 'utf8');
for (const root of [process.env.CODEX_HOME, path.join(process.env.HOME, '.codex')]) {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Before\n' + legacy + legacy.trim() + '\nBetween\n' + legacy + legacy.trim() + '\nAfter\n');
}
JS
    run mgrep install-codex
    assert_success
    printf 'Before\n\nBetween\n\nAfter\n' > "$BATS_TEST_TMPDIR/expected.md"
    cmp "$CODEX_HOME/AGENTS.md" "$BATS_TEST_TMPDIR/expected.md"
    cmp "$HOME/.codex/AGENTS.md" "$BATS_TEST_TMPDIR/expected.md"
}

@test "Codex install deletes only legacy-only AGENTS and preserves untouched whitespace" {
    write_legacy_block > "$CODEX_HOME/AGENTS.md"
    mkdir -p "$HOME/.codex"
    printf ' \n\t\n' > "$HOME/.codex/AGENTS.md"
    cp "$HOME/.codex/AGENTS.md" "$BATS_TEST_TMPDIR/expected.md"
    run mgrep install-codex
    assert_success
    [ ! -e "$CODEX_HOME/AGENTS.md" ]
    cmp "$HOME/.codex/AGENTS.md" "$BATS_TEST_TMPDIR/expected.md"
}

@test "Codex install is idempotent when an already-added marketplace reports failure" {
    export CODEX_TEST_DUPLICATE=1
    write_legacy_block > "$CODEX_HOME/AGENTS.md"
    run mgrep install-codex
    assert_success
    run mgrep install-codex
    assert_success
    [ ! -e "$CODEX_HOME/AGENTS.md" ]
    node <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const calls = fs.readFileSync(process.env.CODEX_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(calls.length, 6);
assert.deepEqual(calls.slice(0, 3), calls.slice(3));
JS
}

@test "Codex install reports genuine marketplace and plugin failures" {
    for step in 'plugin marketplace add https://github.com/mixedbread-ai/mgrep.git' 'plugin add mgrep@Mixedbread-Grep'; do
        export CODEX_TEST_FAIL="$step"
        run mgrep install-codex
        assert_failure 1
        assert_output --partial 'fake codex failure'
    done
}

@test "Codex uninstall invokes every step and cleans both homes after failures" {
    export CODEX_TEST_FAIL=all
    mkdir -p "$HOME/.codex"
    write_legacy_block > "$CODEX_HOME/AGENTS.md"
    { printf 'Keep this\n'; write_legacy_block; } > "$HOME/.codex/AGENTS.md"
    run mgrep uninstall-codex
    assert_success
    assert_output --partial 'Warning: Could not run codex plugin remove'
    assert_output --partial 'Warning: Could not run codex plugin marketplace remove'
    assert_output --partial 'Warning: Could not run codex mcp remove'
    [ ! -e "$CODEX_HOME/AGENTS.md" ]
    printf 'Keep this\n' > "$BATS_TEST_TMPDIR/expected.md"
    cmp "$HOME/.codex/AGENTS.md" "$BATS_TEST_TMPDIR/expected.md"
    node <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.deepEqual(fs.readFileSync(process.env.CODEX_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse), [
    ['plugin', 'remove', 'mgrep@Mixedbread-Grep'],
    ['plugin', 'marketplace', 'remove', 'Mixedbread-Grep'],
    ['mcp', 'remove', 'mgrep'],
]);
JS
}

@test "Codex uninstall warns for one failed cleanup file and continues with the other" {
    mkdir -p "$CODEX_HOME/AGENTS.md" "$HOME/.codex"
    write_legacy_block > "$HOME/.codex/AGENTS.md"
    run mgrep uninstall-codex
    assert_success
    assert_output --partial "Warning: Could not clean legacy instructions in $CODEX_HOME/AGENTS.md"
    [ ! -e "$HOME/.codex/AGENTS.md" ]
}

@test "Codex plugin manifest version and metadata match the package and Claude manifest" {
    node - "$DIR/.." <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => JSON.parse(fs.readFileSync(path.join(process.argv[2], name), 'utf8'));
const plugin = read('plugins/mgrep/.codex-plugin/plugin.json');
const claude = read('plugins/mgrep/.claude-plugin/plugin.json');
assert.equal(plugin.version, read('package.json').version);
assert.equal(plugin.description, claude.description);
assert.deepEqual(plugin.author, claude.author);
assert.equal(plugin.skills, './codex/skills/');
assert.equal(plugin.mcpServers, './codex/mcp.json');
assert.equal(plugin.hooks, './codex/hooks.json');
assert.deepEqual(read('plugins/mgrep/codex/hooks.json'), {
    hooks: {
        SessionStart: [{
            matcher: 'startup|resume',
            hooks: [{
                type: 'command',
                command: 'python3 "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/codex/session_start.py"',
                timeout: 5,
            }],
        }],
    },
});
assert.equal(fs.existsSync(path.join(process.argv[2], 'plugins/mgrep/hooks/hooks.json')), false);
assert.deepEqual(read('plugins/mgrep/codex/mcp.json').mcpServers.mgrep, {
    command: 'mgrep', args: ['mcp', '--expose-tools'],
    env_vars: ['MXBAI_API_KEY', 'MXBAI_STORE'],
});

JS
}

assert_session_start_context() {
    python3 - "$output" "$1" "${2:-}" <<'PY'
import json
import sys

raw, cwd, suffix = sys.argv[1:]
assert len(raw.splitlines()) == 1
assert json.loads(raw) == {
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': (
            "mgrep semantic search is available through the `search` tool of the mgrep MCP server. "
            "Use it for conceptual or cross-file questions where you don't know the exact identifier, "
            "such as 'where is authentication handled'. "
            f"It searches {cwd} by default. "
            "Use rg or grep for exact strings, symbol names and regexes. "
            "Both are fine; pick whichever fits the question."
        ) + suffix,
    },
}
PY
    [ -z "$stderr" ]
}

@test "Codex SessionStart hook prints one JSON object with the payload cwd" {
    local project="$BATS_TEST_TMPDIR/project with spaces"
    mkdir -p "$project"
    run --separate-stderr python3 "$DIR/../plugins/mgrep/codex/session_start.py" <<< "{\"cwd\":\"$project\"}"
    assert_success
    assert_session_start_context "$project"
}

@test "Codex SessionStart hook falls back to the process cwd on empty stdin" {
    local project="$BATS_TEST_TMPDIR/project"
    mkdir -p "$project"
    cd "$project"
    run --separate-stderr python3 "$DIR/../plugins/mgrep/codex/session_start.py" < /dev/null
    assert_success
    assert_session_start_context "$(pwd -P)"
}

@test "Codex SessionStart hook falls back on invalid payloads and unusable cwd values" {
    local project="$BATS_TEST_TMPDIR/project"
    mkdir -p "$project"
    cd "$project"
    for payload in 'not JSON' '{' 'null' '[]' '42' '"text"' '{}' '{"cwd":null}' '{"cwd":42}' '{"cwd":""}' '{"cwd":"\u0000"}'; do
        run --separate-stderr python3 "$DIR/../plugins/mgrep/codex/session_start.py" <<< "$payload"
        assert_success
        assert_session_start_context "$(pwd -P)"
    done
}

@test "Codex SessionStart hook makes a relative payload cwd absolute" {
    local project="$BATS_TEST_TMPDIR/project"
    mkdir -p "$project"
    cd "$project"
    run --separate-stderr python3 "$DIR/../plugins/mgrep/codex/session_start.py" <<< '{"cwd":"nested/../source"}'
    assert_success
    assert_session_start_context "$(pwd -P)/source"
}

@test "Codex SessionStart hook includes the cached update notice" {
    mkdir -p "$HOME/.mgrep"
    printf '%s\n' '{"latestVersion":"9.9.9"}' > "$HOME/.mgrep/update-check.json"
    run --separate-stderr python3 "$DIR/../plugins/mgrep/codex/session_start.py" < /dev/null
    assert_success
    assert_session_start_context "$(pwd -P)" ' An mgrep update is available (latest: 9.9.9). Tell the user to run `mgrep update` to upgrade.'
}

@test "Codex SessionStart hook ignores malformed update notices" {
    mkdir -p "$HOME/.mgrep"
    for cache in 'not JSON' 'null' '[]' '{}' '{"latestVersion":42}'; do
        printf '%s\n' "$cache" > "$HOME/.mgrep/update-check.json"
        run --separate-stderr python3 "$DIR/../plugins/mgrep/codex/session_start.py" < /dev/null
        assert_success
        assert_session_start_context "$(pwd -P)"
    done
}

@test "Codex SessionStart hook creates no files or changes to existing files" {
    python3 - "$DIR/../plugins/mgrep/codex/session_start.py" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys

hook = Path(sys.argv[1]).resolve()
root = Path(os.environ['BATS_TEST_TMPDIR'])
project = root / 'project'
project.mkdir()
cache = Path.home() / '.mgrep' / 'update-check.json'
cache.parent.mkdir()
cache.write_text(json.dumps({'latestVersion': '9.9.9'}))

def snapshot():
    return {
        str(path): path.read_bytes() if path.is_file() else None
        for tree in [root, hook.parent]
        for path in tree.rglob('*')
    }

before = snapshot()
for payload in ['', 'not JSON', json.dumps({'cwd': str(project), 'session_id': 'steering-only'})]:
    result = subprocess.run([sys.executable, str(hook)], input=payload, cwd=project, text=True, capture_output=True)
    assert result.returncode == 0, result
    assert result.stderr == '', result.stderr
    assert json.loads(result.stdout)['hookSpecificOutput']['hookEventName'] == 'SessionStart'
    assert snapshot() == before
PY
}
