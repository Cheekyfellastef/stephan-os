"""Offline workflows plus Windows-only harmless-process exit-receipt tests.

The Windows tests execute the production close command against a disposable
fixture window. They never execute Steam, Starfield or the reviewed DLL.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid


SPEC = importlib.util.spec_from_file_location(
    "monitor_starter", Path(__file__).with_name("start_native_eye_output_session.py"))
starter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(starter)


class FakeHost:
    def __init__(self, store):
        self.store = store
        self.current = []
        self.proxy_value = "restored"
        self.effects = []
        self.clock = 0
        self.mode = "success"
        self.close_exits = True
        self.receipt = None
        self.identity = {"pid": 61000, "path": str(starter.GAME),
                         "createdFileTime": "134384678410182997",
                         "createdUtc": "2026-11-06T19:44:01.0182997Z"}

    def preflight(self):
        if self.mode == "bad-assets":
            raise starter.Blocked("Artifact mismatch")
        return {"manifestFilesVerified": 262}

    def games(self):
        return [dict(item) for item in self.current]

    def previous_proxy_receipt(self):
        return {"sha256": "prior-receipt", "base64": "cmV0YWluZWQ="}

    def proxy_state(self):
        if self.proxy_value not in ("restored", "isolated"):
            raise starter.Blocked("Unknown occupied proxy path")
        return self.proxy_value

    def proxy(self, mode):
        state = starter.read_json(self.store.path)
        if mode == "Isolate":
            if state["stage"] != "PROXY_ISOLATION_INTENT":
                raise AssertionError("Isolation had no durable intent")
            self.effects.append("isolate")
            if self.mode == "isolate-before-move-error":
                raise OSError("Isolate failed before rename")
            self.proxy_value = "isolated"
            if self.mode == "isolate-after-move-error":
                raise OSError("Receipt failed after rename")
            self.receipt = {"sha256": "a" * 64, "record": {"stage": "isolated"}}
            if self.mode == "game-after-isolation":
                self.current = [dict(self.identity, pid=62000)]
        else:
            if state["stage"] not in ("PRELAUNCH_ROLLBACK_INTENT", "GAME_EXIT_OBSERVED_RESTORE_INTENT"):
                raise AssertionError("Restore had no durable intent")
            if self.current or self.proxy_value != "isolated":
                raise AssertionError("Unsafe restore attempted")
            self.effects.append("restore")
            self.proxy_value = "restored"
            self.receipt = {"sha256": "b" * 64, "record": {"stage": "restored"}}
        return dict(self.receipt) if self.receipt else None

    def owns_isolation_receipt(self, saved):
        return bool(saved and saved == self.receipt and saved["record"]["stage"] == "isolated")

    def launch(self):
        state = starter.read_json(self.store.path)
        if state["stage"] != "STEAM_LAUNCH_INTENT" or state["launchRequested"] is not True:
            raise AssertionError("Launch had no durable intent")
        self.effects.append("launch")
        if self.mode == "interrupt-after-dispatch":
            raise KeyboardInterrupt()
        if self.mode == "launch-error":
            raise OSError("Ambiguous dispatch error")
        if self.mode != "launch-timeout":
            self.current = [dict(self.identity)]
        if self.mode == "stale-process":
            self.current[0]["createdFileTime"] = "134384678410182900"
        if self.mode == "wrong-path":
            self.current[0]["path"] = r"C:\Other\Starfield.exe"

    def close(self, process):
        self.effects.append("close")
        if self.close_exits:
            self.current = []
        return {"requested": True, "exited": self.close_exits,
                "exitCode": 0 if self.close_exits else None}

    def now_filetime(self):
        return "134384678410182996"

    def monotonic(self):
        return self.clock

    def sleep(self, seconds):
        self.clock += seconds


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.store = starter.Store(self.directory)
        self.host = FakeHost(self.store)

    def begin(self):
        result = starter.start(self.store, self.host)
        self.assertEqual(result["stage"], "FRESH_MONITOR_GAME_WAITING_FOR_SAVE")
        return result

    def test_start_binds_exact_string_identity_and_never_confirms_or_loads(self):
        result = self.begin()
        self.assertEqual(self.host.effects, ["isolate", "launch"])
        self.assertEqual(result["process"]["createdFileTime"], "134384678410182997")
        self.assertIsInstance(result["process"]["createdFileTime"], str)
        self.assertFalse(result["captureAttempted"])
        self.assertFalse(result["injected"])
        self.assertFalse(result["saveLoadedConfirmed"])
        self.assertEqual(result["priorProxyReceipt"]["base64"], "cmV0YWluZWQ=")
        self.assertFalse(self.store.lock.exists())

    def test_bad_assets_do_not_reserve_or_touch_runtime(self):
        self.host.mode = "bad-assets"
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)
        self.assertFalse(self.store.exists())
        self.assertFalse(self.store.lock.exists())
        self.assertEqual(self.host.effects, [])

    def test_game_appearing_during_admission_leaves_no_orphan_lock(self):
        self.host.current = [self.host.identity]
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)
        self.assertFalse(self.store.exists())
        self.assertFalse(self.store.lock.exists())
        self.assertEqual(self.host.effects, [])

    def test_one_attempt_cannot_be_started_twice(self):
        self.begin()
        before = self.store.path.read_bytes()
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(self.host.effects.count("launch"), 1)

    def test_isolate_failure_after_move_recovers_before_any_launch(self):
        self.host.mode = "isolate-after-move-error"
        result = starter.start(self.store, self.host)
        self.assertEqual(result["stage"], "START_FAILED_BEFORE_LAUNCH_PROXY_RESTORED")
        self.assertEqual(self.host.effects, ["isolate", "restore"])
        self.assertFalse(result["launchRequested"])
        self.assertFalse(self.store.lock.exists())
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)

    def test_isolate_failure_before_move_does_not_restore_over_original(self):
        self.host.mode = "isolate-before-move-error"
        result = starter.start(self.store, self.host)
        self.assertEqual(result["stage"], "START_FAILED_BEFORE_LAUNCH_PROXY_RESTORED")
        self.assertEqual(self.host.effects, ["isolate"])

    def test_prelaunch_cleanup_recovers_owned_isolation_after_other_game_exits(self):
        self.host.mode = "game-after-isolation"
        result = starter.start(self.store, self.host)
        self.assertEqual(result["stage"], "START_FAILED_PROXY_PRESERVED")
        self.assertFalse(result["launchRequested"])
        self.assertIsNotNone(result["isolationReceipt"])
        with self.assertRaises(starter.Blocked):
            starter.finish(self.store, self.host)
        self.assertFalse(self.store.lock.exists())
        self.host.current = []
        result = starter.finish(self.store, self.host)
        self.assertEqual(result["stage"], "PRELAUNCH_ABORT_PROXY_RESTORED")
        self.assertEqual(self.host.effects, ["isolate", "restore"])
        self.assertNotIn("close", self.host.effects)
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)

    def test_prelaunch_cleanup_rejects_changed_isolation_receipt(self):
        self.host.mode = "game-after-isolation"
        starter.start(self.store, self.host)
        self.host.current = []
        self.host.receipt = {"sha256": "c" * 64, "record": {"stage": "isolated"}}
        with self.assertRaises(starter.Blocked):
            starter.finish(self.store, self.host)
        self.assertEqual(self.host.effects, ["isolate"])
        self.assertEqual(self.host.proxy_value, "isolated")

    def test_prelaunch_cleanup_requires_explicit_false_launch_flag(self):
        self.host.mode = "game-after-isolation"
        starter.start(self.store, self.host)
        self.host.current = []
        for value in (None, 0, "false"):
            with self.subTest(value=value):
                state = self.store.load()
                state["launchRequested"] = value
                self.store.save(state)
                with self.assertRaises(starter.Blocked):
                    starter.finish(self.store, self.host)
                self.assertFalse(self.store.lock.exists())
                self.assertNotIn("restore", self.host.effects)

    def test_prelaunch_cleanup_requires_known_stage(self):
        self.host.mode = "game-after-isolation"
        starter.start(self.store, self.host)
        self.host.current = []
        state = self.store.load()
        state["stage"] = "UNKNOWN_FUTURE_STAGE"
        self.store.save(state)
        with self.assertRaises(starter.Blocked):
            starter.finish(self.store, self.host)
        self.assertFalse(self.store.lock.exists())
        self.assertNotIn("restore", self.host.effects)

    def test_ambiguous_launch_error_preserves_proxy_and_requires_reconciliation(self):
        self.host.mode = "launch-error"
        result = starter.start(self.store, self.host)
        self.assertEqual(result["stage"], "LAUNCH_UNRESOLVED_PROXY_PRESERVED")
        self.assertEqual(self.host.proxy_value, "isolated")
        with self.assertRaises(starter.Blocked):
            starter.finish(self.store, self.host)
        self.assertFalse(self.store.lock.exists())
        self.assertNotIn("restore", self.host.effects)

    def test_timeout_never_restores_based_only_on_zero_processes(self):
        self.host.mode = "launch-timeout"
        result = starter.start(self.store, self.host)
        self.assertEqual(result["stage"], "LAUNCH_UNRESOLVED_PROXY_PRESERVED")
        self.assertEqual(self.host.clock, 90)
        self.assertEqual(self.host.proxy_value, "isolated")
        self.assertNotIn("restore", self.host.effects)

    def test_process_older_than_launch_is_not_adopted(self):
        self.host.mode = "stale-process"
        result = starter.start(self.store, self.host)
        self.assertIsNone(result["process"])
        self.assertEqual(result["stage"], "LAUNCH_UNRESOLVED_PROXY_PRESERVED")
        self.assertNotIn("restore", self.host.effects)

    def test_wrong_game_path_is_not_adopted(self):
        self.host.mode = "wrong-path"
        result = starter.start(self.store, self.host)
        self.assertIsNone(result["process"])

    def test_interrupt_retains_lock_and_durable_launch_intent(self):
        self.host.mode = "interrupt-after-dispatch"
        with self.assertRaises(KeyboardInterrupt):
            starter.start(self.store, self.host)
        self.assertTrue(self.store.lock.exists())
        self.assertEqual(self.store.load()["stage"], "STEAM_LAUNCH_INTENT")
        self.assertEqual(self.host.proxy_value, "isolated")
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)

    def test_uncertain_state_write_retains_lock_and_last_durable_intent(self):
        original_save = self.store.save

        def fail_late(state, new=False):
            if "launch" in self.host.effects:
                self.store.write_uncertain = True
                raise OSError("Disk write unavailable")
            original_save(state, new)

        with patch.object(self.store, "save", side_effect=fail_late):
            with self.assertRaises(OSError):
                starter.start(self.store, self.host)
        self.assertTrue(self.store.lock.exists())
        self.assertEqual(self.store.load()["stage"], "STEAM_LAUNCH_INTENT")
        self.assertEqual(self.host.effects.count("launch"), 1)

    def test_finish_normally_closes_exact_process_then_restores(self):
        self.begin()
        result = starter.finish(self.store, self.host)
        self.assertEqual(self.host.effects, ["isolate", "launch", "close", "restore"])
        self.assertEqual(result["stage"], "GAME_EXIT_OBSERVED_PROXY_RESTORED")
        self.assertTrue(result["normalExitProven"])
        self.assertFalse(result["injected"])

    def test_manual_exit_can_restore_without_inventing_normal_exit_proof(self):
        self.begin()
        self.host.current = []
        result = starter.finish(self.store, self.host)
        self.assertEqual(result["stage"], "GAME_EXIT_OBSERVED_PROXY_RESTORED")
        self.assertFalse(result["normalExitProven"])
        self.assertNotIn("close", self.host.effects)

    def test_null_exit_code_remains_incomplete_and_is_retained_in_summary(self):
        self.begin()
        close = self.host.close

        def missing_code(process):
            result = close(process)
            result.update(exitCode=None, exitCodeError="EXIT_CODE_READ_FAILED")
            return result

        with patch.object(self.host, "close", side_effect=missing_code):
            result = starter.finish(self.store, self.host)
        self.assertTrue(result["gameExitObserved"])
        self.assertTrue(result["proxyRestored"])
        self.assertFalse(result["normalExitProven"])
        summary = starter.summary(result, self.store)
        self.assertEqual(summary["closeResult"], {
            "requested": True, "exited": True, "exitCode": None,
            "exitCodeError": "EXIT_CODE_READ_FAILED"})
        self.assertNotIn("priorProxyReceipt", summary)

    def test_nonzero_exit_code_is_retained_without_normal_exit_proof(self):
        self.begin()
        close = self.host.close

        def nonzero_code(process):
            result = close(process)
            result["exitCode"] = 37
            return result

        with patch.object(self.host, "close", side_effect=nonzero_code):
            result = starter.finish(self.store, self.host)
        self.assertTrue(result["proxyRestored"])
        self.assertFalse(result["normalExitProven"])
        self.assertEqual(starter.summary(result, self.store)["closeResult"]["exitCode"], 37)

    def test_pid_reuse_never_closes_replacement_game(self):
        self.begin()
        self.host.current[0]["createdFileTime"] = "134384678510182997"
        with self.assertRaises(starter.Blocked):
            starter.finish(self.store, self.host)
        self.assertNotIn("close", self.host.effects)
        self.assertNotIn("restore", self.host.effects)
        self.assertFalse(self.store.lock.exists())

    def test_second_game_denial_releases_lock_then_finish_can_succeed(self):
        self.begin()
        second = dict(self.host.identity, pid=61001)
        self.host.current.append(second)
        with self.assertRaises(starter.Blocked):
            starter.finish(self.store, self.host)
        self.assertFalse(self.store.lock.exists())
        self.assertNotIn("close", self.host.effects)
        self.host.current.pop()
        result = starter.finish(self.store, self.host)
        self.assertEqual(result["stage"], "GAME_EXIT_OBSERVED_PROXY_RESTORED")

    def test_refused_normal_close_preserves_proxy_until_later_exit(self):
        self.begin()
        self.host.close_exits = False
        result = starter.finish(self.store, self.host)
        self.assertEqual(result["stage"], "NORMAL_EXIT_STILL_REQUIRED")
        self.assertEqual(self.host.proxy_value, "isolated")
        self.assertNotIn("restore", self.host.effects)
        self.host.current = []
        result = starter.finish(self.store, self.host)
        self.assertEqual(result["stage"], "GAME_EXIT_OBSERVED_PROXY_RESTORED")

    def test_unknown_occupied_proxy_is_never_overwritten(self):
        self.begin()
        self.host.current = []
        self.host.proxy_value = "foreign-source"
        with self.assertRaises(starter.Blocked):
            starter.finish(self.store, self.host)
        self.assertNotIn("restore", self.host.effects)
        self.assertFalse(self.store.lock.exists())

    def test_finish_is_idempotent_and_does_not_reenable_start(self):
        self.begin()
        first = starter.finish(self.store, self.host)
        effects = list(self.host.effects)
        self.host.current = [dict(self.host.identity, pid=62000)]
        second = starter.finish(self.store, self.host)
        self.assertEqual(first, second)
        self.assertEqual(self.host.effects, effects)
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)

    def test_foreign_state_change_is_not_overwritten(self):
        self.begin()
        state = self.store.load()
        altered = self.store.path.read_bytes() + b" "
        self.store.path.write_bytes(altered)
        with self.assertRaises(starter.Blocked):
            self.store.save(state)
        self.assertEqual(self.store.path.read_bytes(), altered)

    def test_foreign_lock_is_never_removed_or_stolen(self):
        self.store.lock.write_text("foreign-owner")
        with self.assertRaises(starter.Blocked):
            starter.start(self.store, self.host)
        self.assertEqual(self.store.lock.read_text(), "foreign-owner")
        self.assertEqual(self.host.effects, [])

    def test_stdout_summary_excludes_proxy_backup_but_retains_identity(self):
        result = self.begin()
        summary = starter.summary(result, self.store)
        self.assertNotIn("priorProxyReceipt", summary)
        self.assertNotIn("events", summary)
        self.assertEqual(summary["process"], self.host.identity)


@unittest.skipUnless(os.name == "nt", "Actual Windows PowerShell 5.1 process fixture")
class WindowsExitReceiptTests(unittest.TestCase):
    """Run WindowsHost.close's extracted command, not a second implementation."""

    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="starfield-exit-proof-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.executable = cls.root / "OwnedExitReceiptFixture.exe"
        cls.host = starter.WindowsHost()
        version = cls.host.ps(
            "[ordered]@{major=$PSVersionTable.PSVersion.Major;"
            "minor=$PSVersionTable.PSVersion.Minor;edition=$PSVersionTable.PSEdition}"
            " | ConvertTo-Json -Compress")
        if version != {"major": 5, "minor": 1, "edition": "Desktop"}:
            raise AssertionError("The exit regression must use Windows PowerShell 5.1: " + str(version))
        source = r"""
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

internal static class OwnedExitReceiptFixture {
    [STAThread]
    private static int Main(string[] args) {
        int exitCode = int.Parse(args[0]);
        bool refuseClose = args[1] == "refuse";
        Stopwatch lifetime = Stopwatch.StartNew();
        using (Form window = new Form())
        using (System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer()) {
            window.Text = "Owned exit receipt regression";
            window.StartPosition = FormStartPosition.Manual;
            window.Location = new Point(-2000, -2000);
            window.Size = new Size(160, 80);
            window.FormClosing += delegate(object sender, FormClosingEventArgs eventArgs) {
                File.WriteAllText(args[4], "close-request-observed");
                if (refuseClose) eventArgs.Cancel = true;
            };
            window.Shown += delegate {
                File.WriteAllText(args[2], Process.GetCurrentProcess().Id.ToString());
            };
            timer.Interval = 25;
            timer.Tick += delegate {
                if (File.Exists(args[3])) Environment.Exit(exitCode);
                if (lifetime.ElapsedMilliseconds > 20000) Environment.Exit(124);
            };
            timer.Start();
            Application.Run(window);
        }
        return exitCode;
    }
}
"""
        path_literal = "'" + str(cls.executable).replace("'", "''") + "'"
        cls.host.ps(
            "$fixtureSource=@'\n" + source + "\n'@;\n"
            "Add-Type -TypeDefinition $fixtureSource -ReferencedAssemblies "
            "'System.dll','System.Windows.Forms.dll','System.Drawing.dll' "
            "-OutputAssembly " + path_literal + " -OutputType WindowsApplication -ErrorAction Stop;"
            "'{\"compiled\":true}'", timeout=40)

    def fixture(self, exit_code, refuse_close=False):
        nonce = uuid.uuid4().hex
        ready = self.root / (nonce + ".ready")
        stop = self.root / (nonce + ".stop")
        close_marker = self.root / (nonce + ".close")
        child = subprocess.Popen(
            [str(self.executable), str(exit_code), "refuse" if refuse_close else "accept",
             str(ready), str(stop), str(close_marker)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        def settle_owned_fixture():
            # Only this fixture's private stop file is written. Its own bounded
            # timer exits; no process-name cleanup or game termination is used.
            stop.write_text("stop", encoding="ascii")
            child.wait(timeout=25)

        self.addCleanup(settle_owned_fixture)
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline:
            self.assertIsNone(child.poll(), "The disposable fixture exited before creating its window")
            time.sleep(0.025)
        self.assertTrue(ready.exists(), "The disposable fixture window did not become ready")
        self.assertEqual(int(ready.read_text()), child.pid)
        identity = self.host.ps(
            "$p=Get-Process -Id " + str(child.pid) + " -ErrorAction Stop;"
            "[ordered]@{pid=$p.Id;path=$p.Path;"
            "createdFileTime=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString("
            "[Globalization.CultureInfo]::InvariantCulture);window=$p.MainWindowHandle.ToInt64()}"
            " | ConvertTo-Json -Compress")
        self.assertEqual(identity["pid"], child.pid)
        self.assertEqual(identity["path"].casefold(), str(self.executable).casefold())
        self.assertNotEqual(identity["window"], 0, "The fixture must have a normal closeable window")
        return child, identity, close_marker

    def production_command(self, identity, *, wait_ms=2000, expected_path=None):
        captured = {}

        def capture(code=None, file_args=None, timeout=20):
            self.assertIsNone(file_args)
            captured.update(code=code, timeout=timeout)
            return {}

        # Capture the exact command generated by the production function. Only
        # its fixed game path and wait duration are replaced for the test fixture.
        target = dict(identity, path=str(starter.GAME))
        with patch.object(self.host, "ps", side_effect=capture):
            self.host.close(target)
        self.assertEqual(captured["timeout"], 70)
        code = captured["code"]
        game_literal = "'" + str(starter.GAME) + "'"
        self.assertEqual(code.count(game_literal), 1)
        self.assertEqual(code.count("WaitForExit(60000)"), 1)
        fixture_literal = "'" + str(expected_path or self.executable).replace("'", "''") + "'"
        return code.replace(game_literal, fixture_literal).replace(
            "WaitForExit(60000)", "WaitForExit(" + str(wait_ms) + ")")

    def test_owned_zero_exit_retains_the_real_exit_code(self):
        child, identity, _ = self.fixture(0)
        receipt = self.host.ps(self.production_command(identity), timeout=12)
        self.assertIs(receipt["requested"], True)
        self.assertIs(receipt["exited"], True)
        self.assertIs(type(receipt["exitCode"]), int)
        self.assertEqual(receipt["exitCode"], 0)
        self.assertIsNone(receipt["exitCodeError"])
        self.assertEqual(child.wait(timeout=5), 0)

    def test_owned_nonzero_exit_retains_the_real_exit_code(self):
        child, identity, _ = self.fixture(37)
        receipt = self.host.ps(self.production_command(identity), timeout=12)
        self.assertIs(receipt["requested"], True)
        self.assertIs(receipt["exited"], True)
        self.assertIs(type(receipt["exitCode"]), int)
        self.assertEqual(receipt["exitCode"], 37)
        self.assertIsNone(receipt["exitCodeError"])
        self.assertEqual(child.wait(timeout=5), 37)

    def test_timeout_keeps_unknown_code_and_leaves_the_owned_process_alive(self):
        child, identity, _ = self.fixture(0, refuse_close=True)
        receipt = self.host.ps(self.production_command(identity, wait_ms=100), timeout=12)
        self.assertIs(receipt["requested"], True)
        self.assertIs(receipt["exited"], False)
        self.assertIsNone(receipt["exitCode"])
        self.assertIsNone(receipt["exitCodeError"])
        self.assertIsNone(child.poll())

    def test_same_pid_with_wrong_creation_identity_is_not_closed(self):
        child, identity, marker = self.fixture(0)
        changed = dict(identity, createdFileTime=str(int(identity["createdFileTime"]) + 1))
        with self.assertRaisesRegex(starter.Blocked, "Close target identity changed"):
            self.host.ps(self.production_command(changed), timeout=12)
        self.assertIsNone(child.poll())
        self.assertFalse(marker.exists())

    def test_wrong_executable_identity_is_not_closed(self):
        child, identity, marker = self.fixture(0)
        with self.assertRaisesRegex(starter.Blocked, "Close target identity changed"):
            self.host.ps(self.production_command(
                identity, expected_path=self.root / "DifferentFixture.exe"), timeout=12)
        self.assertIsNone(child.poll())
        self.assertFalse(marker.exists())

    def test_failed_or_null_getter_remains_explicit_unknown_evidence(self):
        for replacement in ("$(throw 'Fixture exit-code read failed')", "$null"):
            with self.subTest(getter=replacement):
                child, identity, _ = self.fixture(0)
                code = self.production_command(identity)
                self.assertEqual(code.count("$p.get_ExitCode()"), 1)
                # Fault injection only at the native observation boundary.
                code = code.replace("$p.get_ExitCode()", replacement)
                receipt = self.host.ps(code, timeout=12)
                self.assertIs(receipt["requested"], True)
                self.assertIs(receipt["exited"], True)
                self.assertIsNone(receipt["exitCode"])
                self.assertEqual(receipt["exitCodeError"], "EXIT_CODE_READ_FAILED")
                self.assertEqual(child.wait(timeout=5), 0)


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / "reviewed.dll"
        self.path.write_bytes(b"reviewed bytes")
        self.records = {"reviewed.dll": {"sha256": starter.digest(self.path), "bytes": self.path.stat().st_size}}

    def test_file_hash_or_size_change_is_rejected(self):
        starter.verify_files(self.root, self.records, 1)
        self.path.write_bytes(b"different byte")
        with self.assertRaises(starter.Blocked):
            starter.verify_files(self.root, self.records, 1)

    def test_missing_file_is_rejected(self):
        self.path.unlink()
        with self.assertRaises(starter.Blocked):
            starter.verify_files(self.root, self.records, 1)

    def test_relative_escape_is_rejected(self):
        with self.assertRaises(starter.Blocked):
            starter.verify_files(self.root, {"../reviewed.dll": self.records["reviewed.dll"]}, 1)

    def test_symlink_ancestor_is_rejected_before_read(self):
        link = self.root / "link"
        try:
            link.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Symlink creation unavailable")
        with self.assertRaises(starter.Blocked):
            starter.verify_files(link, self.records, 1)

    def test_numeric_filetime_is_not_accepted(self):
        candidate = {"pid": 7, "path": str(starter.GAME), "createdFileTime": 134384678410182997}
        self.assertFalse(starter.identity_valid(candidate))

    def test_boolean_pid_is_not_an_integer_identity(self):
        candidate = {"pid": True, "path": str(starter.GAME), "createdFileTime": "134384678410182997"}
        self.assertFalse(starter.identity_valid(candidate))


if __name__ == "__main__":
    unittest.main(verbosity=2)
