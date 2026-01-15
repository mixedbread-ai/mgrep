# Add Command

Create a new CLI command for mgrep.

## Arguments

- `$ARGUMENTS` - The name of the new command (e.g., "status", "info")

## Steps

1. Create a new file at `src/commands/$ARGUMENTS.ts` following the pattern:

   ```typescript
   import { Command } from "commander";

   export const $ARGUMENTS = new Command("$ARGUMENTS")
     .description("Description of what this command does")
     .option("-x, --example <value>", "Example option description")
     .action(async (options) => {
       // Implementation here
     });
   ```

2. Register the command in `src/index.ts`:
   - Add import: `import { $ARGUMENTS } from "./commands/$ARGUMENTS.js";`
   - Add to program: `program.addCommand($ARGUMENTS);`

3. Add tests in `test/test.bats`:
   ```bash
   @test "$ARGUMENTS command runs successfully" {
     run mgrep $ARGUMENTS
     assert_success
   }
   ```

4. Run verification: `pnpm typecheck && pnpm test`
