#!/bin/bash

setup_file() {
  pnpm build
}

setup() {
    load '../node_modules/bats-support/load'
    load '../node_modules/bats-assert/load'

    # get the containing directory of this file
    DIR="$( cd "$( dirname "$BATS_TEST_FILENAME" )" >/dev/null 2>&1 && pwd )"
    
    # Create a temporary bin directory for the test executable
    mkdir -p "$BATS_TMPDIR/bin"
    ln -sf "$DIR/../dist/index.js" "$BATS_TMPDIR/bin/mgrep"
    PATH="$BATS_TMPDIR/bin:$PATH"

    export MGREP_IS_TEST=1
    export MGREP_TEST_STORE_PATH="$BATS_TMPDIR/mgrep-test-store.json"

    mkdir -p "$BATS_TMPDIR/test-store"
    touch "$BATS_TMPDIR/test-store/test.txt"
    echo "Hello, world!\nThis is a test file." > "$BATS_TMPDIR/test-store/test.txt"
    echo "Hello, world!\nA second one." > "$BATS_TMPDIR/test-store/test-2.txt"
    echo "Hello, world!\nA third one." > "$BATS_TMPDIR/test-store/test-3.txt"
    cd "$BATS_TMPDIR/test-store"
    mgrep search --sync test
}

teardown() {
    rm -f "$MGREP_TEST_STORE_PATH"
    rm -rf "$BATS_TMPDIR/test-store"
}

@test "Prints help" {
    run mgrep --help

    assert_success
    assert_output --partial 'Usage: mgrep'
    assert_output --partial 'Options:'
    assert_output --partial 'Commands:'
}

@test "Prints version" {
    run mgrep --version

    assert_success
    assert_output --regexp '^[0-9]+\.[0-9]+\.[0-9]+$'
}

@test "Search" {
    run mgrep search test

    assert_success
    assert_output --partial 'test.txt'
    refute_output --partial 'test-2.txt'
}

@test "Search with answer" {
    run mgrep search -a test

    assert_success
    assert_output --partial 'test.txt'
    assert_output --partial 'This is a mock answer'
}

@test "Search with content" {
    run mgrep search --content test

    assert_success
    assert_output --partial 'test.txt'
    assert_output --partial 'Hello, world!'
    assert_output --partial 'This is a test file.'
}

@test "Search with max count" {
    run mgrep search --max-count 1 "Hello, world!"

    assert_success
    # The number of lines should be 1. The stdout is stored in $output
    assert [ $(echo "$output" | wc -l) -eq 1 ]
}

@test "Search with max count 2" {
    run mgrep search --max-count 2 "Hello, world!"

    assert_success
    # The number of lines should be 2. The stdout is stored in $output
    assert [ $(echo "$output" | wc -l) -eq 2 ]
}

@test "Search with dry run" {
    echo "Hello, world!\nA fourth one." > "$BATS_TMPDIR/test-store/test-4.txt"
    run mgrep watch --dry-run

    assert_success
    assert_output --partial 'Dry run: found'
    assert_output --partial 'would have uploaded 1 changed or new files'
    assert_output --partial 'test-4.txt'
}

@test "Search with sync" {
    run mgrep search --sync test

    assert_success
    assert_output --partial 'Indexing files...'
    assert_output --partial 'Indexing complete'
}