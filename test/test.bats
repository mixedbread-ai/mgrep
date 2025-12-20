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

@test "Text files are uploaded, binary files are skipped" {
    echo "uniquetextcontent123" > "$BATS_TMPDIR/test-store/textfile.log"
    cp "$DIR/assets/model.safetensors" "$BATS_TMPDIR/test-store/model.safetensors"
    printf 'uniquebinarycontent456\x00\x01\x02' > "$BATS_TMPDIR/test-store/binaryfile.bin"

    run mgrep watch --dry-run
    assert_success
    assert_output --partial 'textfile.log'
    refute_output --partial 'model.safetensors'
    refute_output --partial 'binaryfile.bin'
}

# bats test_tags=long-running
@test "Handles large git repositories with >1MB ls-files output" {
    rm -rf "$BATS_TMPDIR/large-repo"
    mkdir -p "$BATS_TMPDIR/large-repo"
    cd "$BATS_TMPDIR/large-repo"
    
    git init
    git config user.email "test@example.com"
    git config user.name "Test User"
    
    for i in {1..10000}; do
        dir="very-long-directory-name-that-increases-path-length-significantly/subdir-$i"
        mkdir -p "$dir"
        filename="very-long-filename-that-makes-the-git-ls-files-output-large-and-tests-the-buffer-size-limitation-file-number-$i.txt"
        echo "Content of file $i" > "$dir/$filename"
    done
    
    git add .
    git commit -m "Initial commit with many files"
    
    run mgrep search --max-file-count 1000000 --sync "Content"
    
    assert_success
    assert [ $(echo "$output" | grep -c "very-long-filename") -gt 0 ]
}

@test "Sync deletes files from store that are not present locally" {
    rm "$BATS_TMPDIR/test-store/test-2.txt"
    run mgrep watch --dry-run

    assert_success
    assert_output --partial 'would have deleted'
    assert_output --partial 'test-2.txt'
    refute_output --partial 'test.txt'
    refute_output --partial 'test-3.txt'
}

@test "Search sync deletes files from store that are not present locally" {
    rm "$BATS_TMPDIR/test-store/test-2.txt"
    run mgrep search --sync --dry-run test

    assert_success
    assert_output --partial 'would have deleted'
    assert_output --partial 'test-2.txt'
}

@test "Sync only deletes store files within the current path" {
    mkdir -p "$BATS_TMPDIR/test-store/subdir"
    echo "Subdir file" > "$BATS_TMPDIR/test-store/subdir/sub.txt"
    run mgrep search --sync test
    assert_success

    rm "$BATS_TMPDIR/test-store/test-2.txt"
    cd "$BATS_TMPDIR/test-store/subdir"
    run mgrep watch --dry-run

    assert_success
    refute_output --partial 'test-2.txt'
}

@test "Sync from subdirectory only processes files in that subdirectory" {
    mkdir -p "$BATS_TMPDIR/test-store/projectA"
    mkdir -p "$BATS_TMPDIR/test-store/projectB"
    echo "Project A file 1" > "$BATS_TMPDIR/test-store/projectA/a1.txt"
    echo "Project A file 2" > "$BATS_TMPDIR/test-store/projectA/a2.txt"
    echo "Project B file 1" > "$BATS_TMPDIR/test-store/projectB/b1.txt"

    run mgrep search --sync test
    assert_success

    echo "Modified A file 1" > "$BATS_TMPDIR/test-store/projectA/a1.txt"

    cd "$BATS_TMPDIR/test-store/projectA"
    run mgrep watch --dry-run

    assert_success
    assert_output --partial 'a1.txt'
    refute_output --partial 'b1.txt'
    refute_output --partial 'test.txt'
}

@test "Config maxFileSize skips large files (YAML)" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    echo 'maxFileSize: 50' > "$BATS_TMPDIR/test-store/.mgreprc.yaml"

    echo "small" > "$BATS_TMPDIR/test-store/small.txt"
    dd if=/dev/zero bs=100 count=1 2>/dev/null | tr '\0' 'x' > "$BATS_TMPDIR/test-store/large.txt"

    cd "$BATS_TMPDIR/test-store"
    run mgrep watch --dry-run

    assert_success
    assert_output --partial 'small.txt'
    refute_output --partial 'large.txt'
}

@test "Config file .mgreprc.yml also works" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    echo 'maxFileSize: 50' > "$BATS_TMPDIR/test-store/.mgreprc.yml"

    echo "tiny" > "$BATS_TMPDIR/test-store/tiny.txt"
    dd if=/dev/zero bs=100 count=1 2>/dev/null | tr '\0' 'y' > "$BATS_TMPDIR/test-store/big.txt"

    cd "$BATS_TMPDIR/test-store"
    run mgrep watch --dry-run

    assert_success
    assert_output --partial 'tiny.txt'
    refute_output --partial 'big.txt'
}

@test "Config CLI flag overrides config file" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    echo 'maxFileSize: 1000000' > "$BATS_TMPDIR/test-store/.mgreprc.yaml"

    echo "tiny" > "$BATS_TMPDIR/test-store/tiny.txt"
    dd if=/dev/zero bs=100 count=1 2>/dev/null | tr '\0' 'y' > "$BATS_TMPDIR/test-store/medium.txt"

    cd "$BATS_TMPDIR/test-store"
    run mgrep watch --dry-run --max-file-size 50

    assert_success
    assert_output --partial 'tiny.txt'
    refute_output --partial 'medium.txt'
}

@test "Config env variable overrides config file" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"
    echo 'maxFileSize: 1000000' > "$BATS_TMPDIR/test-store/.mgreprc.yaml"

    echo "mini" > "$BATS_TMPDIR/test-store/mini.txt"
    dd if=/dev/zero bs=100 count=1 2>/dev/null | tr '\0' 'z' > "$BATS_TMPDIR/test-store/bigger.txt"

    cd "$BATS_TMPDIR/test-store"
    export MGREP_MAX_FILE_SIZE=50
    run mgrep watch --dry-run
    unset MGREP_MAX_FILE_SIZE

    assert_success
    assert_output --partial 'mini.txt'
    refute_output --partial 'bigger.txt'
}

@test "Search with web flag" {
    run mgrep search --web test

    assert_success
    assert_output --partial 'test.txt'
}

@test "Config maxFileCount fails when exceeded" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"

    mkdir -p "$BATS_TMPDIR/max-file-count-test"
    cd "$BATS_TMPDIR/max-file-count-test"
    for i in {1..5}; do
        echo "file $i" > "file-$i.txt"
    done

    run mgrep watch --dry-run --max-file-count 3

    assert_failure
    assert_output --partial 'File count (5) exceeds the maximum allowed (3)'
    assert_output --partial 'No files were uploaded'
}

@test "Config maxFileCount succeeds when not exceeded" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"

    mkdir -p "$BATS_TMPDIR/max-file-count-pass-test"
    cd "$BATS_TMPDIR/max-file-count-pass-test"
    for i in {1..3}; do
        echo "file $i" > "file-$i.txt"
    done

    run mgrep watch --dry-run --max-file-count 5

    assert_success
    assert_output --partial 'file-1.txt'
}

@test "Config maxFileCount via YAML" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"

    mkdir -p "$BATS_TMPDIR/max-file-count-yaml-test"
    cd "$BATS_TMPDIR/max-file-count-yaml-test"
    echo 'maxFileCount: 2' > ".mgreprc.yaml"
    for i in {1..4}; do
        echo "file $i" > "file-$i.txt"
    done

    run mgrep watch --dry-run

    assert_failure
    assert_output --partial 'File count (4) exceeds the maximum allowed (2)'
}

@test "Config maxFileCount env variable" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"

    mkdir -p "$BATS_TMPDIR/max-file-count-env-test"
    cd "$BATS_TMPDIR/max-file-count-env-test"
    for i in {1..4}; do
        echo "file $i" > "file-$i.txt"
    done

    export MGREP_MAX_FILE_COUNT=2
    run mgrep watch --dry-run
    unset MGREP_MAX_FILE_COUNT

    assert_failure
    assert_output --partial 'File count (4) exceeds the maximum allowed (2)'
}

@test "Config maxFileCount CLI overrides env variable" {
    rm "$BATS_TMPDIR/mgrep-test-store.json"

    mkdir -p "$BATS_TMPDIR/max-file-count-override-test"
    cd "$BATS_TMPDIR/max-file-count-override-test"
    for i in {1..4}; do
        echo "file $i" > "file-$i.txt"
    done

    export MGREP_MAX_FILE_COUNT=100
    run mgrep watch --dry-run --max-file-count 2
    unset MGREP_MAX_FILE_COUNT

    assert_failure
    assert_output --partial 'File count (4) exceeds the maximum allowed (2)'
}

@test "Search allows home directory without sync" {
    cd "$HOME"
    run mgrep search test

    assert_success
}

@test "Search with sync rejects home directory" {
    cd "$HOME"
    run mgrep search --sync test

    assert_failure
    assert_output --partial 'Cannot sync home directory'
}

@test "Sync from folder does not include files from folder with same prefix" {
    mkdir -p "$BATS_TMPDIR/test-store/foo"
    mkdir -p "$BATS_TMPDIR/test-store/foobar"
    echo "File in foo" > "$BATS_TMPDIR/test-store/foo/file-in-foo.txt"
    echo "File in foobar" > "$BATS_TMPDIR/test-store/foobar/file-in-foobar.txt"

    cd "$BATS_TMPDIR/test-store/foobar"
    run mgrep watch --dry-run

    assert_success
    assert_output --partial 'file-in-foobar.txt'
    refute_output --partial 'file-in-foo.txt'

    cd "$BATS_TMPDIR/test-store/foo"
    run mgrep watch --dry-run

    assert_success
    assert_output --partial 'file-in-foo.txt'
    refute_output --partial 'file-in-foobar.txt'
}
