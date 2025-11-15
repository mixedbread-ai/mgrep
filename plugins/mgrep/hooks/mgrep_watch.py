import os
import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path

DEBUG_LOG_FILE = Path(os.environ.get("MGREP_WATCH_LOG", "/tmp/mgrep-watch.log"))


def debug_log(message: str) -> None:
    try:
        DEBUG_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(DEBUG_LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(f"[{stamp}] {message}\n")
    except Exception:
        pass


def read_hook_input() -> dict[str, object] | None:
    raw = sys.stdin.read()
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        debug_log(f"Failed to decode JSON: {exc}")
        return None



if __name__ == "__main__":
    payload = read_hook_input()
    cwd = payload.get("cwd")

    pid_file = f"/tmp/mgrep-watch-pid-{payload.get('session_id')}.txt"
    if os.path.exists(pid_file):
        debug_log(f"PID file already exists: {pid_file}")
        sys.exit(1)

    process = subprocess.Popen(["mgrep", "watch"], preexec_fn=os.setsid, stdout=open(f"/tmp/mgrep-watch-command-{payload.get('session_id')}.log", "w"), stderr=open(f"/tmp/mgrep-watch-command-{payload.get('session_id')}.log", "w"))
    debug_log(f"Started mgrep watch process: {process.pid}")
    debug_log(f"All environment variables: {os.environ}")
    with open(pid_file, "w") as handle:
        handle.write(str(process.pid))

    response = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": "You must load mgrep skill for searching and exploring rather than grep"
        }
    }
    print(json.dumps(response))
    sys.exit(0)
