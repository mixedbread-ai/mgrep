# Contributing to mgrep

Thank you for your interest in contributing to mgrep! This guide covers contribution workflows for both human developers and AI coding agents.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- A Mixedbread account (for testing search functionality)

### Setup

```bash
# Clone the repository
git clone https://github.com/mixedbread-ai/mgrep.git
cd mgrep

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests to verify setup
pnpm test
```

## Development Workflow

### 1. Pick or Create an Issue

- Check existing issues before starting new work
- For new features, open an issue first to discuss the approach
- Reference issue numbers in commits and PRs

### 2. Create a Branch

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/issue-description
```

### 3. Make Changes

Follow the guidelines in [CLAUDE.md](./claude.md) for code style and [AGENTS.md](./AGENTS.md) for architectural patterns.

### 4. Verify Your Changes

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint

# Tests
pnpm test

# Format code
pnpm format
```

### 5. Commit Changes

Use conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

Examples:
```
feat(search): add support for PDF content search
fix(auth): handle token refresh on 401 response
docs: update installation instructions
test(search): add tests for empty query handling
```

### 6. Submit a Pull Request

- Fill out the PR template completely
- Link related issues
- Request review from maintainers

## For AI Agents

If you're an AI coding agent working on this codebase:

### Before Starting

1. Read `AGENTS.md` for project structure and conventions
2. Read `claude.md` for code style guidelines
3. Use `mgrep` to search for relevant code patterns

### During Development

1. **Read before modifying** — Always read files before making changes
2. **Check for existing utilities** — Look in `src/lib/` before creating new helpers
3. **Follow existing patterns** — Match the style of surrounding code
4. **Run verification** — Execute `pnpm typecheck && pnpm test` after changes

### Testing Requirements

- Bug fixes: Add a regression test
- New features: Add integration tests
- Refactors: Ensure existing tests pass

### Documentation Updates

When your changes affect:

- **User-facing behavior** — Update README.md
- **API or configuration** — Update relevant docs
- **Common patterns** — Update AGENTS.md

### Commit Message Format

```
type(scope): concise description

- Bullet points for additional context
- Reference issue numbers: Fixes #123
```

## Code Review Process

### What Reviewers Look For

- [ ] Code follows project style guidelines
- [ ] Tests are included and passing
- [ ] No security vulnerabilities introduced
- [ ] Documentation updated if needed
- [ ] Commits are well-organized and messaged

### Responding to Feedback

- Address all comments before requesting re-review
- Explain your reasoning if you disagree with feedback
- Don't force-push after review has started

## Release Process

Releases are managed by maintainers:

1. Version bump in `package.json`
2. Update CHANGELOG (if exists)
3. Tag release: `git tag v0.x.x`
4. Publish: `pnpm publish`

## Getting Help

- Open an issue for bugs or feature requests
- Join the [Mixedbread Slack](https://join.slack.com/t/mixedbreadcommunity/shared_invite/zt-3kagj5m36-wwM_hryIFby7B2wlcOaHaQ) for questions
- Check existing issues and discussions first

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
