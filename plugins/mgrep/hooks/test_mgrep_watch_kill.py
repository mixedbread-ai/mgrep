import importlib.util
import tempfile
from pathlib import Path
from unittest import TestCase, mock


MODULE_PATH = Path(__file__).with_name("mgrep_watch_kill.py")


def load_module():
    spec = importlib.util.spec_from_file_location("mgrep_watch_kill", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class KillWatchTests(TestCase):
    def test_windows_uses_sigterm_and_tmp_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch.dict("os.environ", {"MGREP_TMP": tmpdir}):
                module = load_module()

            pid_file = Path(tmpdir) / "mgrep-watch-pid-abc.txt"
            pid_file.write_text("123")

            with mock.patch.object(module, "os") as mock_os, \
                    mock.patch.object(module, "signal") as mock_signal:
                mock_os.name = "nt"
                mock_os.kill = mock.Mock()
                mock_signal.SIGTERM = "TERM"
                mock_signal.SIGKILL = "KILL"

                module.kill_watch({"session_id": "abc"})

            mock_os.kill.assert_called_once_with(123, "TERM")
            self.assertFalse(pid_file.exists())

    def test_posix_uses_sigkill(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch.dict("os.environ", {"MGREP_TMP": tmpdir}):
                module = load_module()

            pid_file = Path(tmpdir) / "mgrep-watch-pid-xyz.txt"
            pid_file.write_text("456")

            with mock.patch.object(module, "os") as mock_os, \
                    mock.patch.object(module, "signal") as mock_signal:
                mock_os.name = "posix"
                mock_os.kill = mock.Mock()
                mock_signal.SIGTERM = "TERM"
                mock_signal.SIGKILL = "KILL"

                module.kill_watch({"session_id": "xyz"})

            mock_os.kill.assert_called_once_with(456, "KILL")
            self.assertFalse(pid_file.exists())
