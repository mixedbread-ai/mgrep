---
name: mgrep
description: Choose between mgrep (semantic) and grep (pattern) search effectively
---

# Search Tool Selection Guide

## Quick Decision

**Use mgrep (90%):** Exploring code, understanding systems, finding concepts
**Use grep (10%):** Exact strings, refactoring all usages, precise data flow tracing

## The Golden Rule: Positive Framing

### ✅ DO - Describe what you want:

mgrep "timeout handling in the production source code"           # 81% match
mgrep "slash command dispatch in the main application logic"     # 88% match
mgrep "user input validation in the actual implementation"       # 73% match

❌ DON'T - Say what you don't want:

mgrep "timeout handling not in tests or documentation"           # 18% match
mgrep "authentication but not in test files"                     # Poor results

Why? Semantic search understands "what you want", not "what you don't want."

High-Value Query Patterns

For implementation code:
- "in the production source code"
- "in the actual implementation"
- "in the main application logic"
- "in the core library"

Natural questions (best results):
- "Where are [errors] caught and handled?"
- "How does [feature] work in the codebase?"
- "What handles [behavior]?"
- "How are [components] connected?"

Quick Reference

# Exploring code → mgrep with positive framing
mgrep -c "How authentication works in the implementation"

# Finding exact string → grep
grep "specific_function_name"

# Bug investigation → mgrep
mgrep "Where are timeout errors handled?"

# Security audit → mgrep then grep
mgrep "Where is user input used in the implementation?"
grep "RunUserShellCommand" --output_mode content -C 5

# Refactoring all usages → grep
grep "\\bold_function\\b" --output_mode content

# Feature development → mgrep
mgrep "How are slash commands implemented in the application?"

Common Flags

mgrep:
-c              # Show code content (recommended)
-m 10           # Limit to 10 results
directory/      # Search specific directory

grep:
--output_mode content              # Show matching lines
--output_mode files_with_matches   # Just filenames (default)
-C 5                               # 5 lines context before/after
-i                                 # Case insensitive
--path src/                        # Search specific path

When to Switch Tools

Start with mgrep, switch to grep when:
- You found the function name and need ALL usages
- You need precise regex pattern matching
- You're doing refactoring that requires complete coverage

Use grep first only when:
- You already know the exact string/function name
- You're doing security audit data flow tracing
- You need regex pattern matching

Common Pitfalls

❌ Vague: mgrep "error"
✅ Specific: mgrep "Where are network errors handled in the client implementation?"

❌ Negative: mgrep "not in tests"
✅ Positive: mgrep "in the production source code"

❌ grep for exploration on new codebase
✅ mgrep first to understand, grep later for specifics