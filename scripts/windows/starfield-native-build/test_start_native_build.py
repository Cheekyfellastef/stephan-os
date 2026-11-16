"""Source-bound launcher checks and real Windows signature/file-pin fixtures."""

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("start_native_build.ps1")
RUNTIME = SCRIPT.with_name("pinned_python_runtime.ps1")
MANIFEST = SCRIPT.with_name("python_runtime_v1.json")
ENTRY = "scripts/windows/starfield-native-build/native_build.py"
POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"


def bootstrap():
    source = SCRIPT.read_text(encoding="utf-8")
    found = re.search(r"(?m)^\s*\$bootstrap = @'\n(.*?)\n'@", source, re.S)
    if not found:
        raise AssertionError("Actual fixed launcher bootstrap not found")
    return found.group(1)


class LauncherSourceTests(unittest.TestCase):
    def packet(self, raw, sha=None):
        return json.dumps({"files": {ENTRY: {"base64": base64.b64encode(raw).decode("ascii"),
                                            "sha256": sha or hashlib.sha256(raw).hexdigest()}}}).encode()

    def run_bootstrap(self, payload):
        return subprocess.run([sys.executable, "-I", "-S", "-B", "-c", bootstrap()],
                              input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)

    def test_real_encoded_command_fits_windows_and_node_bounds(self):
        raw = SCRIPT.read_bytes()
        self.assertTrue(raw.isascii())
        encoded = base64.b64encode(raw.decode("ascii").encode("utf-16le"))
        self.assertLessEqual(len(encoded), 32000)
        invocation = len(POWERSHELL) + len(" -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ") + len(encoded) + 3
        self.assertLess(invocation, 32767)

    def test_actual_bootstrap_executes_only_matching_source_bytes(self):
        source = b"def main_packet(packet):\n print('VERIFIED_FIXTURE_ONLY')\n return 17\n"
        accepted = self.run_bootstrap(self.packet(source))
        self.assertEqual(accepted.returncode, 17, accepted.stderr)
        self.assertEqual(accepted.stdout.strip(), b"VERIFIED_FIXTURE_ONLY")
        rejected = self.run_bootstrap(self.packet(source, "0" * 64))
        self.assertEqual(rejected.returncode, 2)
        self.assertEqual(rejected.stdout, b"")

    def test_actual_bootstrap_rejects_oversize_source_before_execution(self):
        source = b"#" + b"x" * 262144 + b"\nprint('MUST_NOT_EXECUTE')\n"
        result = self.run_bootstrap(self.packet(source))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")

    def test_actual_bootstrap_bounds_total_input_before_json(self):
        result = self.run_bootstrap(b"x" * 3145729)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")


@unittest.skipUnless(os.name == "nt", "actual Windows PowerShell 5.1 required")
class WindowsLauncherTests(unittest.TestCase):
    def powershell(self, body):
        encoded = base64.b64encode(body.encode("utf-16le")).decode("ascii")
        environment = {key: value for key, value in os.environ.items() if key.upper() != "PSMODULEPATH"}
        environment["PSModulePath"] = r"C:\Windows\System32\WindowsPowerShell\v1.0\Modules"
        return subprocess.run([POWERSHELL, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                              cwd=r"C:\Windows\System32", env=environment,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)

    @staticmethod
    def literal(value):
        return "'" + str(value).replace("'", "''") + "'"

    def test_actual_launcher_parses_under_windows_powershell51(self):
        body = "$ErrorActionPreference='Stop';$t=$null;$e=$null;"
        body += "foreach($file in @(" + self.literal(SCRIPT) + "," + self.literal(RUNTIME) + ")){"
        body += "[void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$t,[ref]$e);"
        body += "if($e.Count){throw 'LAUNCHER_PARSE_FAILED'}};"
        body += "if($e.Count){throw 'LAUNCHER_PARSE_FAILED'};'LAUNCHER_PARSE_PASSED'"
        result = self.powershell(body)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        self.assertIn(b"LAUNCHER_PARSE_PASSED", result.stdout)



if __name__ == "__main__":
    unittest.main()
