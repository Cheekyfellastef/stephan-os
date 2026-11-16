"""Exercise prelaunch runtime admission using the exact public PSF package.

Windows fixtures use the actual PowerShell functions. Substituted files are
never executed. The only launched runtime is the fully admitted official one.
"""

import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent
MODULE = ROOT / "pinned_python_runtime.ps1"
MANIFEST = ROOT / "python_runtime_v1.json"
POWERSHELL = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
ARCHIVE_SHA = "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159"


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def powershell(body, timeout=75):
    body = ("[Console]::InputEncoding=[Text.UTF8Encoding]::new($false,$true);"
            "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false,$true);" + body)
    environment = {key: value for key, value in os.environ.items() if key.upper() != "PSMODULEPATH"}
    environment["PSModulePath"] = r"C:\Windows\System32\WindowsPowerShell\v1.0\Modules"
    encoded = base64.b64encode(body.encode("utf-16le")).decode("ascii")
    return subprocess.run([POWERSHELL, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                          cwd=r"C:\Windows\System32", env=environment,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)


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
            self.assertNotIn("/", row["name"])
            self.assertNotIn("\\", row["name"])
            self.assertRegex(row["sha256"], r"^[a-f0-9]{64}$")


@unittest.skipUnless(os.name == "nt", "actual Windows PowerShell/runtime/file ACL semantics required")
class WindowsPinnedRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package_temp = tempfile.TemporaryDirectory(prefix="starfield-psf-package-")
        cls.archive = Path(cls.package_temp.name) / "official.zip"
        body = "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;. " + literal(MODULE) + ";"
        body += "$m=Get-Content -LiteralPath " + literal(MANIFEST) + " -Raw|ConvertFrom-Json;"
        body += "$raw=Get-RuntimeArchive $m {$true};[IO.File]::WriteAllBytes(" + literal(cls.archive) + ",$raw);"
        body += "'PSF_ARCHIVE_AUTHENTICATED'"
        result = powershell(body, timeout=90)
        if result.returncode != 0 or b"PSF_ARCHIVE_AUTHENTICATED" not in result.stdout:
            cls.package_temp.cleanup()
            raise AssertionError(result.stderr.decode(errors="replace"))
        if hashlib.sha256(cls.archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
            cls.package_temp.cleanup()
            raise AssertionError("Actual production download returned the wrong archive")

    @classmethod
    def tearDownClass(cls):
        cls.package_temp.cleanup()

    def run_case(self, action, before_expand=""):
        # A failed native ACL restoration can also make disposable test cleanup
        # fail. Keep the original PowerShell stage/error visible in that case.
        with tempfile.TemporaryDirectory(prefix="starfield-runtime-fixture-", ignore_cleanup_errors=True) as temporary:
            parent = Path(temporary) / "parent"
            parent.mkdir()
            runtime = parent / "runtime"
            body = "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;. " + literal(MODULE) + ";"
            body += "$m=Get-Content -LiteralPath " + literal(MANIFEST) + " -Raw|ConvertFrom-Json;"
            body += "$a=[IO.File]::ReadAllBytes(" + literal(self.archive) + ");$s=$null;$phase='create';$failure=$null;"
            body += "function Fixture-Report($e,$where){[Console]::Error.WriteLine(('RUNTIME_FIXTURE_FAILURE phase='+$where+' nativePhase='+$e.Exception.Data['RuntimePhase']+' nativeCode='+$e.Exception.Data['RuntimeNativeCode']+' message='+$e.Exception.Message+' stack='+$e.ScriptStackTrace))};"
            body += "try{$s=New-RuntimeCustody " + literal(runtime) + " $true;$phase='before-expand';"
            body += before_expand
            body += "$phase='expand';Expand-RuntimeArchive $a $m $s {$true};$phase='action';"
            body += action
            body += "}catch{$failure=$_;Fixture-Report $_ $phase}finally{try{Close-RuntimeCustody $s $true $true}catch{Fixture-Report $_ 'cleanup';if($null -eq $failure){$failure=$_}}};if($null -ne $failure){exit 1}"
            result = powershell(body)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
            return result.stdout

    def test_genuine_complete_runtime_executes_fixed_bootstrap(self):
        # Same isolated bootstrap imports used by the actual launcher/worker.
        program = "import base64,hashlib,json,struct,sys,types,ctypes,pathlib,subprocess;assert sys.version_info[:3]==(3,14,10);assert struct.calcsize('P')==8;assert sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode;print('PINNED_RUNTIME_EXECUTED')"
        encoded = base64.b64encode(program.encode()).decode("ascii")
        command = '-I -S -B -c "import base64;exec(base64.b64decode(\'' + encoded + '\'))"'
        action = "$s=Pin-VerifiedRuntime $s $m {$true};$p=[Diagnostics.Process]::new();"
        action += "$p.StartInfo=[Diagnostics.ProcessStartInfo]::new();$p.StartInfo.FileName=$s.Python;"
        action += "$p.StartInfo.Arguments=" + literal(command) + ";$p.StartInfo.UseShellExecute=$false;"
        action += r"$p.StartInfo.CreateNoWindow=$true;$p.StartInfo.WorkingDirectory='C:\Windows\System32';"
        action += "$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true;"
        action += r"$p.StartInfo.EnvironmentVariables.Clear();$p.StartInfo.EnvironmentVariables['SystemRoot']='C:\Windows';"
        action += r"$p.StartInfo.EnvironmentVariables['PATH']='C:\Windows\System32';"
        action += "try{if(-not $p.Start()){throw 'START_FAILED'};[void]$p.get_Handle();"
        action += "$text=$p.StandardOutput.ReadToEnd();$err=$p.StandardError.ReadToEnd();"
        action += "if(-not $p.WaitForExit(10000) -or $p.get_ExitCode() -ne 0 -or $err){throw 'RUNTIME_FAILED'};$text"
        action += "}finally{if(-not $p.get_HasExited()){$p.Kill();[void]$p.WaitForExit(5000)};$p.Dispose()}"
        self.assertIn(b"PINNED_RUNTIME_EXECUTED", self.run_case(action))

    def test_changed_runtime_members_are_refused_before_start(self):
        for name in ("python314.dll", "python314.zip", "_ctypes.pyd", "python314._pth"):
            with self.subTest(member=name):
                # The fixture uses its private creator handle to construct a
                # bad input. Ordinary later opens cannot modify these files.
                action = "$leaf=$s.Directories[$s.Directories.Count-1];Runtime-SetAcl $leaf.Handle (Runtime-Security 'cleanup');"
                action += "$path=[IO.Path]::Combine($s.Path," + literal(name) + ");"
                action += "$bytes=[IO.File]::ReadAllBytes($path);$bytes[0]=$bytes[0] -bxor 1;[IO.File]::Delete($path);[IO.File]::WriteAllBytes($path,$bytes);"
                action += "Runtime-SetAcl $leaf.Handle (Runtime-Security 'provision');"
                action += "$accepted=$false;try{$s=Pin-VerifiedRuntime $s $m {$true};$accepted=$true}catch{};"
                action += "if($accepted){throw 'TAMPERED_RUNTIME_ADMITTED'};'REFUSED_BEFORE_START'"
                self.assertIn(b"REFUSED_BEFORE_START", self.run_case(action))

    def test_additional_or_missing_member_is_refused_before_start(self):
        for mutation in ("[IO.File]::WriteAllText([IO.Path]::Combine($s.Path,'sitecustomize.py'),'raise Exception()');",
                         "[IO.File]::Delete([IO.Path]::Combine($s.Path,'_ctypes.pyd'));" ):
            with self.subTest(mutation=mutation):
                action = "$leaf=$s.Directories[$s.Directories.Count-1];Runtime-SetAcl $leaf.Handle (Runtime-Security 'cleanup');"
                action += mutation + "Runtime-SetAcl $leaf.Handle (Runtime-Security 'provision');"
                action += "$accepted=$false;try{$s=Pin-VerifiedRuntime $s $m {$true};$accepted=$true}catch{};"
                action += "if($accepted){throw 'WRONG_NAMESPACE_ADMITTED'};'REFUSED_BEFORE_START'"
                self.assertIn(b"REFUSED_BEFORE_START", self.run_case(action))

    def test_sealed_namespace_and_retained_ancestors_refuse_changes(self):
        program = "import sys;print('PINNED_RUNTIME_READY',flush=True);assert sys.stdin.readline().strip()=='finish'"
        encoded = base64.b64encode(program.encode()).decode("ascii")
        command = '-I -S -B -c "import base64;exec(base64.b64decode(\'' + encoded + '\'))"'
        action = "$s=Pin-VerifiedRuntime $s $m {$true};$p=[Diagnostics.Process]::new();"
        action += "$p.StartInfo=[Diagnostics.ProcessStartInfo]::new();$p.StartInfo.FileName=$s.Python;"
        action += "$p.StartInfo.Arguments=" + literal(command) + ";$p.StartInfo.UseShellExecute=$false;"
        action += r"$p.StartInfo.CreateNoWindow=$true;$p.StartInfo.WorkingDirectory='C:\Windows\System32';"
        action += "$p.StartInfo.RedirectStandardInput=$true;$p.StartInfo.RedirectStandardOutput=$true;"
        action += r"$p.StartInfo.EnvironmentVariables.Clear();$p.StartInfo.EnvironmentVariables['SystemRoot']='C:\Windows';"
        action += "try{if(-not $p.Start()){throw 'START_FAILED'};[void]$p.get_Handle();"
        action += "$ready=$p.StandardOutput.ReadLineAsync();if(-not $ready.Wait(10000) -or $ready.Result -cne 'PINNED_RUNTIME_READY'){throw 'RUNTIME_NOT_READY'};"
        actions = (
            "[IO.File]::WriteAllText([IO.Path]::Combine($s.Path,'injected.py'),'injected')",
            "$f=[IO.File]::Open([IO.Path]::Combine($s.Path,'python314.dll'),'Open','Write','ReadWrite');$f.Dispose()",
            "[IO.File]::Delete([IO.Path]::Combine($s.Path,'python314.zip'))",
            "$parent=[IO.Directory]::GetParent($s.Path).FullName;[IO.Directory]::Move($parent,$parent+'-replaced')",
            "$acl=[IO.Directory]::GetAccessControl($s.Path);$acl.SetAccessRuleProtection($false,$true);[IO.Directory]::SetAccessControl($s.Path,$acl)",
        )
        for index, attempt in enumerate(actions):
            action += "$refused=$false;try{" + attempt + "}catch{$refused=$true};"
            action += "if(-not $refused){throw 'NAMESPACE_CHANGE_" + str(index) + "_ALLOWED'};"
        action += "if($p.get_HasExited()){throw 'RUNTIME_ENDED_DURING_DENIAL_CHECKS'};$p.StandardInput.WriteLine('finish');$p.StandardInput.Close();"
        action += "if(-not $p.WaitForExit(10000) -or $p.get_ExitCode() -ne 0){throw 'RUNTIME_EXIT_UNPROVEN'};'RUNTIME_NAMESPACE_RETAINED'"
        action += "}finally{if(-not $p.get_HasExited()){$p.Kill();[void]$p.WaitForExit(5000)};$p.Dispose()}"
        self.assertIn(b"RUNTIME_NAMESPACE_RETAINED", self.run_case(action))

    def test_cancellation_never_admits_or_launches_runtime(self):
        action = "$accepted=$false;try{$s=Pin-VerifiedRuntime $s $m {$false};$accepted=$true}catch{};"
        action += "if($accepted){throw 'CANCELLED_RUNTIME_ADMITTED'};'CANCELLED_BEFORE_START'"
        self.assertIn(b"CANCELLED_BEFORE_START", self.run_case(action))

    def test_permission_handles_are_refused_from_creation(self):
        before = "$leaf=$s.Directories[$s.Directories.Count-1];if(((Runtime-GrantedAccess $leaf.Handle) -band 0x1700ab) -ne 0x1700ab){throw 'CREATOR_ACCESS_UNPROVEN'};"
        before += "$n=Runtime-Native;foreach($access in @(0x40000,0x80000,2)){"
        before += "$h=$n::CreateFileW($s.Path,$access,7,[IntPtr]::Zero,3,0x02200000,[IntPtr]::Zero);"
        before += "if($h -ne [IntPtr](-1) -and $h -ne [IntPtr]::Zero){[void]$n::CloseHandle($h);throw 'PRESEAL_PERMISSION_HANDLE_ALLOWED'}};"
        action = "$n=Runtime-Native;foreach($row in $m.files){"
        action += "$h=$n::CreateFileW([IO.Path]::Combine($s.Path,$row.name),0x40000,7,[IntPtr]::Zero,3,0x00200000,[IntPtr]::Zero);"
        action += "if($h -ne [IntPtr](-1) -and $h -ne [IntPtr]::Zero){[void]$n::CloseHandle($h);throw 'MEMBER_PERMISSION_HANDLE_ALLOWED'}};"
        action += "$s=Pin-VerifiedRuntime $s $m {$true};"
        action += "$acl=[IO.Directory]::GetAccessControl($s.Path);if(-not $acl.AreAccessRulesProtected){throw 'DIRECTORY_DACL_NOT_PROTECTED'};"
        action += "foreach($row in $m.files){$acl=[IO.File]::GetAccessControl([IO.Path]::Combine($s.Path,$row.name));if(-not $acl.AreAccessRulesProtected){throw 'MEMBER_DACL_NOT_PROTECTED'}};"
        action += "'CREATION_PERMISSION_BOUNDARY_PASSED'"
        self.assertIn(b"CREATION_PERMISSION_BOUNDARY_PASSED", self.run_case(action, before))


if __name__ == "__main__":
    unittest.main()
