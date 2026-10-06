import os
import sys
import json
import subprocess
from datetime import datetime
from pathlib import Path

from pid_utils import is_mgrep_watch_process, is_pid_alive, pid_file_path, read_pid

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


def session_start_response(cwd):
    base_context = 'mgrep semantic search is available: run `mgrep search "<natural-language question>"` from {cwd}. Use it for conceptual or cross-file questions where you don\'t know the exact identifier, such as \'where is authentication handled\'. Use Grep or rg for exact strings, symbol names and regexes. Both are fine; pick whichever fits the question. For a web lookup, `mgrep --web --answer "<question>"` is available.'.replace("{cwd}", os.path.abspath(cwd or os.getcwd()))
    return {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": base_context + read_update_notice(),
        }
    }


if __name__ == "__main__":
    payload = read_hook_input()
    if payload is None:
        sys.exit(0)
    cwd = payload.get("cwd")

    pid_file = pid_file_path(payload.get("session_id"))
    if os.path.exists(pid_file):
        existing_pid = read_pid(pid_file)
        if (
            existing_pid is not None
            and is_pid_alive(existing_pid)
            and is_mgrep_watch_process(existing_pid)
        ):
            debug_log(f"mgrep watch already running with pid {existing_pid}, skipping")
            print(json.dumps(session_start_response(cwd)))
            sys.exit(0)

        debug_log(f"Removing stale PID file: {pid_file}")
        try:
            os.remove(pid_file)
        except OSError:
            pass

    process = subprocess.Popen(
        ["mgrep", "watch"],
        preexec_fn=os.setsid,
        cwd=cwd or None,
        stdout=open(f"/tmp/mgrep-watch-command-{payload.get('session_id')}.log", "w"),
        stderr=open(f"/tmp/mgrep-watch-command-{payload.get('session_id')}.log", "w"),
    )
    debug_log(f"Started mgrep watch process: {process.pid}")
    debug_log(f"All environment variables: {os.environ}")
    with open(pid_file, "w") as handle:
        handle.write(str(process.pid))

    print(json.dumps(session_start_response(cwd)))
    sys.exit(0)
