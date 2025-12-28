import os
import signal
import sys
import json
import tempfile
from datetime import datetime
from pathlib import Path

TEMP_DIR = Path(tempfile.gettempdir())
DEBUG_LOG_FILE = Path(os.environ.get("MGREP_WATCH_KILL_LOG", str(TEMP_DIR / "mgrep-watch-kill.log")))


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


def kill_process(pid: int):
    """Kill a process in a cross-platform way."""
    try:
        if sys.platform == "win32":
            import subprocess
            subprocess.run(
                ["taskkill", "/F", "/PID", str(pid)],
                capture_output=True,
                check=False
            )
        else:
            os.kill(pid, signal.SIGKILL)
        return True
    except (OSError, ProcessLookupError) as e:
        debug_log(f"Failed to kill process {pid}: {e}")
        return False


if __name__ == "__main__":
    debug_log("Killing mgrep watch process")
    payload = read_hook_input()

    if not payload:
        debug_log("No payload received")
        sys.exit(1)

    session_id = payload.get("session_id", "unknown")
    pid_file = TEMP_DIR / f"mgrep-watch-pid-{session_id}.txt"

    if not pid_file.exists():
        debug_log(f"PID file not found: {pid_file}")
        sys.exit(0)

    try:
        pid = int(pid_file.read_text().strip())
        debug_log(f"Killing mgrep watch process: {pid}")

        if kill_process(pid):
            debug_log(f"Killed mgrep watch process: {pid}")
        else:
            debug_log(f"Process {pid} may already be dead")

    except (ValueError, OSError) as e:
        debug_log(f"Error reading or killing process: {e}")

    try:
        pid_file.unlink()
        debug_log(f"Removed PID file: {pid_file}")
    except OSError as e:
        debug_log(f"Failed to remove PID file: {e}")

    sys.exit(0)
