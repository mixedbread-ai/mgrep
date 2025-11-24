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
    refute_output --partial 'without reranking'
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

@test "Search with .gitignore" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    echo "*.txt" > "$BATS_TMPDIR/test-store/.gitignore"
    run mgrep search --sync test

    assert_success
    refute_output --partial 'test.txt'
    refute_output --partial 'test-2.txt'
    refute_output --partial 'test-3.txt'
}

@test "Search with .gitignore recursive" {
    # A .gitignore file in a subdirectory should be respected
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    mkdir -p "$BATS_TMPDIR/test-store/test-dir"
    echo "*.txt" > "$BATS_TMPDIR/test-store/test-dir/.gitignore"
    echo "Hello, world!\nA fourth test." > "$BATS_TMPDIR/test-store/test-dir/test-4.txt"
    run mgrep search --sync test

    assert_success
    assert_output --partial 'test.txt'
    refute_output --partial 'test-4.txt'
}

@test "Search with .mgrepignore" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    echo "*.txt" > "$BATS_TMPDIR/test-store/.mgrepignore"
    run mgrep search --sync test

    assert_success
    refute_output --partial 'test.txt'
    refute_output --partial 'test-2.txt'
    refute_output --partial 'test-3.txt'
}

@test "Search with .mgrepignore recursive" {
    # A .mgrepignore file in a subdirectory should be respected
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    mkdir -p "$BATS_TMPDIR/test-store/test-dir"
    echo "*.txt" > "$BATS_TMPDIR/test-store/test-dir/.mgrepignore"
    echo "Hello, world!\nA fourth test." > "$BATS_TMPDIR/test-store/test-dir/test-4.txt"
    run mgrep search --sync test

    assert_success
    assert_output --partial 'test.txt'
    refute_output --partial 'test-4.txt'
}

@test "Search with .mgrepignore recursive and allow patterns" {
    # A .mgrepignore file in a subdirectory should be respected
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    mkdir -p "$BATS_TMPDIR/test-store/test-dir"
    printf "*.txt\n!test-5.txt" > "$BATS_TMPDIR/test-store/test-dir/.mgrepignore"
    echo "Hello, world!\nA fourth test." > "$BATS_TMPDIR/test-store/test-dir/test-4.txt"
    echo "Hello, world!\nA fifth test." > "$BATS_TMPDIR/test-store/test-dir/test-5.txt"
    run mgrep search --sync test

    assert_success
    assert_output --partial 'test.txt'
    assert_output --partial 'test-5.txt'
    refute_output --partial 'test-4.txt'
}

@test "Search with path scoping" {
    # Search within a subdirectory
    mkdir -p "$BATS_TMPDIR/test-store/sub"
    echo "Hello sub" > "$BATS_TMPDIR/test-store/sub/sub.txt"
    
    # Sync only the sub folder? Or sync everything and search in sub.
    # mgrep search --sync will sync current dir.
    run mgrep search --sync Hello

    # Search in sub
    run mgrep search Hello sub

    assert_success
    assert_output --partial 'sub.txt'
    refute_output --partial 'test.txt'
}

@test "Search non-existent path" {
    run mgrep search Hello /does/not/exist

    assert_success
    refute_output --partial 'test.txt'
    refute_output --partial 'Hello, world!'
}

@test "Watch dry run respects ignores" {
    mkdir -p "$BATS_TMPDIR/test-store/watch-test"
    echo "*.log" > "$BATS_TMPDIR/test-store/watch-test/.gitignore"
    echo "Should be ignored" > "$BATS_TMPDIR/test-store/watch-test/test.log"
    echo "Should be watched" > "$BATS_TMPDIR/test-store/watch-test/test.txt"
    
    cd "$BATS_TMPDIR/test-store/watch-test"
    run mgrep watch --dry-run
    
    assert_success
    assert_output --partial 'test.txt'
    refute_output --partial 'test.log'
}

@test "Search with no rerank" {
    run mgrep search -c --no-rerank test

    assert_success
    assert_output --partial 'test.txt'
    assert_output --partial 'without reranking'
}

@test "Search with no rerank environment variable" {
    export MGREP_RERANK=0
    output=$(mgrep search -c test)

    assert_output --partial 'test.txt'
    assert_output --partial 'without reranking'
}
