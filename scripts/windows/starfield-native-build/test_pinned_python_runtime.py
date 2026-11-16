"""Qualify the fixed trusted installation and ordinary read-only admission.

The Windows CI administrator provisions only the fixed public PSF package in
its disposable VM. A genuinely filtered token performs the user-side attacks.
This fixture is not evidence that UAC ran on the operator's machine.
"""

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
MODULE = ROOT / "pinned_python_runtime.ps1"
MANIFEST = ROOT / "python_runtime_v1.json"
INSTALLER = ROOT / "install_pinned_python_runtime.ps1"
FILTERED = ROOT / "runtime_restricted_token_fixture.ps1"
POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
FIXED_ROOT = r"C:\Program Files\Stephanos\BuildRuntimes\Python-3.14.10-amd64-v1"
ARCHIVE_SHA = "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159"


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def powershell(body, timeout=90):
    body = ("[Console]::InputEncoding=[Text.UTF8Encoding]::new($false,$true);"
            "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false,$true);"
            "$ProgressPreference='SilentlyContinue';" + body)
    environment = {key: value for key, value in os.environ.items() if key.upper() != "PSMODULEPATH"}
    environment["PSModulePath"] = r"C:\Windows\System32\WindowsPowerShell\v1.0\Modules"
    encoded = base64.b64encode(body.encode("utf-16le")).decode("ascii")
    return subprocess.run([POWERSHELL, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                          cwd=r"C:\Windows\System32", env=environment,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)


def prelude():
    return ("$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;. " + literal(MODULE) + ";"
            "$m=Get-Content -LiteralPath " + literal(MANIFEST) + " -Raw|ConvertFrom-Json;")


class RuntimeManifestTests(unittest.TestCase):
    def test_complete_official_runtime_identity_is_committed(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "3.14.10")
        self.assertEqual(manifest["archiveSha256"], ARCHIVE_SHA)
        self.assertEqual(manifest["archiveUrl"], "https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip")
        self.assertEqual(manifest["archiveBytes"], 12619664)
        files = manifest["files"]
        self.assertEqual(len(files), 37)
        self.assertEqual(len({row["name"].casefold() for row in files}), 37)
        self.assertEqual(sum(row["bytes"] for row in files), 24450611)
        required = {"python.exe", "python314.dll", "python3.dll", "python314.zip", "python314._pth",
                    "_ctypes.pyd", "vcruntime140.dll", "vcruntime140_1.dll", "libffi-8.dll"}
        self.assertLessEqual(required, {row["name"] for row in files})
        for row in files:
            self.assertRegex(row["name"], r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$")
            self.assertRegex(row["sha256"], r"^[a-f0-9]{64}$")

    def test_fixed_installer_encoded_delivery_fits_windows(self):
        body = INSTALLER.read_text(encoding="ascii")
        encoded = base64.b64encode(body.encode("utf-16le")).decode("ascii")
        self.assertLess(len(encoded) + len(POWERSHELL) + 80, 32000)
        self.assertNotIn("Start-Process", body)
        self.assertNotIn("-Verb", body)
        self.assertNotIn("$PSScriptRoot", body)
        self.assertIn("$args.Count -ne 0", body)
        self.assertIn("$actual -cne $expected", body)
        self.assertIn("raw.githubusercontent.com/Cheekyfellastef/stephan-os/", body)
        # Dependency commit and module hash are filled after their immutable
        # candidate publication. A placeholder refuses before network access.
        source = re.search(r"\$sourceCommit='([^']+)'", body).group(1)
        module = re.search(r"\$moduleSha256='([^']+)'", body).group(1)
        self.assertTrue(source == "PLACEHOLDER_COMMIT" or re.fullmatch(r"[a-f0-9]{40}", source))
        if module != "PLACEHOLDER_MODULE_SHA256":
            self.assertEqual(module, hashlib.sha256(MODULE.read_bytes()).hexdigest())
        self.assertIn(hashlib.sha256(MANIFEST.read_bytes()).hexdigest(), body)


@unittest.skipUnless(os.name == "nt", "actual Windows installer, token and ACL semantics required")
class WindowsPinnedRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package_temp = tempfile.TemporaryDirectory(prefix="starfield-psf-package-")
        cls.archive = Path(cls.package_temp.name) / "official.zip"
        # CI must really have the administrator boundary. This is not skipped
        # or replaced by a mock if the runner cannot supply it.
        body = prelude()
        body += "$receipt=Install-FixedPythonRuntime $m;"
        body += "if($receipt.status -cnotin @('INSTALLED','ALREADY_VERIFIED') -or $receipt.verifiedFiles -ne 37){throw 'INSTALLATION_NOT_PROVEN'};"
        body += "$raw=Get-RuntimeArchive $m {$true};[IO.File]::WriteAllBytes(" + literal(cls.archive) + ",$raw);"
        body += "'TRUSTED_RUNTIME_INSTALLED'"
        body = "try{" + body + "}catch{[Console]::Error.WriteLine(('RUNTIME_SETUP_FAILURE message='+$_.Exception.Message+' stack='+$_.ScriptStackTrace));exit 1}"
        result = powershell(body, timeout=170)
        if result.returncode != 0 or b"TRUSTED_RUNTIME_INSTALLED" not in result.stdout:
            cls.package_temp.cleanup()
            raise AssertionError(result.stderr.decode(errors="replace"))
        if hashlib.sha256(cls.archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
            cls.package_temp.cleanup()
            raise AssertionError("Actual production download returned the wrong archive")

    @classmethod
    def tearDownClass(cls):
        cls.package_temp.cleanup()

    def checked(self, body, timeout=90):
        body = ("try{" + body + "}catch{[Console]::Error.WriteLine(('RUNTIME_FIXTURE_FAILURE message='+$_.Exception.Message+' stack='+$_.ScriptStackTrace));exit 1}")
        result = powershell(body, timeout=timeout)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        return result.stdout

    def run_case(self, action):
        # Only fixtures create siblings under the protected VM installation.
        # The production installer and reader both use their fixed root only.
        body = prelude()
        body += "$path=" + literal(r"C:\Program Files\Stephanos\BuildRuntimes\fixture-") + "+[Guid]::NewGuid().ToString('N');$s=$null;"
        body += "try{New-ProtectedRuntimeDirectory $path;$s=New-RuntimeCustody $path;"
        body += "$raw=[IO.File]::ReadAllBytes(" + literal(self.archive) + ");Expand-RuntimeArchive $raw $m $s {$true};"
        body += action
        body += "}finally{Close-RuntimeCustody $s;if([IO.Directory]::Exists($path)){[IO.Directory]::Delete($path,$true)}}"
        return self.checked(body)

    def test_genuine_complete_runtime_executes_fixed_bootstrap(self):
        program = "import base64,hashlib,json,struct,sys,types,ctypes,pathlib,subprocess;assert sys.version_info[:3]==(3,14,10);assert struct.calcsize('P')==8;assert sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode;print('PINNED_RUNTIME_EXECUTED')"
        encoded = base64.b64encode(program.encode()).decode("ascii")
        command = '-I -S -B -c "import base64;exec(base64.b64decode(\'' + encoded + '\'))"'
        body = prelude() + "$s=$null;$p=$null;try{$s=New-FixedPythonRuntime 'fixture-real-runtime-v1' $m {$true};"
        body += "$p=[Diagnostics.Process]::new();$p.StartInfo=[Diagnostics.ProcessStartInfo]::new();$p.StartInfo.FileName=$s.Python;"
        body += "$p.StartInfo.Arguments=" + literal(command) + ";$p.StartInfo.UseShellExecute=$false;"
        body += r"$p.StartInfo.CreateNoWindow=$true;$p.StartInfo.WorkingDirectory='C:\Windows\System32';"
        body += "$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true;"
        body += r"$p.StartInfo.EnvironmentVariables.Clear();$p.StartInfo.EnvironmentVariables['SystemRoot']='C:\Windows';"
        body += r"$p.StartInfo.EnvironmentVariables['PATH']='C:\Windows\System32';"
        body += "if(-not $p.Start()){throw 'START_FAILED'};[void]$p.get_Handle();"
        body += "$text=$p.StandardOutput.ReadToEnd();$err=$p.StandardError.ReadToEnd();"
        body += "if(-not $p.WaitForExit(10000) -or $p.get_ExitCode() -ne 0 -or $err){throw 'RUNTIME_FAILED'};$text"
        body += "}finally{if($null -ne $p){if(-not $p.get_HasExited()){$p.Kill();[void]$p.WaitForExit(5000)};$p.Dispose()};Close-RuntimeCustody $s}"
        self.assertIn(b"PINNED_RUNTIME_EXECUTED", self.checked(body))

    def test_changed_runtime_members_are_refused_without_repair(self):
        for name in ("python314.dll", "python314.zip", "_ctypes.pyd", "python314._pth"):
            with self.subTest(member=name):
                action = "$target=[IO.Path]::Combine($s.Path," + literal(name) + ");"
                action += "$bytes=[IO.File]::ReadAllBytes($target);$bytes[0]=$bytes[0] -bxor 1;[IO.File]::WriteAllBytes($target,$bytes);"
                action += "$accepted=$false;try{$s=Pin-VerifiedRuntime $s $m {$true};$accepted=$true}catch{};"
                action += "if($accepted -or [IO.File]::ReadAllBytes($target)[0] -ne $bytes[0]){throw 'TAMPERED_RUNTIME_ADMITTED_OR_REPAIRED'};'REFUSED_WITHOUT_REPAIR'"
                self.assertIn(b"REFUSED_WITHOUT_REPAIR", self.run_case(action))

    def test_extra_missing_untrusted_owner_and_writer_are_refused(self):
        mutations = (
            "[IO.File]::WriteAllText([IO.Path]::Combine($s.Path,'sitecustomize.py'),'raise Exception()');",
            "[IO.File]::Delete([IO.Path]::Combine($s.Path,'_ctypes.pyd'));",
            "$p=[IO.Path]::Combine($s.Path,'python314.dll');$acl=[IO.File]::GetAccessControl($p);$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User);[IO.File]::SetAccessControl($p,$acl);",
            "$acl=[IO.Directory]::GetAccessControl($s.Path);$rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-11'),'Write','Allow');$acl.AddAccessRule($rule);[IO.Directory]::SetAccessControl($s.Path,$acl);",
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                action = mutation + "$accepted=$false;try{Close-RuntimeCustody $s;$s=New-RuntimeCustody $path;$s=Pin-VerifiedRuntime $s $m {$true};$accepted=$true}catch{};"
                action += "if($accepted){throw 'UNTRUSTED_INSTALLATION_ADMITTED'};'UNTRUSTED_INSTALLATION_REFUSED'"
                self.assertIn(b"UNTRUSTED_INSTALLATION_REFUSED", self.run_case(action))

    def test_filtered_user_admits_but_cannot_mutate_or_install(self):
        body = prelude() + ". " + literal(FILTERED) + ";"
        body += "Invoke-FilteredRuntimeFixture {"
        body += "$s=$null;try{$s=New-FixedPythonRuntime 'fixture-filtered-reader-v1' $m {$true};if(-not $s.Sealed -or $s.Files.Count -ne 37){throw 'FILTERED_ADMISSION_FAILED'}}finally{Close-RuntimeCustody $s};"
        # All ordinary reader pins are closed here: ACLs, rather than those
        # pins, must enforce the permission boundary for the filtered token.
        actions = (
            "[IO.File]::WriteAllText(" + literal(FIXED_ROOT + r"\injected.py") + ",'injected')",
            "$f=[IO.File]::Open(" + literal(FIXED_ROOT + r"\python314.dll") + ",'Open','Write','ReadWrite');$f.Dispose()",
            "[IO.File]::Delete(" + literal(FIXED_ROOT + r"\python314.zip") + ")",
            "$acl=[IO.Directory]::GetAccessControl(" + literal(FIXED_ROOT) + ");$acl.SetAccessRuleProtection($false,$true);[IO.Directory]::SetAccessControl(" + literal(FIXED_ROOT) + ",$acl)",
            "[IO.Directory]::Move(" + literal(FIXED_ROOT) + "," + literal(FIXED_ROOT + "-moved") + ")",
            "Install-FixedPythonRuntime $m",
        )
        for index, attempt in enumerate(actions):
            body += "$refused=$false;try{" + attempt + "}catch{$refused=$true};"
            body += "if(-not $refused){throw 'FILTERED_MUTATION_" + str(index) + "_ALLOWED'};"
        body += "'FILTERED_TRUST_BOUNDARY_PASSED'}"
        self.assertIn(b"FILTERED_TRUST_BOUNDARY_PASSED", self.checked(body))

    def test_retained_files_and_directory_refuse_admin_replacement(self):
        body = prelude() + "$s=$null;try{$s=New-FixedPythonRuntime 'fixture-retained-runtime-v1' $m {$true};"
        actions = (
            "$f=[IO.File]::Open(" + literal(FIXED_ROOT + r"\python314.dll") + ",'Open','Write','ReadWrite');$f.Dispose()",
            "[IO.File]::Delete(" + literal(FIXED_ROOT + r"\python314.zip") + ")",
            "[IO.Directory]::Move(" + literal(r"C:\Program Files\Stephanos\BuildRuntimes") + "," + literal(r"C:\Program Files\Stephanos\BuildRuntimes-moved") + ")",
        )
        for index, attempt in enumerate(actions):
            body += "$refused=$false;try{" + attempt + "}catch{$refused=$true};if(-not $refused){throw 'PIN_REPLACEMENT_" + str(index) + "_ALLOWED'};"
        body += "'RETAINED_INSTALLATION_PASSED'}finally{Close-RuntimeCustody $s}"
        self.assertIn(b"RETAINED_INSTALLATION_PASSED", self.checked(body))

    def test_cancellation_never_admits_or_launches_runtime(self):
        body = prelude() + "$accepted=$false;try{$s=New-FixedPythonRuntime 'fixture-cancelled-runtime-v1' $m {$false};$accepted=$true;Close-RuntimeCustody $s}catch{};"
        body += "if($accepted){throw 'CANCELLED_RUNTIME_ADMITTED'};'CANCELLED_BEFORE_START'"
        self.assertIn(b"CANCELLED_BEFORE_START", self.checked(body))

    def test_existing_corrupt_install_is_never_overwritten(self):
        body = prelude() + "$path=" + literal(FIXED_ROOT + r"\python314._pth") + ";$before=[IO.File]::ReadAllBytes($path);"
        body += "try{$bad=[byte[]]$before.Clone();$bad[0]=$bad[0] -bxor 1;[IO.File]::WriteAllBytes($path,$bad);"
        body += "$accepted=$false;try{Install-FixedPythonRuntime $m;$accepted=$true}catch{};"
        body += "if($accepted -or [IO.File]::ReadAllBytes($path)[0] -ne $bad[0]){throw 'CORRUPT_INSTALL_OVERWRITTEN'};'CORRUPT_INSTALL_REFUSED'"
        body += "}finally{[IO.File]::WriteAllBytes($path,$before)}"
        self.assertIn(b"CORRUPT_INSTALL_REFUSED", self.checked(body))


if __name__ == "__main__":
    unittest.main()
