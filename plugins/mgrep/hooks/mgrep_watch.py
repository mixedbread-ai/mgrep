import os
import sys
import json
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

TMP_DIR = Path(os.environ.get("MGREP_TMP", tempfile.gettempdir()))
DEBUG_LOG_FILE = Path(os.environ.get("MGREP_WATCH_LOG", TMP_DIR / "mgrep-watch.log"))


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


def launch_watch(payload: dict[str, object]) -> subprocess.Popen:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    log_path = TMP_DIR / f"mgrep-watch-command-{payload.get('session_id')}.log"
    stdout_handle = open(log_path, "w")
    stderr_handle = open(log_path, "w")

    # Find mgrep executable (handles .cmd on Windows)
    mgrep_path = shutil.which("mgrep")
    if not mgrep_path:
        raise FileNotFoundError("mgrep command not found in PATH")

    if os.name == "nt":
        return subprocess.Popen(
            [mgrep_path, "watch"],
            stdout=stdout_handle,
            stderr=stderr_handle,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )

    return subprocess.Popen(
        [mgrep_path, "watch"],
        preexec_fn=os.setsid,
        stdout=stdout_handle,
        stderr=stderr_handle,
    )



if __name__ == "__main__":
    payload = read_hook_input()
    cwd = payload.get("cwd")

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    pid_file = TMP_DIR / f"mgrep-watch-pid-{payload.get('session_id')}.txt"
    if os.path.exists(pid_file):
        debug_log(f"PID file already exists: {pid_file}")
        sys.exit(1)

    process = launch_watch(payload)
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
