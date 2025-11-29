import os
import signal
import sys
import json
import tempfile
from datetime import datetime
from pathlib import Path

TMP_DIR = Path(os.environ.get("MGREP_TMP", tempfile.gettempdir()))
DEBUG_LOG_FILE = Path(os.environ.get("MGREP_WATCH_KILL_LOG", TMP_DIR / "mgrep-watch-kill.log"))


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


def kill_watch(payload: dict[str, object]) -> None:
    pid_file = TMP_DIR / f"mgrep-watch-pid-{payload.get('session_id')}.txt"
    if not pid_file.exists():
        debug_log(f"PID file not found: {pid_file}")
        sys.exit(1)

    pid = int(pid_file.read_text().strip())
    debug_log(f"Killing mgrep watch process: {pid}")

    if os.name == "nt":
        sig = signal.SIGTERM
    else:
        sig = signal.SIGKILL

    os.kill(pid, sig)
    debug_log(f"Killed mgrep watch process: {pid}")
    pid_file.unlink()
    debug_log(f"Removed PID file: {pid_file}")


if __name__ == "__main__":
    debug_log("Killing mgrep watch process")
    payload = read_hook_input()
    kill_watch(payload)
    sys.exit(0)
