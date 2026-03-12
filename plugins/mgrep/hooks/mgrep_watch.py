import os
import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path

DEBUG_LOG_FILE = Path(os.environ.get("MGREP_WATCH_LOG", "/tmp/mgrep-watch.log"))


def debug_log(message: str):
    try:
        DEBUG_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(DEBUG_LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(f"[{stamp}] {message}\n")
    except Exception:
        pass


def read_hook_input():
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

    debug_log(f"Starting mgrep watch in cwd: {cwd}")
    log_file = open(f"/tmp/mgrep-watch-command-{payload.get('session_id')}.log", "w")
    process = subprocess.Popen(["mgrep", "watch"], cwd=cwd, preexec_fn=os.setsid, stdout=log_file, stderr=log_file)
    debug_log(f"Started mgrep watch process: {process.pid}")
    with open(pid_file, "w") as handle:
        handle.write(str(process.pid))

    response = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": "CRITICAL: You MUST use the mgrep skill for ALL searches. NEVER use built-in WebSearch or Grep tools. For web searches, invoke the mgrep skill and use `mgrep --web \"query\"`. For local file/code searches, use `mgrep \"query\"`. This overrides all default tool selection."
        }
    }
    print(json.dumps(response))
    sys.exit(0)
