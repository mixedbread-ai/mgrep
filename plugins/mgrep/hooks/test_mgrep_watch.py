import importlib.util
import os
import tempfile
from pathlib import Path
from unittest import TestCase, mock


MODULE_PATH = Path(__file__).with_name("mgrep_watch.py")


def load_module():
    spec = importlib.util.spec_from_file_location("mgrep_watch", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LaunchWatchTests(TestCase):
    def test_windows_uses_creationflags(self):
        module = load_module()
        with mock.patch("builtins.open", mock.mock_open()), \
                mock.patch.object(module, "shutil") as mock_shutil, \
                mock.patch.object(module, "os") as mock_os, \
                mock.patch.object(module, "subprocess") as mock_subprocess:
            mock_os.name = "nt"
            mock_shutil.which.return_value = "/path/to/mgrep"
            mock_subprocess.CREATE_NEW_PROCESS_GROUP = 0x00000200

            module.launch_watch({"session_id": "abc"})

        called_args, called_kwargs = mock_subprocess.Popen.call_args
        self.assertEqual(called_args[0], ["/path/to/mgrep", "watch"])
        self.assertIn("creationflags", called_kwargs)
        self.assertNotIn("preexec_fn", called_kwargs)

    def test_posix_uses_setsid(self):
        module = load_module()
        with mock.patch("builtins.open", mock.mock_open()), \
                mock.patch.object(module, "shutil") as mock_shutil, \
                mock.patch.object(module, "os") as mock_os, \
                mock.patch.object(module, "subprocess") as mock_subprocess:
            mock_os.name = "posix"
            mock_os.setsid = object()
            mock_shutil.which.return_value = "/usr/bin/mgrep"

            module.launch_watch({"session_id": "abc"})

        called_args, called_kwargs = mock_subprocess.Popen.call_args
        self.assertEqual(called_args[0], ["/usr/bin/mgrep", "watch"])
        self.assertEqual(called_kwargs.get("preexec_fn"), mock_os.setsid)
        self.assertNotIn("creationflags", called_kwargs)

    def test_respects_custom_tmp_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch.dict("os.environ", {"MGREP_TMP": tmpdir}):
                module = load_module()

            m_open = mock.mock_open()
            with mock.patch("builtins.open", m_open), \
                    mock.patch.object(module, "shutil") as mock_shutil, \
                    mock.patch.object(module, "os") as mock_os, \
                    mock.patch.object(module, "subprocess") as mock_subprocess:
                mock_os.name = "nt"
                mock_shutil.which.return_value = "/path/to/mgrep"
                mock_subprocess.CREATE_NEW_PROCESS_GROUP = 0x0

                module.launch_watch({"session_id": "abc"})

            first_open_path = Path(m_open.call_args_list[0][0][0])
            self.assertTrue(str(first_open_path).startswith(str(Path(tmpdir))))
