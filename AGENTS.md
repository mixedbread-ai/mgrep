# AGENTS.md

> This file provides context and guidelines for AI coding agents working on the mgrep codebase. It follows the [AGENT.md specification](https://github.com/agentmd/agent.md) and incorporates best practices from Anthropic, OpenAI, and Google.

## Project Overview

**mgrep** is a semantic search CLI tool that brings natural language understanding to code search. It's built with TypeScript and designed to work seamlessly with AI coding agents.

### Core Purpose

- Replace pattern-based grep with semantic, natural-language search
- Index and search code, PDFs, images, and text files
- Integrate with coding agents (Claude Code, Codex, OpenCode, Factory Droid)
- Provide web search capabilities alongside local file search

### Tech Stack

- **Runtime**: Node.js (ESM modules)
- **Language**: TypeScript 5.x with strict mode
- **Package Manager**: pnpm
- **Linting/Formatting**: Biome
- **Testing**: bats (Bash Automated Testing System)
- **API**: Mixedbread SDK for semantic search

## Project Structure

```
mgrep/
├── src/
│   ├── index.ts              # CLI entry point, command registration
│   ├── commands/             # CLI command implementations
│   │   ├── login.ts          # Authentication flow
│   │   ├── logout.ts         # Session cleanup
│   │   ├── search.ts         # Core search functionality
│   │   ├── switch-org.ts     # Organization switching
│   │   ├── watch.ts          # File watching and indexing
│   │   └── watch_mcp.ts      # MCP (Model Context Protocol) watch
│   ├── install/              # Agent integration installers
│   │   ├── claude-code.ts    # Claude Code integration
│   │   ├── codex.ts          # Codex integration
│   │   ├── droid.ts          # Factory Droid integration
│   │   └── opencode.ts       # OpenCode integration
│   └── lib/                  # Shared utilities and core logic
│       ├── auth.ts           # Authentication utilities
│       ├── config.ts         # Configuration management
│       ├── context.ts        # Execution context
│       ├── file.ts           # File operations
│       ├── git.ts            # Git integration
│       ├── logger.ts         # Logging utilities
│       ├── organizations.ts  # Organization management
│       ├── store.ts          # Mixedbread store operations
│       ├── sync-helpers.ts   # Synchronization utilities
│       ├── token.ts          # Token management
│       ├── utils.ts          # General utilities
│       └── warning.ts        # Warning display utilities
├── test/
│   ├── test.bats             # Integration tests
│   └── assets/               # Test fixtures
├── plugins/                  # Plugin definitions
├── guides/                   # Documentation guides
└── .claude-plugin/           # Claude Code plugin config
```

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Development build + run
pnpm dev

# Run tests
pnpm test

# Format and lint code
pnpm format          # Auto-fix issues
pnpm format:check    # Check only (CI)
pnpm lint            # Lint check

# Type checking
pnpm typecheck
```

## Code Style & Conventions

### TypeScript Standards

- **Strict mode enabled** - All code must pass `tsc --strict`
- **Explicit return types** - All exported functions must declare return types
- **Prefer interfaces** - Use interfaces over types for public APIs
- **No `any`** - Use `unknown` or generics instead

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `FileProcessor` |
| Functions/Variables | camelCase | `processFile` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| Files | kebab-case | `sync-helpers.ts` |

### Import Organization

```typescript
// 1. Node.js built-ins
import * as fs from "node:fs";
import * as path from "node:path";

// 2. Third-party packages
import { program } from "commander";
import chalk from "chalk";

// 3. Internal modules (absolute paths)
import { auth } from "./lib/auth.js";

// 4. Local files (relative paths)
import { search } from "./commands/search.js";
```

### Documentation

- **JSDoc for all exports** - Include parameter descriptions and return types
- **Minimal inline comments** - Code should be self-explanatory
- **Comment "why" not "what"** - Only explain non-obvious decisions

## Testing Guidelines

### Running Tests

```bash
# Run all tests (excludes long-running tests)
pnpm test

# Run specific test
bats test/test.bats --filter "test name pattern"

# Run including long-running tests
bats test/test.bats
```

### Writing Tests

- Tests use **bats** (Bash Automated Testing System)
- Test files go in `test/` directory
- Use descriptive test names: `@test "search returns results for valid query"`
- Tag long-running tests with `# bats test_tags=long-running`

### Test Requirements

When making changes:
1. **Bug fixes** - Add a regression test
2. **New features** - Add integration tests covering happy path and edge cases
3. **Refactors** - Ensure existing tests pass

## Git Workflow

### Commit Messages

Follow conventional commits: `type(scope): description`

| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behavior change) |
| `docs` | Documentation only |
| `test` | Adding/updating tests |
| `chore` | Maintenance tasks |

Examples:
```
feat(search): add web search support
fix(auth): handle expired token refresh
refactor(store): extract sync logic to helper
```

### Branch Strategy

- `main` - Production-ready code
- Feature branches: `feat/description` or `fix/description`
- PRs require passing CI checks

## Security Considerations

### Never Commit

- API keys or tokens
- `.env` files with secrets
- User credentials
- Private keys

### Safe Patterns

- Use environment variables for secrets: `MXBAI_API_KEY`
- Configuration files should have `.example` versions
- Validate all user input before processing

## Agent-Specific Guidelines

### Before Making Changes

1. **Read relevant files first** - Understand existing patterns before modifying
2. **Check for existing utilities** - Look in `src/lib/` before creating new helpers
3. **Run typecheck** - `pnpm typecheck` before committing

### When Adding Features

1. Follow the command pattern in `src/commands/`
2. Register new commands in `src/index.ts`
3. Add corresponding tests in `test/test.bats`
4. Update documentation if user-facing

### When Fixing Bugs

1. Write a failing test first (when practical)
2. Make the minimal change to fix the issue
3. Verify the test passes
4. Check for similar issues elsewhere

### When Refactoring

1. Ensure comprehensive test coverage exists
2. Make small, incremental changes
3. Run `pnpm typecheck` and `pnpm test` after each change
4. Don't mix refactoring with feature changes

## Common Pitfalls

- **ESM imports** - Always use `.js` extension in imports (even for `.ts` files)
- **Async/await** - Handle promise rejections properly
- **File paths** - Use `node:path` for cross-platform compatibility
- **Git operations** - Use utilities in `src/lib/git.ts`

## Environment Setup

### Required

- Node.js 18+
- pnpm 8+

### Optional

- `MXBAI_API_KEY` - For headless/CI authentication
- `NODE_ENV=development` - Connect to local Mixedbread API

## Verification Checklist

Before submitting changes, verify:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] New code follows existing patterns
- [ ] No secrets or credentials in code
- [ ] Documentation updated if needed

## Reference Files

For deeper context on specific areas:

- @claude.md - Clean code guidelines and TypeScript best practices
- @README.md - User-facing documentation and usage examples
- @src/lib/store.ts - Core search and sync logic
- @src/commands/search.ts - Search command implementation
