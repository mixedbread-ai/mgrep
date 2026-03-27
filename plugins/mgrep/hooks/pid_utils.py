import os
import subprocess
from typing import Optional


def pid_file_path(session_id: Optional[str]) -> str:
    return f"/tmp/mgrep-watch-pid-{session_id}.txt"


def read_pid(pid_file: str) -> Optional[int]:
    try:
        with open(pid_file) as handle:
            return int(handle.read().strip())
    except (OSError, ValueError):
        return None


def is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def is_mgrep_watch_process(pid: int) -> bool:
    try:
        command = subprocess.check_output(
            ["ps", "-o", "command=", "-p", str(pid)],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return False

    return "mgrep watch" in command
