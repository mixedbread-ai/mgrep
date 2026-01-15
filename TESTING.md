# Testing Guide

This document describes the testing strategy, patterns, and best practices for mgrep.

## Overview

mgrep uses [bats](https://bats-core.readthedocs.io/en/stable/) (Bash Automated Testing System) for integration testing. Tests focus on CLI behavior and end-to-end workflows.

## Running Tests

```bash
# Run all tests (excludes long-running tests)
pnpm test

# Run all tests including long-running
bats test/test.bats

# Run specific test by name pattern
bats test/test.bats --filter "Search"

# Run with verbose output
bats test/test.bats --verbose-run
```

## Test Structure

### File Organization

```
test/
├── test.bats           # Main test file
└── assets/             # Test fixtures and sample files
```

### Test Anatomy

```bash
@test "descriptive test name" {
    # Setup (optional)
    echo "test content" > "$BATS_TMPDIR/test-file.txt"

    # Execute
    run mgrep command args

    # Assert
    assert_success                        # Exit code 0
    assert_output --partial "expected"    # Contains substring
    assert_output --regexp "pattern"      # Matches regex
}
```

### Setup and Teardown

```bash
# Runs once before all tests in the file
setup_file() {
    pnpm build
}

# Runs before each test
setup() {
    load '../node_modules/bats-support/load'
    load '../node_modules/bats-assert/load'

    # Create test environment
    mkdir -p "$BATS_TMPDIR/test-store"
    export MGREP_IS_TEST=1
}

# Runs after each test
teardown() {
    rm -rf "$BATS_TMPDIR/test-store"
}
```

## Writing Tests

### Test Categories

#### Command Tests

Test each CLI command works correctly:

```bash
@test "search command returns results" {
    run mgrep search "query"
    assert_success
    assert_output --partial "expected-file.txt"
}
```

#### Option Tests

Test command-line options:

```bash
@test "search with --max-count limits results" {
    run mgrep search --max-count 5 "query"
    assert_success
    assert [ $(echo "$output" | wc -l) -le 5 ]
}
```

#### Error Handling Tests

Test error conditions:

```bash
@test "search without auth shows error" {
    unset MXBAI_API_KEY
    run mgrep search "query"
    assert_failure
    assert_output --partial "authentication"
}
```

#### Integration Tests

Test workflows that span multiple commands:

```bash
@test "watch then search finds indexed files" {
    # Create test files
    echo "unique content" > "$BATS_TMPDIR/test.txt"

    # Index
    run mgrep watch --once
    assert_success

    # Search
    run mgrep search "unique content"
    assert_success
    assert_output --partial "test.txt"
}
```

### Assertion Reference

| Assertion | Description |
|-----------|-------------|
| `assert_success` | Exit code is 0 |
| `assert_failure` | Exit code is non-zero |
| `assert_output "exact"` | Output equals string exactly |
| `assert_output --partial "text"` | Output contains substring |
| `assert_output --regexp "pat"` | Output matches regex |
| `refute_output --partial "text"` | Output does NOT contain |
| `assert_line "text"` | A line equals string |
| `assert_line --partial "text"` | A line contains substring |

### Tagging Tests

Use tags for test categorization:

```bash
# Tag a test as long-running (excluded from default run)
# bats test_tags=long-running
@test "full index of large repo" {
    ...
}

# Multiple tags
# bats test_tags=slow,network
@test "web search integration" {
    ...
}
```

Run tagged tests:
```bash
# Include long-running tests
bats test/test.bats --filter-tags long-running

# Exclude specific tags
bats test/test.bats --filter-tags '!network'
```

## Test Environment

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `MGREP_IS_TEST=1` | Enables test mode (uses mock APIs) |
| `MGREP_TEST_STORE_PATH` | Path to test store file |
| `BATS_TMPDIR` | Temporary directory for test files |

### Mock Mode

When `MGREP_IS_TEST=1`:
- API calls return mock responses
- No actual network requests
- Faster test execution

## Best Practices

### Do

- **Test one thing per test** — Each test should verify a single behavior
- **Use descriptive names** — Test names should describe expected behavior
- **Clean up after tests** — Use `teardown` to remove created files
- **Test edge cases** — Empty inputs, large files, special characters

### Don't

- **Don't test implementation details** — Focus on behavior, not internals
- **Don't make tests interdependent** — Each test should be runnable in isolation
- **Don't hardcode paths** — Use `$BATS_TMPDIR` for temporary files
- **Don't skip error handling** — Test both success and failure paths

## Adding Tests for New Features

When adding a new feature:

1. **Create a test file section** (if needed) with a comment header
2. **Write the failing test first** (TDD approach)
3. **Cover happy path** — Normal expected usage
4. **Cover error cases** — Invalid inputs, edge cases
5. **Cover options** — Test each relevant flag/option

Example for a new command:

```bash
# ============================================
# New Command: status
# ============================================

@test "status shows current state" {
    run mgrep status
    assert_success
    assert_output --partial "Store:"
}

@test "status with --json outputs JSON" {
    run mgrep status --json
    assert_success
    # Validate JSON structure
    echo "$output" | jq . > /dev/null
}

@test "status fails gracefully when not authenticated" {
    unset MXBAI_API_KEY
    run mgrep status
    assert_failure
    assert_output --partial "not authenticated"
}
```

## Debugging Tests

### Verbose Output

```bash
# Show command output even on success
bats test/test.bats --verbose-run

# Show test timing
bats test/test.bats --timing
```

### Print Debugging

```bash
@test "debug example" {
    run mgrep search "query"

    # Print to stderr (visible in test output)
    echo "Output was: $output" >&3
    echo "Status was: $status" >&3

    assert_success
}
```

### Running Single Test

```bash
# Run only tests matching pattern
bats test/test.bats --filter "exact test name"
```

## CI Integration

Tests run automatically on:
- Pull request creation
- Push to main branch

CI configuration ensures:
- All tests pass before merge
- Long-running tests run on schedule

## Resources

- [bats-core documentation](https://bats-core.readthedocs.io/)
- [bats-assert reference](https://github.com/bats-core/bats-assert)
- [bats-support reference](https://github.com/bats-core/bats-support)
