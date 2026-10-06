import json
import os
import sys
from pathlib import Path


def read_update_notice():
    try:
        cache_path = Path.home() / ".mgrep" / "update-check.json"
        with open(cache_path, "r", encoding="utf-8") as handle:
            cache = json.load(handle)
        latest = cache.get("latestVersion")
        if not isinstance(latest, str):
            return ""
        return f" An mgrep update is available (latest: {latest}). Tell the user to run `mgrep update` to upgrade."
    except Exception:
        return ""


def main():
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        payload = {}
    cwd = payload.get("cwd") if isinstance(payload, dict) else None
    if not isinstance(cwd, str) or not cwd or "\0" in cwd:
        cwd = os.getcwd()
    cwd = os.path.abspath(cwd)
    context = (
        "mgrep semantic search is available through the `search` tool of the mgrep MCP server. "
        "Use it for conceptual or cross-file questions where you don't know the exact identifier, "
        "such as 'where is authentication handled'. "
        f"It searches {cwd} by default. "
        "Use rg or grep for exact strings, symbol names and regexes. "
        "Both are fine; pick whichever fits the question."
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context + read_update_notice(),
        }
    }))


if __name__ == "__main__":
    main()
