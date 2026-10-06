#!/bin/bash

setup_file() {
    pnpm build
}

setup() {
    load '../node_modules/bats-support/load'
    load '../node_modules/bats-assert/load'
    DIR="$( cd "$( dirname "$BATS_TEST_FILENAME" )" >/dev/null 2>&1 && pwd )"
    FIXTURE="$(mktemp -d "$BATS_TMPDIR/mgrep-coordination.XXXXXX")"
    export MGREP_IS_TEST=1
    export MGREP_TEST_STORE_PATH="$FIXTURE/store.json"
    export MGREP_WATCH_REGISTRY_DIR="$FIXTURE/registry"
    export MGREP_WATCH_POLL_MS=100
    export MGREP_AUTO_UPDATE=disabled
    mkdir -p "$FIXTURE/bin" "$FIXTURE/repo/services" "$MGREP_WATCH_REGISTRY_DIR"
    ln -s "$DIR/../dist/index.js" "$FIXTURE/bin/mgrep"
    export PATH="$FIXTURE/bin:$PATH"
    ROOT="$(cd "$FIXTURE/repo" && pwd -P)"
    CHILD="$ROOT/services"
    PIDS=()
    cd "$ROOT"
    echo 'parent content' > parent.txt
    echo 'child content' > services/child.txt
    mgrep search --sync test > "$FIXTURE/setup.log" 2>&1
}

teardown() {
    for pid in "${PIDS[@]}"; do
        kill -CONT "$pid" 2>/dev/null || true
        kill -TERM "$pid" 2>/dev/null || true
    done
    # A broken signal handler must not leave a slow upload alive in teardown.
    for pid in "${PIDS[@]}"; do kill -KILL "$pid" 2>/dev/null || true; done
    for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
    if [ "${BATS_TEST_COMPLETED:-}" != 1 ]; then
        for log in "$FIXTURE"/*.log; do cat "$log" >&3; done
    fi
    rm -rf "$FIXTURE"
}

start_watcher() {
    local root="$1" log="$2"
    shift 2
    (cd "$root" && exec mgrep watch "$@") > "$log" 2>&1 3>&- &
    WATCH_PID=$!
    PIDS+=("$WATCH_PID")
}

start_injected_watcher() {
    local root="$1" log="$2" failure="$3"
    (cd "$root" && exec node --title=mgrep-error-test --input-type=module - "$DIR/../dist" "$failure" "$FIXTURE/reject" "$CHILD") > "$log" 2>&1 3>&- <<'JS' &
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const [base, failure, marker, child] = process.argv.slice(2);
const { TestStore } = await import(pathToFileURL(`${base}/lib/store.js`));
const { QuotaExceededError, MaxFileCountExceededError } =
  await import(pathToFileURL(`${base}/lib/utils.js`));
if (failure.startsWith('sync-quota')) {
  const now = Date.now;
  Date.now = () => now() + (fs.existsSync(`${marker}.advance`)
    ? Number(fs.readFileSync(`${marker}.advance`, 'utf8')) : 0);
}
const upload = TestStore.prototype.uploadFile;
TestStore.prototype.uploadFile = async function (...args) {
  if (failure === 'upload' && fs.existsSync(marker)) throw new Error('injected upload failure');
  return upload.apply(this, args);
};
const remove = TestStore.prototype.deleteFile;
TestStore.prototype.deleteFile = async function (...args) {
  if (failure === 'delete' && fs.existsSync(marker)) throw new Error('injected delete failure');
  return remove.apply(this, args);
};
const list = TestStore.prototype.listFiles;
TestStore.prototype.listFiles = async function* (...args) {
  if (failure === 'sync-quota-repeat') console.error('test poll sync attempt');
  if (failure.startsWith('sync') && fs.existsSync(marker)) {
    if (failure !== 'sync-quota-repeat') fs.unlinkSync(marker);
    if (failure.startsWith('sync-quota')) throw new QuotaExceededError('injected sync failure');
    if (failure === 'sync-count') throw new MaxFileCountExceededError(2, 1);
    throw new Error('injected sync failure');
  }
  yield* list.apply(this, args);
};
if (failure === 'directory') {
  const watch = fs.watch;
  fs.watch = function (dir, ...args) {
    const watcher = watch.call(this, dir, ...args);
    if (dir === child) {
      const close = watcher.close.bind(watcher);
      watcher.close = () => { console.log(`closed directory: ${dir}`); close(); };
      const timer = setInterval(() => {
        if (!fs.existsSync(marker)) return;
        fs.unlinkSync(marker);
        clearInterval(timer);
        watcher.emit('error', new Error('injected directory failure'));
      }, 10);
      timer.unref();
    }
    return watcher;
  };
}
if (failure === 'poll') {
  const read = fs.readdirSync;
  fs.readdirSync = function (dir, ...args) {
    if (dir === process.env.MGREP_WATCH_REGISTRY_DIR && fs.existsSync(marker)) {
      fs.unlinkSync(marker);
      throw new Error('injected poll failure');
    }
    return read.call(this, dir, ...args);
  };
}
syncBuiltinESMExports();
const { startWatch } = await import(pathToFileURL(`${base}/commands/watch.js`));
await startWatch({store: 'mgrep', dryRun: false});
JS
    WATCH_PID=$!
    PIDS+=("$WATCH_PID")
}

wait_log() {
    local log="$1" text="$2"
    for _ in {1..80}; do
        if grep -Fq "$text" "$log"; then return 0; fi
        sleep 0.05
    done
    cat "$log" >&3
    return 1
}

wait_active() {
    wait_log "$1" 'Initial sync complete'
    # Let the startup continuation install its directory watchers.
    sleep 0.15
}

claim_count() {
    node -e 'const fs = require("fs"); console.log(fs.readdirSync(process.env.MGREP_WATCH_REGISTRY_DIR).filter(n => n.endsWith(".json")).length)'
}

assert_claim() {
    node - "$1" "$2" <<'JS'
const fs = require('fs');
const claims = fs.readdirSync(process.env.MGREP_WATCH_REGISTRY_DIR)
  .filter(n => n.endsWith('.json'))
  .map(n => JSON.parse(fs.readFileSync(`${process.env.MGREP_WATCH_REGISTRY_DIR}/${n}`, 'utf8')));
if (!claims.some(c => c.pid === Number(process.argv[2]) && c.root === process.argv[3])) process.exit(1);
JS
}

@test "second watcher on the same directory stands by with one claim" {
    start_watcher "$ROOT" "$FIXTURE/first.log"
    first=$WATCH_PID
    wait_active "$FIXTURE/first.log"
    start_watcher "$ROOT" "$FIXTURE/second.log"
    second=$WATCH_PID
    wait_log "$FIXTURE/second.log" "Covered by mgrep watch (pid $first) for $ROOT; standing by"
    assert [ "$(claim_count)" = 1 ]
    assert_claim "$first" "$ROOT"
    kill -0 "$second"
    ! grep -q 'Initial sync\|Watching for file changes' "$FIXTURE/second.log"
    echo changed >> "$CHILD/child.txt"
    wait_log "$FIXTURE/first.log" ": $CHILD/child.txt"
    sleep 0.3
    ! grep -q 'change:\|rename:' "$FIXTURE/second.log"
}

@test "child started after parent stands by and SIGTERM triggers takeover" {
    start_watcher "$ROOT" "$FIXTURE/parent.log"
    parent=$WATCH_PID
    wait_active "$FIXTURE/parent.log"
    start_watcher "$CHILD" "$FIXTURE/child.log"
    child=$WATCH_PID
    wait_log "$FIXTURE/child.log" 'standing by'
    assert [ "$(claim_count)" = 1 ]
    ! grep -q 'Initial sync' "$FIXTURE/child.log"
    kill -TERM "$parent"
    wait "$parent"
    # Bound takeover latency to a few polling intervals plus startup sync.
    for _ in {1..10}; do
        if grep -q 'Initial sync complete' "$FIXTURE/child.log"; then break; fi
        sleep 0.1
    done
    grep -q 'Initial sync complete' "$FIXTURE/child.log"
    assert_claim "$child" "$CHILD"
    assert [ "$(claim_count)" = 1 ]
    sleep 0.15
    echo takeover >> "$CHILD/child.txt"
    wait_log "$FIXTURE/child.log" ": $CHILD/child.txt"
}

@test "SIGTERM exits a CLI watcher during slow initial sync within two seconds" {
    local preload
    preload="$(node --input-type=module - "$DIR/../dist" <<'JS'
import { pathToFileURL } from 'node:url';
const module = pathToFileURL(`${process.argv[2]}/lib/store.js`).href;
const code = `import { TestStore } from ${JSON.stringify(module)};
const upload = TestStore.prototype.uploadFile;
TestStore.prototype.uploadFile = async function (...args) {
  console.error('test slow upload started');
  await new Promise(resolve => setTimeout(resolve, 10000));
  return upload.apply(this, args);
};`;
console.log(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
JS
)"
    echo slow-upload > "$ROOT/new.txt"
    NODE_OPTIONS="--import=$preload" start_watcher "$ROOT" "$FIXTURE/slow.log"
    wait_log "$FIXTURE/slow.log" 'test slow upload started'
    assert_claim "$WATCH_PID" "$ROOT"
    run node - "$WATCH_PID" <<'JS'
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const pid = Number(process.argv[2]);
const start = performance.now();
process.kill(pid, 'SIGTERM');
const timer = setInterval(() => {
  try { process.kill(pid, 0); }
  catch (error) {
    assert.equal(error.code, 'ESRCH');
    assert.ok(performance.now() - start < 2000);
    clearInterval(timer);
    return;
  }
  assert.ok(performance.now() - start < 2000, 'watcher did not exit within two seconds');
}, 10);
JS
    assert_success
    wait "$WATCH_PID"
    assert [ "$(claim_count)" = 0 ]
    ! grep -q 'Initial sync complete' "$FIXTURE/slow.log"
}

@test "poll-time quota takeover backs off ten minutes and prints one banner per series" {
    start_watcher "$ROOT" "$FIXTURE/parent.log"
    parent=$WATCH_PID
    wait_active "$FIXTURE/parent.log"
    touch "$FIXTURE/reject"
    start_injected_watcher "$CHILD" "$FIXTURE/child.log" sync-quota-repeat
    child=$WATCH_PID
    wait_log "$FIXTURE/child.log" 'standing by'
    kill -TERM "$parent"
    wait "$parent"
    wait_log "$FIXTURE/child.log" 'Failed to coordinate watcher:'
    # Five 100ms poll intervals must not attempt another sync or print a banner.
    sleep 0.5
    assert [ "$(grep -c 'test poll sync attempt' "$FIXTURE/child.log")" = 1 ]
    assert [ "$(grep -c 'Free tier quota exceeded' "$FIXTURE/child.log")" = 1 ]
    assert_claim "$child" "$CHILD"
    echo 540000 > "$FIXTURE/reject.advance"
    sleep 0.5
    assert [ "$(grep -c 'test poll sync attempt' "$FIXTURE/child.log")" = 1 ]
    echo 600001 > "$FIXTURE/reject.advance"
    for _ in {1..40}; do
        if [ "$(grep -c 'test poll sync attempt' "$FIXTURE/child.log")" -ge 2 ]; then break; fi
        sleep 0.05
    done
    sleep 0.5
    assert [ "$(grep -c 'test poll sync attempt' "$FIXTURE/child.log")" = 2 ]
    assert [ "$(grep -c 'Free tier quota exceeded' "$FIXTURE/child.log")" = 1 ]
    rm "$FIXTURE/reject"
    echo 1200002 > "$FIXTURE/reject.advance"
    wait_active "$FIXTURE/child.log"
    assert [ "$(grep -c 'test poll sync attempt' "$FIXTURE/child.log")" = 3 ]
    echo recovered >> "$CHILD/child.txt"
    wait_log "$FIXTURE/child.log" ": $CHILD/child.txt"
    assert_claim "$child" "$CHILD"
}

@test "parent started after child excludes child uploads then takes over its subtree" {
    start_watcher "$CHILD" "$FIXTURE/child.log"
    child=$WATCH_PID
    wait_active "$FIXTURE/child.log"
    kill -STOP "$child"
    echo child-change >> "$CHILD/child.txt"
    echo parent-change >> "$ROOT/parent.txt"
    start_watcher "$ROOT" "$FIXTURE/parent.log" --max-file-count 1
    wait_active "$FIXTURE/parent.log"
    assert [ "$(claim_count)" = 2 ]
    grep -q 'uploaded 1' "$FIXTURE/parent.log"
    grep -q "Initial sync complete (1/1)" "$FIXTURE/parent.log"
    kill -CONT "$child"
    wait_log "$FIXTURE/child.log" ": $CHILD/child.txt"
    sleep 0.3
    ! grep -Fq "change: $CHILD/child.txt" "$FIXTURE/parent.log"
    ! grep -Fq "rename: $CHILD/child.txt" "$FIXTURE/parent.log"
    kill -TERM "$child"
    wait "$child"
    # Resync is visible even if every file is already up to date.
    for _ in {1..30}; do
        if [ "$(grep -c 'Initial sync complete' "$FIXTURE/parent.log")" -ge 2 ]; then break; fi
        sleep 0.1
    done
    assert [ "$(grep -c 'Initial sync complete' "$FIXTURE/parent.log")" -ge 2 ]
    sleep 0.15
    echo parent-takeover >> "$CHILD/child.txt"
    wait_log "$FIXTURE/parent.log" ": $CHILD/child.txt"
}

@test "yaml config child remains independent and parent preserves excluded store files" {
    echo 'maxFileSize: 1' > "$CHILD/.mgreprc.yaml"
    # This absent child file would be deleted by an ancestor without exclusions.
    rm "$CHILD/child.txt"
    echo changed >> "$ROOT/parent.txt"
    start_watcher "$ROOT" "$FIXTURE/parent.log" --max-file-count 1
    wait_active "$FIXTURE/parent.log"
    grep -q 'uploaded 1' "$FIXTURE/parent.log"
    ! grep -q 'deleted' "$FIXTURE/parent.log"
    node - "$CHILD/child.txt" <<'JS'
const fs = require('fs');
if (!JSON.parse(fs.readFileSync(process.env.MGREP_TEST_STORE_PATH)).files[process.argv[2]]) process.exit(1);
JS
    # Restore before the child starts; mutations are sequential because TestStore
    # only serializes writes within a process, not between concurrent processes.
    echo 'child content' > "$CHILD/child.txt"
    start_watcher "$CHILD" "$FIXTURE/child.log"
    child=$WATCH_PID
    wait_active "$FIXTURE/child.log"
    assert_claim "$child" "$CHILD"
    assert [ "$(claim_count)" = 2 ]
    ! grep -q 'standing by' "$FIXTURE/child.log"
    kill -TERM "$child"
    wait "$child"
    sleep 0.3
    echo boundary-stays >> "$CHILD/new.txt"
    sleep 0.3
    ! grep -Fq "$CHILD/new.txt" "$FIXTURE/parent.log"
    assert [ "$(grep -c 'Initial sync complete' "$FIXTURE/parent.log")" = 1 ]
}

@test "yml boundary between ancestor and grandchild prevents coverage" {
    echo 'maxFileCount: 5' > "$CHILD/.mgreprc.yml"
    mkdir "$CHILD/nested"
    start_watcher "$ROOT" "$FIXTURE/parent.log"
    wait_active "$FIXTURE/parent.log"
    start_watcher "$CHILD/nested" "$FIXTURE/grandchild.log"
    wait_active "$FIXTURE/grandchild.log"
    assert [ "$(claim_count)" = 2 ]
    ! grep -q 'standing by' "$FIXTURE/grandchild.log"
}

@test "dead pid claim is pruned and directory is claimable" {
    node - "$ROOT" <<'JS'
const fs = require('fs');
const root = process.argv[2];
const file = `${process.env.MGREP_WATCH_REGISTRY_DIR}/${Buffer.from(`mgrep\0${root}`).toString('base64url')}.json`;
fs.writeFileSync(file, JSON.stringify({pid: 99999999, root, store: 'mgrep', startedAt: 1}));
JS
    start_watcher "$ROOT" "$FIXTURE/watch.log"
    wait_active "$FIXTURE/watch.log"
    assert_claim "$WATCH_PID" "$ROOT"
    assert [ "$(claim_count)" = 1 ]
}

@test "live unrelated pid claim is pruned and a missing owned claim self heals" {
    sleep 30 3>&- &
    unrelated=$!
    PIDS+=("$unrelated")
    node - "$ROOT" "$unrelated" <<'JS'
const fs = require('fs');
const root = process.argv[2];
const file = `${process.env.MGREP_WATCH_REGISTRY_DIR}/${Buffer.from(`mgrep\0${root}`).toString('base64url')}.json`;
fs.writeFileSync(file, JSON.stringify({pid: Number(process.argv[3]), root, store: 'mgrep', startedAt: 1}));
JS
    start_watcher "$ROOT" "$FIXTURE/watch.log"
    wait_active "$FIXTURE/watch.log"
    assert_claim "$WATCH_PID" "$ROOT"
    rm "$MGREP_WATCH_REGISTRY_DIR"/*.json
    sleep 0.3
    assert_claim "$WATCH_PID" "$ROOT"
    kill -0 "$unrelated"
}

@test "dry run skips coordination and failed initial sync releases its claim" {
    start_watcher "$ROOT" "$FIXTURE/watch.log"
    active=$WATCH_PID
    wait_active "$FIXTURE/watch.log"
    run mgrep watch --dry-run
    assert_success
    assert_output --partial 'Initial sync complete'
    refute_output --partial 'standing by'
    assert [ "$(claim_count)" = 1 ]
    kill -TERM "$active"
    wait "$active"
    echo new > "$ROOT/extra.txt"
    echo new > "$ROOT/extra-2.txt"
    run mgrep watch --max-file-count 1
    assert_failure
    assert_output --partial 'File count exceeded'
    assert [ "$(claim_count)" = 0 ]
}

@test "realpath aliases share claims but path-prefix siblings and stores do not" {
    ln -s "$ROOT" "$FIXTURE/alias"
    mkdir "$ROOT/services-other"
    start_watcher "$CHILD" "$FIXTURE/child.log"
    wait_active "$FIXTURE/child.log"
    start_watcher "$FIXTURE/alias/services" "$FIXTURE/alias.log"
    wait_log "$FIXTURE/alias.log" 'standing by'
    start_watcher "$ROOT/services-other" "$FIXTURE/sibling.log"
    wait_active "$FIXTURE/sibling.log"
    start_watcher "$CHILD" "$FIXTURE/other-store.log" --store another-store
    wait_active "$FIXTURE/other-store.log"
    assert [ "$(claim_count)" = 3 ]
}

@test "claim ownership, coverage ordering and pid tie breaks are enforced" {
    run node --title=mgrep-registry-test --input-type=module - "$DIR/../dist" "$ROOT" <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { claimWatch, ensureClaim, releaseWatch, listActiveWatches, findCoveringWatch } =
  await import(pathToFileURL(`${process.argv[2]}/lib/lock.js`));
const root = process.argv[3];
const claim = claimWatch('test', root, 10);
assert.ok(claim);
assert.equal(claimWatch('test', root, 11), null);
assert.equal(listActiveWatches('other').length, 0);
assert.deepEqual(listActiveWatches('test'), [claim]);
const file = `${process.env.MGREP_WATCH_REGISTRY_DIR}/${Buffer.from(`test\0${root}`).toString('base64url')}.json`;
fs.unlinkSync(file);
ensureClaim(claim);
assert.deepEqual(JSON.parse(fs.readFileSync(file)), claim);
const replacement = {...claim, pid: 99999999};
fs.writeFileSync(file, JSON.stringify(replacement));
ensureClaim(claim);
releaseWatch(claim);
assert.deepEqual(JSON.parse(fs.readFileSync(file)), replacement);
assert.equal(listActiveWatches('test').length, 0);
assert.equal(fs.existsSync(file), false);
const mine = {pid: 30, startedAt: 10};
const earlier = {...claim, pid: 20};
const later = {...claim, pid: 40};
assert.equal(findCoveringWatch(`${root}/services`, mine, [later, earlier])?.pid, 20);
assert.equal(findCoveringWatch(`${root}/services`, mine, [later]), undefined);
assert.equal(findCoveringWatch(root, mine, [{...claim, ...mine}]), undefined);
fs.writeFileSync(`${root}/services/.mgreprc.yml`, 'maxFileCount: 1');
assert.equal(findCoveringWatch(`${root}/services`, mine, [earlier]), undefined);
assert.equal(findCoveringWatch(`${root}/services`, mine, [{...earlier, root: `${root}/services`}])?.pid, 20);
JS
    assert_success
    assert [ "$(claim_count)" = 0 ]
}

@test "quota and thrown initialSync failures leave no claim" {
    echo new-file > "$ROOT/new.txt"
    for failure in quota thrown; do
        run node --title=mgrep-failure-test --input-type=module - "$DIR/../dist" "$failure" <<'JS'
import { pathToFileURL } from 'node:url';
const base = process.argv[2];
const { TestStore } = await import(pathToFileURL(`${base}/lib/store.js`));
TestStore.prototype.uploadFile = async function () {
  throw new Error('Free tier quota exceeded');
};
if (process.argv[3] === 'thrown') {
  TestStore.prototype.listFiles = async function* () { throw new Error('initialSync threw'); };
}
const { startWatch } = await import(pathToFileURL(`${base}/commands/watch.js`));
await startWatch({store: 'mgrep', dryRun: false});
JS
        assert_failure
        if [ "$failure" = quota ]; then
            assert_output --partial 'Quota exceeded'
        else
            assert_output --partial 'Failed to start watcher: initialSync threw'
        fi
        assert [ "$(claim_count)" = 0 ]
    done
}

@test "per-file initial upload errors keep the claim and keep watching" {
    echo new-file > "$ROOT/new.txt"
    touch "$FIXTURE/reject"
    start_injected_watcher "$ROOT" "$FIXTURE/watch.log" upload
    wait_active "$FIXTURE/watch.log"
    wait_log "$FIXTURE/watch.log" '1 file(s) failed to upload'
    assert_claim "$WATCH_PID" "$ROOT"
    kill -0 "$WATCH_PID"
    rm "$FIXTURE/reject"
    echo recovered >> "$ROOT/new.txt"
    wait_log "$FIXTURE/watch.log" ": $ROOT/new.txt"
    assert_claim "$WATCH_PID" "$ROOT"
}

@test "changed-file upload failure keeps watching and a later change uploads" {
    start_injected_watcher "$ROOT" "$FIXTURE/watch.log" upload
    wait_active "$FIXTURE/watch.log"
    touch "$FIXTURE/reject"
    echo failed-change >> "$ROOT/parent.txt"
    wait_log "$FIXTURE/watch.log" "Failed to upload changed file: $ROOT/parent.txt"
    assert_claim "$WATCH_PID" "$ROOT"
    kill -0 "$WATCH_PID"
    rm "$FIXTURE/reject"
    echo recovered-change >> "$ROOT/parent.txt"
    wait_log "$FIXTURE/watch.log" ": $ROOT/parent.txt"
    node - "$ROOT/parent.txt" <<'JS'
const fs = require('fs');
const file = JSON.parse(fs.readFileSync(process.env.MGREP_TEST_STORE_PATH)).files[process.argv[2]];
if (!file.content.includes('recovered-change')) process.exit(1);
JS
    assert_claim "$WATCH_PID" "$ROOT"
}

@test "changed-file delete failure keeps watching and claimed" {
    start_injected_watcher "$ROOT" "$FIXTURE/watch.log" delete
    wait_active "$FIXTURE/watch.log"
    touch "$FIXTURE/reject"
    rm "$ROOT/parent.txt"
    wait_log "$FIXTURE/watch.log" "Failed to delete file: $ROOT/parent.txt"
    assert_claim "$WATCH_PID" "$ROOT"
    kill -0 "$WATCH_PID"
    rm "$FIXTURE/reject"
    echo recovered >> "$CHILD/child.txt"
    wait_log "$FIXTURE/watch.log" ": $CHILD/child.txt"
    assert_claim "$WATCH_PID" "$ROOT"
}

@test "directory watcher error closes only that directory and keeps the claim" {
    mkdir "$CHILD/nested"
    echo nested > "$CHILD/nested/file.txt"
    start_injected_watcher "$ROOT" "$FIXTURE/watch.log" directory
    wait_active "$FIXTURE/watch.log"
    touch "$FIXTURE/reject"
    wait_log "$FIXTURE/watch.log" "Failed to watch $CHILD:"
    wait_log "$FIXTURE/watch.log" "closed directory: $CHILD"
    assert_claim "$WATCH_PID" "$ROOT"
    kill -0 "$WATCH_PID"
    echo recovered >> "$ROOT/parent.txt"
    wait_log "$FIXTURE/watch.log" ": $ROOT/parent.txt"
    echo recovered >> "$CHILD/nested/file.txt"
    wait_log "$FIXTURE/watch.log" ": $CHILD/nested/file.txt"
    assert_claim "$WATCH_PID" "$ROOT"
}

@test "coordination poll failure is logged and retried with the claim intact" {
    start_injected_watcher "$ROOT" "$FIXTURE/watch.log" poll
    wait_active "$FIXTURE/watch.log"
    touch "$FIXTURE/reject"
    wait_log "$FIXTURE/watch.log" 'injected poll failure'
    assert_claim "$WATCH_PID" "$ROOT"
    rm "$MGREP_WATCH_REGISTRY_DIR"/*.json
    sleep 0.3
    assert_claim "$WATCH_PID" "$ROOT"
    echo recovered >> "$ROOT/parent.txt"
    wait_log "$FIXTURE/watch.log" ": $ROOT/parent.txt"
}

@test "failed released-subtree resync is retried and installs subtree watchers" {
    for failure in sync sync-quota sync-count; do
        start_watcher "$CHILD" "$FIXTURE/child.log"
        child=$WATCH_PID
        wait_active "$FIXTURE/child.log"
        start_injected_watcher "$ROOT" "$FIXTURE/parent.log" "$failure"
        parent=$WATCH_PID
        wait_active "$FIXTURE/parent.log"
        touch "$FIXTURE/reject"
        kill -TERM "$child"
        wait "$child"
        wait_log "$FIXTURE/parent.log" 'Failed to coordinate watcher:'
        if [ "$failure" = sync-quota ]; then
            sleep 0.5
            assert [ "$(grep -c 'Initial sync complete' "$FIXTURE/parent.log")" = 1 ]
            echo 600001 > "$FIXTURE/reject.advance"
        fi
        for _ in {1..30}; do
            if [ "$(grep -c 'Initial sync complete' "$FIXTURE/parent.log")" -ge 2 ]; then break; fi
            sleep 0.1
        done
        assert [ "$(grep -c 'Initial sync complete' "$FIXTURE/parent.log")" -ge 2 ]
        assert_claim "$parent" "$ROOT"
        sleep 0.15
        echo recovered >> "$CHILD/child.txt"
        wait_log "$FIXTURE/parent.log" ": $CHILD/child.txt"
        kill -TERM "$parent"
        wait "$parent"
    done
}

@test "store retrieve and create failure releases the startup claim" {
    run node --title=mgrep-store-failure-test --input-type=module - "$DIR/../dist" <<'JS'
import { pathToFileURL } from 'node:url';
const base = process.argv[2];
const { TestStore } = await import(pathToFileURL(`${base}/lib/store.js`));
TestStore.prototype.retrieve = async function () { throw new Error('retrieve failed'); };
TestStore.prototype.create = async function () { throw new Error('create failed'); };
const { startWatch } = await import(pathToFileURL(`${base}/commands/watch.js`));
await startWatch({store: 'mgrep', dryRun: false});
JS
    assert_failure
    assert_output --partial 'Failed to start watcher: create failed'
    assert [ "$(claim_count)" = 0 ]
}

@test "old invalid claims are pruned by claiming and listing but fresh claims block" {
    run node --title=mgrep-stale-test --input-type=module - "$DIR/../dist" "$ROOT" <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { claimWatch, releaseWatch, listActiveWatches } =
  await import(pathToFileURL(`${process.argv[2]}/lib/lock.js`));
const root = process.argv[3];
const file = `${process.env.MGREP_WATCH_REGISTRY_DIR}/${Buffer.from(`mgrep\0${root}`).toString('base64url')}.json`;
for (const content of ['{', JSON.stringify({pid: 'invalid'})]) {
  fs.writeFileSync(file, content);
  assert.equal(claimWatch('mgrep', root, Date.now()), null);
  assert.deepEqual(listActiveWatches('mgrep'), []);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  const old = new Date(Date.now() - 31000);
  fs.utimesSync(file, old, old);
  const claim = claimWatch('mgrep', root, Date.now());
  assert.ok(claim);
  releaseWatch(claim);
  fs.writeFileSync(file, content);
  fs.utimesSync(file, old, old);
  assert.deepEqual(listActiveWatches('mgrep'), []);
  assert.equal(fs.existsSync(file), false);
  const afterPrune = claimWatch('mgrep', root, Date.now());
  assert.ok(afterPrune);
  releaseWatch(afterPrune);
}
JS
    assert_success
    assert [ "$(claim_count)" = 0 ]
}

@test "initialSync realpaths excluded aliases before counting uploads or deletions" {
    ln -s "$CHILD" "$FIXTURE/excluded-alias"
    rm "$CHILD/child.txt"
    echo untouched > "$CHILD/new.txt"
    run node --title=mgrep-sync-test --input-type=module - "$DIR/../dist" "$ROOT" "$FIXTURE/excluded-alias" <<'JS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const base = process.argv[2];
const { initialSync } = await import(pathToFileURL(`${base}/lib/utils.js`));
const { createFileSystem, createStore } = await import(pathToFileURL(`${base}/lib/context.js`));
const { loadConfig } = await import(pathToFileURL(`${base}/lib/config.js`));
const result = await initialSync(await createStore(), createFileSystem(), 'mgrep', process.argv[3],
  false, undefined, loadConfig(process.argv[3], {maxFileCount: 1}), [process.argv[4]]);
assert.deepEqual(result, {processed: 1, uploaded: 0, deleted: 0, errors: 0, total: 1});
JS
    assert_success
}
