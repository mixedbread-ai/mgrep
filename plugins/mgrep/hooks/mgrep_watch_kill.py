import os
import signal
import sys
import json
from datetime import datetime
from pathlib import Path

DEBUG_LOG_FILE = Path(os.environ.get("MGREP_WATCH_KILL_LOG", "/tmp/mgrep-watch-kill.log"))


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
    debug_log("Killing mgrep watch process")
    payload = read_hook_input()

    pid_file = f"/tmp/mgrep-watch-pid-{payload.get('session_id')}.txt"
    if not os.path.exists(pid_file):
        debug_log(f"PID file not found: {pid_file}")
        sys.exit(1)
    pid = int(open(pid_file).read().strip())
    debug_log(f"Killing mgrep watch process: {pid}")
    os.kill(pid, signal.SIGKILL)
    debug_log(f"Killed mgrep watch process: {pid}")
    os.remove(pid_file)
    debug_log(f"Removed PID file: {pid_file}")
    sys.exit(0)
