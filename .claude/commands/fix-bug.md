# Fix Bug

Systematic approach to fixing a bug in the codebase.

## Arguments

- `$ARGUMENTS` - Description of the bug or issue reference

## Steps

1. **Understand the bug**
   - Search for related code using mgrep: `mgrep "$ARGUMENTS"`
   - Read the relevant files to understand the current behavior

2. **Write a failing test first** (when practical)
   - Add a test in `test/test.bats` that reproduces the bug
   - Verify the test fails: `bats test/test.bats --filter "test name"`

3. **Identify the root cause**
   - Trace the code flow from entry point to the buggy behavior
   - Check `src/lib/` for utility functions that might be involved

4. **Implement the fix**
   - Make the minimal change necessary to fix the issue
   - Follow existing code patterns and style

5. **Verify the fix**
   - Run the specific test: `bats test/test.bats --filter "test name"`
   - Run all tests: `pnpm test`
   - Run type check: `pnpm typecheck`

6. **Document if needed**
   - If the bug was caused by a non-obvious pattern, add a comment explaining why
   - Update AGENTS.md "Common Pitfalls" section if this could trip up others

7. **Commit with proper message**
   - Use format: `fix(scope): description of fix`
