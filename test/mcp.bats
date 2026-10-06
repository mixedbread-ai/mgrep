#!/bin/bash

setup_file() {
    pnpm build
}

setup() {
    load '../node_modules/bats-support/load'
    load '../node_modules/bats-assert/load'

    DIR="$( cd "$( dirname "$BATS_TEST_FILENAME" )" >/dev/null 2>&1 && pwd )"
    mkdir -p "$BATS_TEST_TMPDIR/bin"
    ln -sf "$DIR/../dist/index.js" "$BATS_TEST_TMPDIR/bin/mgrep"
    export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
    export MGREP_IS_TEST=1
    export MGREP_TEST_STORE_PATH="$BATS_TEST_TMPDIR/mgrep-test-store.json"
    export XDG_STATE_HOME="$BATS_TEST_TMPDIR/state"
    unset MGREP_MCP_WAIT_FOR MGREP_MCP_ROOTS MGREP_MCP_FORBID_ROOTS MGREP_MCP_SYNC_WAIT_MS

    mkdir -p "$BATS_TEST_TMPDIR/test-store"
    printf 'Hello, world!\nThis is a test file.\n' > "$BATS_TEST_TMPDIR/test-store/test.txt"
    printf 'Hello, world!\nA second one.\n' > "$BATS_TEST_TMPDIR/test-store/test-2.txt"
    printf 'Hello, world!\nA third one.\n' > "$BATS_TEST_TMPDIR/test-store/test-3.txt"
    cd "$BATS_TEST_TMPDIR/test-store"
    mgrep search --sync test
}

mcp_client() {
    node "$DIR/helpers/mcp-client.mjs" "$@"
}

@test "MCP lists no tools without opt-in" {
    run mcp_client list -- mcp
    assert_success
    assert_equal "$output" '{"tools":[]}'
}

@test "MCP exposes one read-only search tool with the specified schema" {
    run mcp_client list -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const { tools } = JSON.parse(process.argv[2]);
assert.equal(tools.length, 1);
assert.equal(tools[0].name, 'search');
assert.deepEqual(tools[0].annotations, {
  title: 'mgrep semantic search', readOnlyHint: true, destructiveHint: false,
  idempotentHint: true, openWorldHint: false,
});
assert.deepEqual(tools[0].inputSchema.required, ['query']);
const properties = tools[0].inputSchema.properties;
assert.equal(Object.hasOwn(properties.path, "default"), false);
assert.equal(properties.maxCount.type, "integer");
assert.equal(tools[0].description, "Semantic search over the project's files, indexed by mgrep. Use it for conceptual or cross-file questions where you don't know the exact identifier, such as 'where is authentication handled' or 'how are failed uploads retried'. For exact strings, symbol names or regexes, use rg or grep instead. path is optional and defaults to the session's project directory. Results are file paths with line ranges; read only those ranges. Set web and answer to true for a web lookup.");
assert.equal(properties.maxCount.default, 10);
for (const key of ['content', 'answer', 'web']) assert.equal(properties[key].default, false);
JS
}

@test "MCP search returns fixture text and matches CLI output" {
    local expected
    expected="$(mgrep search --content test)"
    run mcp_client call search '{"query":"test","content":true}' -- mcp --expose-tools
    assert_success
    assert_output --partial 'test.txt'
    node - "$output" "$expected" <<'JS'
const assert = require('node:assert/strict');
assert.deepEqual(JSON.parse(process.argv[2]), { content: [{ type: 'text', text: process.argv[3] }] });
JS
}

@test "MCP search supports answer, web, relative and absolute paths and maxCount" {
    local expected
    expected="$(mgrep search --answer --content --web test .)"
    run mcp_client call search '{"query":"test","path":".","answer":true,"content":true,"web":true}' -- --store custom-store mcp --expose-tools
    assert_success
    node - "$output" "$expected" <<'JS'
const assert = require('node:assert/strict');
assert.equal(JSON.parse(process.argv[2]).content[0].text, process.argv[3]);
JS
    run mcp_client call search "{\"query\":\"Hello\",\"path\":\"$PWD\",\"maxCount\":1}" -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
assert.equal(JSON.parse(process.argv[2]).content[0].text.split('\n').length, 1);
JS
}

@test "MCP unknown and disabled tools return errors without crashing" {
    run mcp_client call unknown '{}' -- mcp --expose-tools
    assert_success
    assert_output --partial '"isError":true'
    assert_output --partial 'Unknown tool: unknown'
    run mcp_client call search '{"query":"test"}' -- mcp
    assert_success
    assert_output --partial '"isError":true'
    assert_output --partial 'Unknown tool: search'
}

@test "MCP invalid arguments return errors without crashing" {
    local arguments
    for arguments in '{}' '{"query":4}' '{"query":""}' '{"query":"test","path":4}' '{"query":"test","maxCount":0}' '{"query":"test","maxCount":1.5}' '{"query":"test","content":"true"}' '{"query":"test","sync":true}'; do
        run mcp_client call search "$arguments" -- mcp --expose-tools
        assert_success
        assert_output --partial '"isError":true'
    done
}

@test "MCP first search syncs files without a watcher" {
    printf 'unsynced-needle\n' > new.txt
    run mcp_client call search "{\"query\":\"unsynced-needle\",\"path\":\"$PWD\"}" -- mcp --expose-tools --no-watch
    assert_success
    assert_output --partial './new.txt'
}

@test "MCP survives watcher file count failure" {
    printf 'new file\n' > new.txt
    printf 'another new file\n' > another.txt
    export MGREP_MAX_FILE_COUNT=1
    run mgrep watch
    assert_failure 1
    assert_output --partial '❌ Files to sync (2) exceeds the maximum allowed (1). No files were synced.'
    refute_output --partial 'Failed to start watcher:'

    export MGREP_MCP_WAIT_FOR='❌ Files to sync'
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools
    assert_success
    assert_output --partial '"isError":true'
    assert_output --partial 'exceeds the maximum allowed'
}

@test "MCP skips background sync at and above home while serving search" {
    export HOME="$(pwd -P)"
    export MGREP_MCP_WAIT_FOR='Background sync skipped:'
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools
    assert_success
    assert_output --partial 'test.txt'
    export HOME="$(pwd -P)/child-home"
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools
    assert_success
    assert_output --partial 'test.txt'
}

@test "MCP authentication failure returns an error and watcher failure keeps serving" {
    export MGREP_IS_TEST=0
    export HOME="$BATS_TEST_TMPDIR/empty-home"
    mkdir -p "$HOME"
    unset MXBAI_API_KEY
    export MGREP_MCP_WAIT_FOR='Failed to start watcher:'
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools
    assert_success
    assert_output --partial '"isError":true'
    assert_output --partial 'No authentication token found'
}

@test "MCP exits cleanly after client.close with active watchers" {
    export MGREP_MCP_WAIT_FOR='[LOG] Watching for file changes in'
    run mcp_client close -- mcp --expose-tools
    assert_success
    assert_equal "$output" '{"exited":true,"code":0,"signal":null}'
}

@test "MCP exits cleanly on stdin EOF with active watchers" {
    export MGREP_MCP_WAIT_FOR='[LOG] Watching for file changes in'
    run mcp_client eof -- mcp --expose-tools
    assert_success
    assert_equal "$output" '{"exited":true,"code":0,"signal":null}'
}

@test "MCP exits cleanly on stdin EOF before the watcher starts" {
    run mcp_client eof -- mcp
    assert_success
    assert_equal "$output" '{"exited":true,"code":0,"signal":null}'
}

@test "MCP survives watcher quota failure and returns search quota errors" {
    local preload
    preload="$(node --input-type=module - "$DIR/../dist" <<'JS'
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(`${process.argv[2]}/`).href;
const code = `
import { TestStore } from ${JSON.stringify(`${base}lib/store.js`)};
import ${JSON.stringify(`${base}lib/auth.js`)};
import { QuotaExceededError } from ${JSON.stringify(`${base}lib/utils.js`)};
TestStore.prototype.uploadFile = async () => { throw new QuotaExceededError('quota test'); };
const search = TestStore.prototype.search;
TestStore.prototype.search = async function (...args) {
  if (args[1] === 'quota') throw new QuotaExceededError('search quota test');
  return search.apply(this, args);
};`;
console.log(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
JS
)"
    printf 'new file\n' > new.txt
    export NODE_OPTIONS="--import=$preload"
    run mgrep watch
    assert_failure 1
    assert_output --partial "❌ Free tier quota exceeded. You've reached the monthly limit of 2,000,000 store tokens."
    refute_output --partial 'Failed to start watcher:'

    export MGREP_MCP_WAIT_FOR='❌ Free tier quota exceeded.'
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools
    assert_success
    assert_output --partial '"isError":true'
    assert_output --partial 'quota test'
    unset MGREP_MCP_WAIT_FOR
    export HOME="$(pwd -P)"
    run mcp_client call search '{"query":"quota"}' -- mcp --expose-tools
    assert_success
    assert_equal "$output" '{"content":[{"type":"text","text":"search quota test"}],"isError":true}'
}

@test "Shared search forwards stores, filters, options and preserves formatting" {
    node --input-type=module - "$DIR/../dist/lib/search.js" <<'JS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { resolveSearchPath, runSearch } = await import(pathToFileURL(process.argv[2]));
const root = process.cwd();
assert.equal(resolveSearchPath(root), root);
assert.equal(resolveSearchPath(root, 'a/../b'), `${root}/b`);
assert.equal(resolveSearchPath(root, '/absolute/../unchanged'), '/absolute/../unchanged');
const chunk = {
  type: 'text', text: 'fixture', score: 0.75, metadata: { path: `${root}/test.txt` },
  generated_metadata: { start_line: 0, num_lines: 2 },
};
const web = { type: 'text', text: 'web fixture', score: 1, filename: 'https://example.com' };
let received;
const store = {
  search: async (...args) => { received = args; return { data: [chunk, web] }; },
  ask: async (...args) => { received = args; return { answer: '<cite i="0-1" />', sources: [chunk, web] }; },
};
const options = {
  store: 'custom', query: 'question', path: root, maxCount: 3, content: true,
  answer: false, web: true, rerank: true, agentic: false,
};
assert.equal(await runSearch(store, options, root), './test.txt:1-3 (75.00% match)\nfixture\nhttps://example.com (100.00% match)\nweb fixture');
assert.deepEqual(received, [['custom', 'mixedbread/web'], 'question', 3, { rerank: true },
  { all: [{ key: 'path', operator: 'starts_with', value: root }] }]);
assert.equal(await runSearch(store, { ...options, answer: true, web: false, rerank: false, agentic: true }, root),
  '<cite i="0-1" />\n\n0: ./test.txt:1-3 (75.00% match)\nfixture\n1: https://example.com (100.00% match)\nweb fixture');
assert.deepEqual(received.slice(0, 4), [['custom'], 'question', 3, { rerank: false, agentic: true }]);
JS
}

@test "MCP no-watch requires path in its schema and errors without a root" {
    run mcp_client list -- mcp --expose-tools --no-watch
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const schema = JSON.parse(process.argv[2]).tools[0].inputSchema;
assert.deepEqual(schema.required, ['query', 'path']);
assert.equal(Object.hasOwn(schema.properties.path, 'default'), false);
JS
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools --no-watch
    assert_success
    assert_output --partial '"isError":true'
    assert_output --partial 'An absolute project path is required'
}

@test "MCP no-watch never schedules or starts background sync" {
    run mcp_client idle -- mcp --expose-tools --no-watch
    assert_success
    assert_equal "$output" '{"stderr":""}'
}

@test "MCP uses the first file root and makes results relative to it" {
    mkdir -p "$BATS_TEST_TMPDIR/project/src" "$BATS_TEST_TMPDIR/other"
    printf 'root-needle\n' > "$BATS_TEST_TMPDIR/project/src/x.ts"
    printf 'root-needle\n' > "$BATS_TEST_TMPDIR/other/wrong.txt"
    export MGREP_MCP_ROOTS="[{\"uri\":\"https://example.com\"},{\"uri\":\"file://$BATS_TEST_TMPDIR/project\"},{\"uri\":\"file://$BATS_TEST_TMPDIR/other\"}]"
    run mcp_client call search '{"query":"root-needle"}' -- mcp --expose-tools --no-watch
    assert_success
    assert_output --partial './src/x.ts:1-2'
    refute_output --partial 'wrong.txt'
    refute_output --partial "$BATS_TEST_TMPDIR"
}

@test "MCP explicit absolute and relative paths win over client roots" {
    mkdir -p alternate/src
    printf 'explicit-needle\n' > alternate/src/x.ts
    export MGREP_MCP_ROOTS="[{\"uri\":\"file://$BATS_TEST_TMPDIR/missing\"}]"
    export MGREP_MCP_FORBID_ROOTS=1
    for root in './alternate' "$PWD/alternate"; do
        run mcp_client call search "{\"query\":\"explicit-needle\",\"path\":\"$root\"}" -- mcp --expose-tools --no-watch
        assert_success
        assert_output --partial './src/x.ts:1-2'
        refute_output --partial '"isError":true'
    done
}

@test "MCP roots with no file URI fall back to cwd only with watch enabled" {
    export MGREP_MCP_ROOTS='[{"uri":"https://example.com"}]'
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools
    assert_success
    assert_output --partial './test.txt'
    run mcp_client call search '{"query":"test"}' -- mcp --expose-tools --no-watch
    assert_success
    assert_output --partial 'An absolute project path is required'
}

@test "MCP first-search sync runs once per resolved root during a server lifetime" {
    mkdir -p alternate
    run mcp_client calls "[{\"query\":\"test\",\"path\":\"$PWD\"},{\"write\":{\"path\":\"$PWD/later.txt\",\"text\":\"later-needle\"}},{\"query\":\"later-needle\",\"path\":\".\"},{\"write\":{\"path\":\"$PWD/alternate/second.txt\",\"text\":\"second-root-needle\"}},{\"query\":\"second-root-needle\",\"path\":\"alternate\"}]" -- mcp --expose-tools --no-watch
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const results = JSON.parse(process.argv[2]);
assert.match(results[0].content[0].text, /test.txt/);
assert.equal(results[1].content[0].text, '');
assert.match(results[2].content[0].text, /^\.\/second.txt:1-2/);
JS
}

@test "MCP first-search sync skips roots at and above home with no watcher" {
    printf 'unsynced-home-needle\n' > new.txt
    for root in "$PWD" "$PWD/.."; do
        export HOME="$(pwd -P)"
        run mcp_client call search "{\"query\":\"unsynced-home-needle\",\"path\":\"$root\"}" -- mcp --expose-tools --no-watch
        assert_success
        assert_equal "$output" '{"content":[{"type":"text","text":""}]}'
    done
}

@test "MCP initialize instructions describe semantic search and include the server cwd" {
    run mcp_client initialize -- mcp --expose-tools
    assert_success
    node - "$output" "$(pwd -P)" <<'JS'
const assert = require('node:assert/strict');
assert.equal(JSON.parse(process.argv[2]).instructions, `mgrep semantic search is available through this server's \`search\` tool. Use it for conceptual or cross-file questions where you don't know the exact identifier, such as 'where is authentication handled'. It searches ${process.argv[3]} by default. Use rg or grep for exact strings, symbol names and regexes. Both are fine; pick whichever fits the question.`);
JS
}

@test "MCP optional path waits for the initial watcher sync before searching cwd" {
    printf 'watcher-needle\n' > new.txt
    run mcp_client call-with-logs search '{"query":"watcher-needle"}' -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const { result, stderr } = JSON.parse(process.argv[2]);
assert.match(result.content[0].text, /\.\/new.txt/);
assert.equal(result.isError, undefined);
assert.equal((stderr.match(/Initial sync complete/g) || []).length, 1);
assert.doesNotMatch(stderr, /Indexing complete/);
JS
}

@test "MCP watcher per-file upload errors do not trigger a second sync" {
    local preload
    preload="$(node --input-type=module - "$DIR/../dist" <<'JS'
import { pathToFileURL } from 'node:url';
const module = pathToFileURL(`${process.argv[2]}/lib/store.js`).href;
const code = `import { TestStore } from ${JSON.stringify(module)};
const listFiles = TestStore.prototype.listFiles;
TestStore.prototype.listFiles = async function* (...args) {
  console.error('test sync pass');
  yield* listFiles.apply(this, args);
};
TestStore.prototype.uploadFile = async (_storeId, file) => {
  for await (const chunk of file) {}
  throw new Error('per-file upload test');
};`;
console.log(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
JS
)"
    printf 'failed upload\n' > new.txt
    export NODE_OPTIONS="--import=$preload"
    run mcp_client call-with-logs search '{"query":"test"}' -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const { result, stderr } = JSON.parse(process.argv[2]);
assert.match(result.content[0].text, /\.\/test.txt/);
assert.equal(result.isError, undefined);
assert.match(stderr, /Initial sync complete.*errors 1/);
assert.match(stderr, /1 file\(s\) failed to upload/);
assert.match(stderr, /\[LOG\] Watching for file changes in/);
assert.equal((stderr.match(/test sync pass/g) || []).length, 1);
assert.doesNotMatch(stderr, /Indexing complete/);
assert.doesNotMatch(result.content[0].text, /Note:/);
JS
}

@test "MCP search times out waiting for initial sync and searches the existing index without syncing again" {
    local preload
    preload="$(node --input-type=module - "$DIR/../dist" <<'JS'
import { pathToFileURL } from 'node:url';
const module = pathToFileURL(`${process.argv[2]}/lib/store.js`).href;
const code = `import { TestStore } from ${JSON.stringify(module)};
const listFiles = TestStore.prototype.listFiles;
TestStore.prototype.listFiles = async function* (...args) {
  console.error('test sync pass');
  yield* listFiles.apply(this, args);
};
TestStore.prototype.uploadFile = async (_storeId, file) => {
  for await (const chunk of file) {}
  console.error('test upload blocked');
  await new Promise(() => {});
};`;
console.log(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
JS
)"
    printf 'not-indexed-needle\n' > new.txt
    export NODE_OPTIONS="--import=$preload"
    export MGREP_MCP_WAIT_FOR='test upload blocked'
    export MGREP_MCP_SYNC_WAIT_MS=50
    run mcp_client calls-with-logs '[{"query":"test"},{"query":"not-indexed-needle","path":"."}]' -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const { result, stderr } = JSON.parse(process.argv[2]);
const note = 'Note: the initial mgrep sync is still running; results may be incomplete.';
assert.match(result[0].content[0].text, /\.\/test.txt/);
for (const entry of result) {
  assert.equal(entry.isError, undefined);
  assert.equal(entry.content[0].text.split('\n').at(-1), note);
}
assert.equal(result[1].content[0].text, note);
assert.equal((stderr.match(/test sync pass/g) || []).length, 1);
assert.equal((stderr.match(/test upload blocked/g) || []).length, 1);
assert.doesNotMatch(stderr, /Initial sync complete|Indexing complete/);
JS
}

@test "MCP searches inside cwd do not sync again once the watcher is active" {
    mkdir -p nested
    printf 'nested-needle\n' > nested/child.txt
    export MGREP_MCP_WAIT_FOR='[LOG] Watching for file changes in'
    run mcp_client calls-with-logs '[{"query":"nested-needle","path":"nested"},{"query":"nested-needle"},{"query":"nested-needle","path":"."}]' -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const { result, stderr } = JSON.parse(process.argv[2]);
assert.match(result[0].content[0].text, /^\.\/child.txt/);
for (const entry of result.slice(1)) assert.match(entry.content[0].text, /^\.\/nested\/child.txt/);
assert.equal((stderr.match(/Initial sync complete/g) || []).length, 1);
assert.doesNotMatch(stderr, /Indexing complete/);
JS
}

@test "MCP searches outside cwd keep first-search sync per root with a watcher" {
    mkdir -p ../test-store-sibling
    printf 'outside-needle\n' > ../test-store-sibling/outside.txt
    export MGREP_MCP_WAIT_FOR='[LOG] Watching for file changes in'
    run mcp_client calls-with-logs '[{"query":"outside-needle","path":"../test-store-sibling"},{"query":"outside-needle","path":"../test-store-sibling"}]' -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const { result, stderr } = JSON.parse(process.argv[2]);
for (const entry of result) assert.match(entry.content[0].text, /^\.\/outside.txt/);
assert.equal((stderr.match(/Initial sync complete/g) || []).length, 1);
assert.equal((stderr.match(/Indexing complete/g) || []).length, 1);
JS
}

@test "MCP failed watcher falls back to first-search sync once per root" {
    local preload
    preload="$(node --input-type=module - "$DIR/../dist" <<'JS'
import { pathToFileURL } from 'node:url';
const module = pathToFileURL(`${process.argv[2]}/lib/store.js`).href;
const code = `import { TestStore } from ${JSON.stringify(module)};
TestStore.prototype.retrieve = async () => { throw new Error('watcher startup test'); };
TestStore.prototype.create = async () => { throw new Error('watcher startup test'); };`;
console.log(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
JS
)"
    printf 'fallback-needle\n' > new.txt
    export NODE_OPTIONS="--import=$preload"
    run mcp_client calls-with-logs '[{"query":"fallback-needle"},{"query":"fallback-needle","path":"."}]' -- mcp --expose-tools
    assert_success
    node - "$output" <<'JS'
const assert = require('node:assert/strict');
const { result, stderr } = JSON.parse(process.argv[2]);
for (const entry of result) {
  assert.match(entry.content[0].text, /^\.\/new.txt/);
  assert.equal(entry.isError, undefined);
}
assert.match(stderr, /Failed to start watcher: watcher startup test/);
assert.equal((stderr.match(/Indexing complete/g) || []).length, 1);
JS
}

@test "startWatch reports readiness after complete sync and returns false for startup failures or dry run" {
    local scenario
    for scenario in ready dry-run home quota file-count store-error watch-error async-watch-error partial-sync; do
        run node --input-type=module - "$DIR/../dist" "$scenario" <<'JS'
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(`${process.argv[2]}/`).href;
const { startWatch } = await import(`${base}commands/watch.js`);
const { TestStore } = await import(`${base}lib/store.js`);
const { QuotaExceededError } = await import(`${base}lib/utils.js`);
const scenario = process.argv[3];
const store = new TestStore();
const watchers = [];
fs.watch = () => {
  if (scenario === 'watch-error') throw new Error('watch setup test');
  const watcher = new EventEmitter();
  watcher.close = () => {};
  watchers.push(watcher);
  if (scenario === 'async-watch-error') process.nextTick(() => watcher.emit('error', new Error('async watch setup test')));
  return watcher;
};
syncBuiltinESMExports();
if (scenario === 'home') process.env.HOME = process.cwd();
if (['quota', 'file-count', 'partial-sync'].includes(scenario)) {
  fs.writeFileSync('contract-a.txt', 'contract fixture');
  fs.writeFileSync('contract-b.txt', 'contract fixture');
}
if (['quota', 'partial-sync'].includes(scenario)) store.uploadFile = async (_storeId, file) => {
  for await (const chunk of file) {}
  if (scenario === 'quota') throw new QuotaExceededError('contract quota');
  throw new Error('contract upload');
};
const result = await startWatch({
  store: 'test-store', dryRun: scenario === 'dry-run',
  maxFileCount: scenario === 'file-count' ? 1 : undefined,
  createStore: async () => {
    if (scenario === 'store-error') throw new Error('contract store');
    return store;
  },
});
const watching = ['ready', 'partial-sync'].includes(scenario);
assert.equal(result, watching, scenario);
if (watching) assert.ok(watchers.length > 0);
assert.equal(process.exitCode || 0, ['home', 'quota', 'file-count', 'store-error'].includes(scenario) ? 1 : 0, scenario);
process.exitCode = 0;
fs.rmSync('contract-a.txt', { force: true });
fs.rmSync('contract-b.txt', { force: true });
JS
        assert_success
    done
}
