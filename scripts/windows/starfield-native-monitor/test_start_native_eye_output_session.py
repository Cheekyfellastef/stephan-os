"""Offline workflow tests. No PowerShell, Steam, game or reviewed DLL is executed."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


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
