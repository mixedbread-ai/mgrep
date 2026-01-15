# Add Test

Add a new test case to the test suite.

## Arguments

- `$ARGUMENTS` - Description of what to test (e.g., "search with empty query returns error")

## Steps

1. Read the existing tests in `test/test.bats` to understand the current patterns.

2. Add a new test following this pattern:

   ```bash
   @test "$ARGUMENTS" {
     # Setup (if needed)

     # Execute
     run mgrep <command> <args>

     # Assert
     assert_success  # or assert_failure
     assert_output --partial "expected output"
   }
   ```

3. For long-running tests, add the tag:
   ```bash
   # bats test_tags=long-running
   @test "$ARGUMENTS" {
     ...
   }
   ```

4. Run the test to verify it works:
   ```bash
   bats test/test.bats --filter "$ARGUMENTS"
   ```

5. Ensure all tests still pass:
   ```bash
   pnpm test
   ```
