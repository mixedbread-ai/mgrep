# Refactor

Safely refactor code while maintaining functionality.

## Arguments

- `$ARGUMENTS` - Description of what to refactor and why

## Steps

1. **Ensure test coverage**
   - Run existing tests: `pnpm test`
   - If coverage is insufficient, add tests first before refactoring

2. **Plan the refactoring**
   - Identify all files that will be affected
   - List the changes needed in each file
   - Consider breaking large refactors into smaller commits

3. **Make incremental changes**
   - Change one thing at a time
   - After each change, run: `pnpm typecheck`
   - Commit working states frequently

4. **Maintain backward compatibility** (if public API)
   - Keep function signatures the same where possible
   - If signatures must change, update all call sites

5. **Verify after completion**
   - Run full test suite: `pnpm test`
   - Run type check: `pnpm typecheck`
   - Run lint: `pnpm lint`

6. **Clean up**
   - Remove any dead code
   - Update imports if file paths changed
   - Update documentation if needed

7. **Commit with proper message**
   - Use format: `refactor(scope): description`
   - Keep refactoring commits separate from feature/fix commits
