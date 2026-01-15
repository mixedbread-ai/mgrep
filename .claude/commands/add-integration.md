# Add Integration

Add support for a new coding agent integration.

## Arguments

- `$ARGUMENTS` - Name of the agent to integrate (e.g., "cursor", "windsurf")

## Steps

1. **Research the agent's configuration**
   - Find where the agent stores its configuration
   - Understand what format/files it expects
   - Look for existing plugin/extension patterns

2. **Create the installer** at `src/install/$ARGUMENTS.ts`:

   ```typescript
   import { Command } from "commander";

   export const install$ARGUMENTS = new Command("install-$ARGUMENTS")
     .description("Install mgrep integration for $ARGUMENTS")
     .action(async () => {
       // 1. Check if agent is installed
       // 2. Authenticate user if needed
       // 3. Write configuration files
       // 4. Display success message
     });

   export const uninstall$ARGUMENTS = new Command("uninstall-$ARGUMENTS")
     .description("Remove mgrep integration from $ARGUMENTS")
     .action(async () => {
       // 1. Find configuration files
       // 2. Remove mgrep-specific config
       // 3. Display success message
     });
   ```

3. **Register commands** in `src/index.ts`:
   - Add imports for both install and uninstall
   - Add `program.addCommand()` for both

4. **Add plugin configuration** if needed:
   - Create `plugins/$ARGUMENTS/` directory
   - Add any required manifest or config files

5. **Add tests**:
   - Test installation creates correct files
   - Test uninstallation removes files cleanly

6. **Update documentation**:
   - Add to README.md under "Using it with Coding Agents"
   - Add to AGENTS.md if agent-specific guidelines needed

7. **Verify**:
   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   ```
