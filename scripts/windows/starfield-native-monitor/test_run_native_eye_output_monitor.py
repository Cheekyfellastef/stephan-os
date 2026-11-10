"""Deterministic controller failure-boundary tests; no Windows/game execution."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


MODULE_PATH = Path(__file__).with_name("run_native_eye_output_monitor.py")
spec = importlib.util.spec_from_file_location("monitor_under_test", MODULE_PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

PROCESS = {"pid": 54321, "path": str(m.GAME), "createdFileTime": "134384778410182996",
           "createdUtc": "2026-11-06T22:30:41.0182996Z"}
SESSION_ID = "a" * 32


def starter_receipt(process=None):
    return {"sessionId": SESSION_ID, "stage": m.WAITING, "launchRequested": True,
            "handoffSha256": m.HANDOFF_SHA256, "reviewedDllSha256": m.DLL_SHA256,
            "injected": False, "captureAttempted": False, "saveLoadedConfirmed": False,
            "process": copy.deepcopy(process or PROCESS)}


def live_status(session=None):
    session = copy.deepcopy(session or starter_receipt())
    return {"session": session, "operationLockPresent": False,
            "games": [copy.deepcopy(session["process"])], "proxyState": "isolated"}


def ready_scene(pid=PROCESS["pid"]):
    return {"pid": pid, "loadedFlags": [0, 1], "loadedCandidate": True,
            "rootStable": True, "counterBefore": 700, "counterAfter": 760}


class FakeHost:
    def __init__(self, journal):
        self.journal = journal
        self.calls = []
        self.status = {"session": None, "operationLockPresent": False, "games": [], "proxyState": "restored"}
        self.capture_exists = False
        self.stock_exists = False
        self.scenes = [ready_scene()]
        self.clock = 0.0
        self.load_seconds = 0.0
        self.terminal_at = 0.0
        self.load_error = None
        self.verify_error = None
        self.module_error = None
        self.focused = True
        self.alive = True
        self.manual_close_required = False
        self.status_error_once = None
        self.on_start = None
        self.on_load = None
        self.on_verify = None

    def verify_artifacts(self):
        self.calls.append("verify")
        if self.on_verify:
            self.on_verify()
        if self.verify_error:
            raise self.verify_error

    def assert_no_capture(self):
        self.calls.append("capture-absence")
        if self.capture_exists:
            raise m.Blocked("A native capture already exists")

    def assert_stock_absent(self, process):
        self.calls.append("stock-absence")
        if self.stock_exists:
            raise m.Blocked("Stock receipt exists")

    def helper(self, action):
        self.calls.append(action)
        if action == "status":
            if self.status_error_once:
                error, self.status_error_once = self.status_error_once, None
                raise error
            return copy.deepcopy(self.status)
        if action == "start":
            self.status = live_status()
            if self.on_start:
                self.on_start()
            return copy.deepcopy(self.status["session"])
        if action == "finish":
            if any(not m.same_process(row, PROCESS) for row in self.status["games"]):
                raise m.Blocked("Frozen helper refuses an unowned game")
            if self.manual_close_required and self.status["games"]:
                return {**starter_receipt(), "stage": "NORMAL_EXIT_STILL_REQUIRED"}
            was_live = bool(self.status["games"])
            self.status["games"] = []
            self.status["proxyState"] = "restored"
            self.alive = False
            receipt = {**starter_receipt(), "stage": "GAME_EXIT_OBSERVED_PROXY_RESTORED",
                       "proxyRestored": True, "gameExitObserved": True, "normalExitProven": was_live}
            self.status["session"] = receipt
            return receipt
        raise AssertionError(action)

    def open_guard(self, process):
        self.calls.append("open-guard")
        return copy.deepcopy(process)

    def guard_alive(self, guard):
        return self.alive

    def focus_game(self, process, guard):
        self.calls.append("focus")
        return self.focused

    def original_check(self, action, process):
        self.calls.append(action)
        if action == "modules":
            if self.module_error:
                raise self.module_error
            return {"pid": process["pid"], "createdFileTime": process["createdFileTime"],
                    "independentModulesPassed": True}
        if action == "scene":
            value = self.scenes[0]
            if len(self.scenes) > 1:
                self.scenes.pop(0)
            return copy.deepcopy(value)
        if action == "stock":
            self.stock_exists = True
            return {"pid": process["pid"], "systemDxgi": r"C:\Windows\System32\dxgi.dll",
                    "proxyMapped": False, "rollbackReceipt": "proxy-isolation-receipt.json"}
        raise AssertionError(action)

    def load_once(self, process, attempt, deadline):
        self.calls.append("load")
        # Assert the state is already durably on disk at the dispatch boundary.
        disk = m.strict_json(self.journal.path.read_bytes())
        if disk.get("stage") != "CAPTURE_ATTEMPT_RESERVED" or disk.get("captureAttempted") is not True:
            raise AssertionError("Loader dispatched before durable consumption")
        if disk.get("captureAttemptToken") != attempt:
            raise AssertionError("Loader token was not persisted")
        self.clock += self.load_seconds
        if self.on_load:
            self.on_load()
        if self.load_error:
            raise self.load_error
        return {"pid": process["pid"], "dllSha256": m.DLL_SHA256, "moduleLoaded": True,
                "recordingConfirmed": False, "moduleRetainedUntilProcessExit": True}

    def monotonic(self):
        return self.clock

    def sleep(self, seconds):
        self.clock += seconds

    def capture_terminal_seen(self, process):
        return self.terminal_at is not None and self.clock >= self.terminal_at

    def collect_results(self, state):
        self.calls.append("collect")
        state["resultZip"] = "synthetic-tests-only.zip"
        state["outcome"] = "SYNTHETIC_CONTROLLER_TEST_ONLY"


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = m.Journal(Path(self.temp.name) / "one-click")
        self.host = FakeHost(self.journal)
        self.monitor = m.Monitor(self.journal, self.host)

    def prepare(self):
        self.assertEqual(self.monitor.prepare(), "waiting")

    def test_prepare_never_loads_or_reuses_confirmation(self):
        self.prepare()
        self.assertNotIn("load", self.host.calls)
        self.assertFalse(self.monitor.state["captureAttempted"])
        self.assertFalse(self.monitor.state["saveLoadedConfirmed"])
        self.assertTrue(self.monitor.confirmation_available)

    def test_actual_confirmation_consumes_before_single_loader_then_finishes(self):
        self.prepare()
        self.assertEqual(self.monitor.confirm_save_loaded(), "done")
        self.assertEqual(self.host.calls.count("load"), 1)
        self.assertEqual(self.host.calls.count("finish"), 1)
        state = self.monitor.state
        self.assertEqual(state["saveConfirmation"]["createdFileTime"], PROCESS["createdFileTime"])
        self.assertEqual(state["saveConfirmation"]["source"], "current_window_button")
        self.assertEqual(state["lastObservedProcessIdentity"]["process"], PROCESS)
        self.assertEqual(state["probeLoadState"], "MODULE_LOAD_PROVEN")
        with self.assertRaises(m.Blocked):
            self.monitor.confirm_save_loaded()
        self.assertEqual(self.host.calls.count("load"), 1)

    def test_second_window_cannot_close_first_window_game(self):
        self.prepare()
        second_journal = m.Journal(self.journal.directory)
        second_host = FakeHost(second_journal)
        second = m.Monitor(second_journal, second_host)
        with self.assertRaises(m.Blocked) as caught:
            second.prepare()
        self.assertEqual(second.fail(caught.exception), "blocked")
        self.assertEqual(second_host.calls, [])
        self.assertNotIn("finish", self.host.calls)
        self.assertTrue(self.journal.lock.exists())

    def test_reopened_gui_attempt_is_cleanup_only(self):
        self.prepare()
        self.journal.release()
        reopened_journal = m.Journal(self.journal.directory)
        reopened_host = FakeHost(reopened_journal)
        reopened_host.status = live_status()
        reopened = m.Monitor(reopened_journal, reopened_host)
        self.assertEqual(reopened.prepare(), "existing")
        with self.assertRaises(m.Blocked):
            reopened.confirm_save_loaded()
        self.assertEqual(reopened.finish(), "done")
        self.assertNotIn("start", reopened_host.calls)
        self.assertNotIn("load", reopened_host.calls)

    def test_existing_frozen_waiting_session_requires_new_button_and_no_start(self):
        self.host.status = live_status()
        self.prepare()
        self.assertNotIn("start", self.host.calls)
        self.assertNotIn("load", self.host.calls)
        self.assertEqual(self.monitor.state["starterSessionId"], SESSION_ID)
        self.assertTrue(self.monitor.state["adoptedExistingWaitingStarter"])
        self.monitor.confirm_save_loaded()
        self.assertEqual(self.host.calls.count("load"), 1)

    def test_consumed_old_starter_confirmation_is_rejected(self):
        self.host.status = live_status()
        self.host.status["session"]["saveLoadedConfirmed"] = True
        with self.assertRaises(m.Blocked):
            self.monitor.prepare()
        self.assertNotIn("start", self.host.calls)
        self.assertNotIn("load", self.host.calls)

    def test_cancel_already_present_never_launches(self):
        self.monitor.cancelled.set()
        self.assertEqual(self.monitor.prepare(), "done")
        self.assertNotIn("start", self.host.calls)
        self.assertNotIn("load", self.host.calls)

    def test_cancel_arriving_during_verification_never_launches(self):
        self.host.on_verify = self.monitor.cancelled.set
        self.assertEqual(self.monitor.prepare(), "done")
        self.assertNotIn("start", self.host.calls)

    def test_cancel_during_dispatched_start_keeps_owned_identity_for_cleanup(self):
        self.host.on_start = self.monitor.cancelled.set
        self.prepare()
        self.assertEqual(self.monitor.state["starterSessionId"], SESSION_ID)
        self.assertEqual(self.monitor.finish("CANCELLED_BEFORE_PROBE"), "done")
        self.assertEqual(self.host.calls.count("start"), 1)
        self.assertEqual(self.host.calls.count("finish"), 1)
        self.assertNotIn("load", self.host.calls)

    def test_artifact_failure_does_not_start_or_close_game(self):
        self.host.verify_error = m.Blocked("changed DLL")
        with self.assertRaises(m.Blocked) as caught:
            self.monitor.prepare()
        self.monitor.fail(caught.exception)
        self.assertNotIn("start", self.host.calls)
        self.assertNotIn("finish", self.host.calls)

    def test_old_capture_blocks_start(self):
        self.host.capture_exists = True
        with self.assertRaises(m.Blocked):
            self.monitor.prepare()
        self.assertNotIn("start", self.host.calls)
        self.assertNotIn("load", self.host.calls)

    def test_exact_start_receipt_preserves_ownership_if_followup_status_fails(self):
        def fail_next_status():
            self.host.status_error_once = m.Blocked("status failed after successful start")
        self.host.on_start = fail_next_status
        with self.assertRaises(m.Blocked) as caught:
            self.monitor.prepare()
        self.assertEqual(self.monitor.state["starterSessionId"], SESSION_ID)
        self.monitor.fail(caught.exception)
        self.assertEqual(self.host.calls.count("finish"), 1)
        self.assertNotIn("load", self.host.calls)

    def test_pid_reuse_between_prepare_and_confirmation_refuses_probe(self):
        self.prepare()
        self.host.status["games"][0]["createdFileTime"] = "134384778410182997"
        with self.assertRaises(m.Blocked):
            self.monitor.confirm_save_loaded()
        self.assertNotIn("load", self.host.calls)
        self.assertFalse(self.monitor.state["captureAttempted"])

    def test_second_game_is_not_closed_by_cleanup(self):
        self.prepare()
        self.host.status["games"].append({**PROCESS, "pid": 99999})
        self.assertEqual(self.monitor.finish(), "cleanup")
        self.assertEqual(len(self.host.status["games"]), 2)
        self.assertFalse(self.monitor.state["cleanupComplete"])

    def test_lost_foreground_prevents_probe(self):
        self.prepare()
        self.host.focused = False
        with self.assertRaises(m.Blocked):
            self.monitor.confirm_save_loaded()
        self.assertNotIn("load", self.host.calls)

    def test_provider_or_other_probe_rejection_is_not_weakened(self):
        self.prepare()
        self.host.module_error = m.Blocked("another probe is resident")
        with self.assertRaises(m.Blocked) as caught:
            self.monitor.confirm_save_loaded()
        self.monitor.fail(caught.exception)
        self.assertNotIn("load", self.host.calls)
        self.assertEqual(self.host.calls.count("finish"), 1)

    def test_not_ready_scene_returns_to_new_confirmation_without_stock_write(self):
        self.prepare()
        self.host.scenes = [{**ready_scene(), "counterAfter": 700}, ready_scene()]
        self.assertEqual(self.monitor.confirm_save_loaded(), "waiting")
        self.assertNotIn("stock", self.host.calls)
        self.assertNotIn("load", self.host.calls)
        self.assertFalse(self.monitor.state["saveLoadedConfirmed"])
        self.assertTrue(self.monitor.confirmation_available)
        self.assertEqual(self.monitor.confirm_save_loaded(), "done")
        self.assertEqual(self.host.calls.count("stock"), 1)
        self.assertEqual(self.host.calls.count("load"), 1)

    def test_preexisting_stock_receipt_is_preserved(self):
        self.prepare()
        self.host.stock_exists = True
        with self.assertRaises(m.Blocked):
            self.monitor.confirm_save_loaded()
        self.assertNotIn("stock", self.host.calls)
        self.assertNotIn("load", self.host.calls)

    def test_failed_durable_attempt_write_prevents_loader_and_automatic_cleanup(self):
        self.prepare()
        original_save = self.journal.save
        def fail_reservation(new=False):
            if self.monitor.state["stage"] == "CAPTURE_ATTEMPT_RESERVED":
                self.journal.write_uncertain = True
                raise OSError("simulated interrupted fsync")
            return original_save(new)
        with mock.patch.object(self.journal, "save", side_effect=fail_reservation):
            with self.assertRaises(OSError) as caught:
                self.monitor.confirm_save_loaded()
            self.assertEqual(self.monitor.fail(caught.exception), "blocked")
        self.assertNotIn("load", self.host.calls)
        self.assertNotIn("finish", self.host.calls)
        self.journal.release()
        self.assertTrue(self.journal.lock.exists())

    def test_cancel_after_attempt_commit_but_before_dispatch_never_loads(self):
        self.prepare()
        original_event = self.journal.event
        def cancel_at_commit(stage, **fields):
            result = original_event(stage, **fields)
            if stage == "CAPTURE_ATTEMPT_RESERVED":
                self.monitor.cancelled.set()
            return result
        with mock.patch.object(self.journal, "event", side_effect=cancel_at_commit):
            self.assertEqual(self.monitor.confirm_save_loaded(), "done")
        self.assertTrue(self.monitor.state["captureAttempted"])
        self.assertEqual(self.monitor.state["probeLoadState"], "NOT_DISPATCHED")
        self.assertNotIn("load", self.host.calls)

    def test_loader_receipt_error_does_not_reinject_or_skip_bounded_capture(self):
        self.prepare()
        self.host.load_error = m.Blocked("stdout damaged after injection")
        self.host.terminal_at = 30
        self.assertEqual(self.monitor.confirm_save_loaded(), "done")
        self.assertEqual(self.host.calls.count("load"), 1)
        self.assertEqual(self.host.calls.count("finish"), 1)
        self.assertGreaterEqual(self.host.clock, 30)
        self.assertEqual(self.monitor.state["probeLoadState"], "UNKNOWN")

    def test_watchdog_is_210_seconds_from_loader_invocation_not_reset_after_slow_loader(self):
        self.prepare()
        self.host.load_seconds = 200
        self.host.terminal_at = None
        self.monitor.confirm_save_loaded()
        self.assertEqual(self.host.clock, 210)
        self.assertTrue(self.monitor.state["timedOut"])
        self.assertEqual(self.host.calls.count("load"), 1)
        self.assertNotIn("kill", self.host.calls)

    def test_watchdog_after_fast_loader_return_is_180_seconds(self):
        self.prepare()
        self.host.load_seconds = 5
        self.host.terminal_at = None
        self.monitor.confirm_save_loaded()
        self.assertEqual(self.host.clock, 185)
        self.assertTrue(self.monitor.state["timedOut"])

    def test_cancel_after_dispatch_consumes_attempt_and_closes_normally(self):
        self.prepare()
        self.host.on_load = self.monitor.cancelled.set
        self.monitor.confirm_save_loaded()
        self.assertTrue(self.monitor.state["cancelledByOperator"])
        self.assertEqual(self.host.calls.count("load"), 1)
        self.assertEqual(self.host.calls.count("finish"), 1)

    def test_manual_exit_followed_by_cleanup_does_not_reinject(self):
        self.prepare()
        self.host.manual_close_required = True
        self.assertEqual(self.monitor.confirm_save_loaded(), "cleanup")
        self.host.status["games"] = []
        self.host.alive = False
        self.assertEqual(self.monitor.finish(), "done")
        self.assertEqual(self.host.calls.count("load"), 1)
        self.assertFalse(self.monitor.state["cleanupReceipt"]["normalExitProven"])

    def test_changed_starter_session_is_never_closed(self):
        self.prepare()
        self.host.status["session"]["sessionId"] = "b" * 32
        self.assertEqual(self.monitor.finish(), "cleanup")
        self.assertNotIn("finish", self.host.calls)


class PredicateAndAdmissionTests(unittest.TestCase):
    def test_readiness_rejects_bool_flags_counter_strings_floats_stalls_and_wrap(self):
        self.assertTrue(m.readiness_valid(ready_scene(), PROCESS["pid"]))
        bad = [{"loadedFlags": [False, True]}, {"loadedFlags": [0.0, 1.0]}, {"counterBefore": "700"},
               {"counterAfter": 760.0}, {"counterAfter": 700}, {"counterBefore": 0xFFFFFFFF, "counterAfter": 0},
               {"rootStable": 1}, {"loadedCandidate": 1}, {"pid": "54321"}]
        for change in bad:
            with self.subTest(change=change):
                self.assertFalse(m.readiness_valid({**ready_scene(), **change}, PROCESS["pid"]))

    def admission(self):
        state = {"schema": m.SCHEMA, "workspace": str(m.WORKSPACE), "runId": "c" * 32,
                 "handoffSha256": m.HANDOFF_SHA256, "reviewedDllSha256": m.DLL_SHA256,
                 "starterSessionId": SESSION_ID, "process": copy.deepcopy(PROCESS),
                 "stage": "CAPTURE_ATTEMPT_RESERVED", "captureAttempted": True,
                 "saveLoadedConfirmed": True, "operatorLockOwner": "d" * 32, "windowProcessId": 1234,
                 "captureAttemptToken": "e" * 32, "captureAbsentBeforeLoad": True,
                 "observedProcessCreatedFileTime": PROCESS["createdFileTime"], "sceneReadiness": ready_scene(),
                 "moduleReadiness": {"independentModulesPassed": True, "createdFileTime": PROCESS["createdFileTime"]},
                 "stockDxgi": {"proxyMapped": False, "pid": PROCESS["pid"]}}
        state["saveConfirmation"] = {"source": "current_window_button", "runId": state["runId"],
                                     "starterSessionId": SESSION_ID, "pid": PROCESS["pid"],
                                     "createdFileTime": PROCESS["createdFileTime"], "utc": "2026-11-06T22:31:00Z"}
        return state, {"owner": "d" * 32, "pid": 1234}

    def validate(self, state, lock, **kwargs):
        args = {"action": "load", "pid": PROCESS["pid"], "filetime": PROCESS["createdFileTime"],
                "attempt": "e" * 32, "parent_pid": 1234}
        args.update(kwargs)
        return m.validate_internal_admission(state, lock, **args)

    def test_only_exact_current_child_admission_is_accepted(self):
        state, lock = self.admission()
        self.assertEqual(self.validate(state, lock), PROCESS)
        for change in ({"attempt": "f" * 32}, {"parent_pid": 5678}, {"filetime": float(PROCESS["createdFileTime"])},
                       {"pid": PROCESS["pid"] + 1}):
            with self.subTest(change=change), self.assertRaises(m.Blocked):
                self.validate(state, lock, **change)

    def test_old_confirmation_changed_stage_missing_readiness_and_replay_are_refused(self):
        for change in ({"stage": "LOADER_RETURNED_CAPTURE_PENDING"}, {"stage": "CLEANUP_REQUIRED"},
                       {"captureAttempted": False}, {"captureAbsentBeforeLoad": False},
                       {"saveLoadedConfirmed": False}, {"sceneReadiness": {}}, {"moduleReadiness": {}},
                       {"stockDxgi": {}}, {"saveConfirmation": {}}):
            state, lock = self.admission()
            state.update(change)
            with self.subTest(change=change), self.assertRaises(m.Blocked):
                self.validate(state, lock)

    def test_stock_admission_cannot_be_used_as_capture_admission(self):
        state, lock = self.admission()
        state.update(stage="FRESH_SAVE_BUTTON_CONFIRMED", captureAttempted=False)
        self.assertEqual(self.validate(state, lock, action="stock", attempt=None), PROCESS)
        with self.assertRaises(m.Blocked):
            self.validate(state, lock)

    def test_decimal_filetime_preserves_last_digit_and_refuses_float(self):
        self.assertTrue(m.process_valid(PROCESS))
        self.assertFalse(m.process_valid({**PROCESS, "createdFileTime": float(PROCESS["createdFileTime"])}))
        self.assertFalse(m.same_process(PROCESS, {**PROCESS, "createdFileTime": "134384778410182997"}))

    def test_exclusive_consumption_marker_never_overwrites_previous_attempt(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "loader-child-consumed.json"
            m.write_new(path, b"original-attempt")
            with self.assertRaises(FileExistsError):
                m.write_new(path, b"new-attempt")
            self.assertEqual(path.read_bytes(), b"original-attempt")


class DurableAdapterTests(unittest.TestCase):
    def test_runner_changed_between_verified_bootstrap_and_factory_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "runner.py"
            original = b"print('reviewed')\n"
            path.write_bytes(original)
            bootstrapped_digest = m.sha256(original)
            self.assertEqual(m.verified_runner_identity(path, bootstrapped_digest), bootstrapped_digest)
            path.write_bytes(b"raise RuntimeError('replacement must never execute')\n")
            with self.assertRaises(m.Blocked):
                m.verified_runner_identity(path, bootstrapped_digest)
            with self.assertRaises(m.Blocked):
                m.verified_runner_identity(path, None)

    def test_original_checkpoint_refuses_integer_zero_substituted_for_false(self):
        handoff = {"workspace": str(m.WORKSPACE), "activeSource": str(m.SOURCE), "files": {},
                   "state": "reviewed", "review": {"passed": True}, "artifactHashes": {}, "archive": "reviewed.zip"}
        expected = {"state": handoff["state"], "captureExecuted": False, "liveGamePid": None,
                    "review": handoff["review"], "artifacts": {},
                    "handoff": str(m.OUTPUTS / "Starfield-VR-HANDOFF.json"), "archive": handoff["archive"]}
        saved = copy.deepcopy(expected)
        helper = mock.Mock(ARCHIVE_HASH="archive", GAME_HASH="game")
        helper.digest.side_effect = lambda path: ("game" if path == m.GAME else
                                                   "archive" if path.name.endswith(".zip") else m.HANDOFF_SHA256)
        helper.read_json.side_effect = lambda path: saved if path.name == "native-eye-output-v1-checkpoint.json" else handoff
        with mock.patch.object(Path, "stat", return_value=mock.Mock(st_size=1399942)):
            self.assertEqual(m.verify_originals(helper), handoff)
            saved["captureExecuted"] = 0
            with self.assertRaises(m.Blocked):
                m.verify_originals(helper)
            saved["captureExecuted"] = False
            saved["review"]["passed"] = 1
            with self.assertRaises(m.Blocked):
                m.verify_originals(helper)

    def test_pinned_module_executes_the_hashed_bytes_and_refuses_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "pinned.py"
            source = b"observed = 'fixed'\n"
            path.write_bytes(source)
            loaded = m.pinned_module(path, hashlib.sha256(source).hexdigest(), "_test_fixed_monitor_module")
            self.assertEqual(loaded.observed, "fixed")
            path.write_bytes(b"raise RuntimeError('must never execute')\n")
            with self.assertRaises(m.Blocked):
                m.pinned_module(path, hashlib.sha256(source).hexdigest(), "_test_fixed_monitor_module")

    def test_status_child_does_not_erase_unresolved_loader_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = m.Journal(Path(folder) / "run")
            journal.acquire()
            outstanding = {"id": "a" * 32, "role": "load", "state": "UNRESOLVED", "pid": 12345,
                           "stdout": "load-" + "a" * 32 + ".stdout.txt", "stderr": "load-" + "a" * 32 + ".stderr.txt"}
            journal.state["childCalls"] = [copy.deepcopy(outstanding)]
            journal.state["activeChild"] = copy.deepcopy(outstanding)
            journal.save()
            host = m.WindowsActions.__new__(m.WindowsActions)
            host.journal, host.children = journal, {}
            with mock.patch.object(m, "SOURCE", Path(folder)), mock.patch.object(m.subprocess, "CREATE_NO_WINDOW", 0, create=True):
                result = host._run("status", [sys.executable, "-I", "-S", "-B", "-c", "print('{\"observed\":true}')"], 5)
            self.assertEqual(result, {"observed": True})
            self.assertEqual(journal.state["activeChild"]["id"], outstanding["id"])
            self.assertEqual(journal.state["activeChild"]["role"], "load")
            self.assertEqual(journal.state["childCalls"][1]["state"], "RETURNED")
            journal.release()
            self.assertTrue(journal.lock.exists())

    def test_unresolved_launcher_prevents_every_followup_dispatch(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = m.Journal(Path(folder) / "run")
            journal.acquire()
            journal.state["childCalls"] = [{"id": "a" * 32, "role": "start", "state": "UNRESOLVED", "pid": 12345}]
            journal.save()
            host = m.WindowsActions.__new__(m.WindowsActions)
            host.journal, host.children = journal, {}
            with mock.patch.object(m.subprocess, "Popen") as spawn:
                with self.assertRaises(m.UncertainChild):
                    host._run("finish", ["not-executed"], 1)
                spawn.assert_not_called()

    def test_journal_external_change_is_preserved_and_lock_retained(self):
        with tempfile.TemporaryDirectory() as folder:
            journal = m.Journal(Path(folder) / "run")
            journal.acquire()
            journal.path.write_text("external-change", encoding="utf-8")
            with self.assertRaises(m.Blocked):
                journal.event("SHOULD_NOT_OVERWRITE")
            journal.release()
            self.assertEqual(journal.path.read_text(), "external-change")
            self.assertTrue(journal.lock.exists())

    def test_json_rejects_duplicate_keys_and_nonfinite_numbers(self):
        for raw in ('{"pid":1,"pid":2}', '{"counter":NaN}', '{"counter":Infinity}'):
            with self.assertRaises(ValueError):
                m.strict_json(raw)


class ResultBundleTests(unittest.TestCase):
    """Exercise the actual frozen analyzer and ZIP writer on scoped fixtures."""
    def setUp(self):
        import analyze_native_eye_output_session as analyzer
        import test_analyze_native_eye_output_session as analyzer_tests
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.source = self.folder / "source"
        self.source.mkdir()
        self.journal = m.Journal(self.folder / "run")
        self.journal.acquire()
        self.state = self.journal.state
        self.state.update(process=copy.deepcopy(PROCESS), starterSessionId=SESSION_ID, captureAttempted=True,
                          captureAttemptToken="e" * 32, probeLoadedProven=True, captureAbsentBeforeLoad=True,
                          observedProcessCreatedFileTime=PROCESS["createdFileTime"], timedOut=False,
                          cleanupComplete=True, cleanupReceipt={"normalExitProven": True, "gameExitObserved": True},
                          stockDxgi={"pid": PROCESS["pid"], "proxyMapped": False},
                          loaderReceipt={"pid": PROCESS["pid"], "dllSha256": m.DLL_SHA256, "moduleLoaded": True,
                                         "recordingConfirmed": False, "moduleRetainedUntilProcessExit": True})
        self.capture = self.source / ("native-eye-output-%d.jsonl" % PROCESS["pid"])
        self.capture.write_bytes(b"".join((json.dumps(row) + "\n").encode() for row in analyzer_tests.fixture()))
        self.host = m.WindowsActions.__new__(m.WindowsActions)
        self.host.journal, self.host.children, self.host.analyzer = self.journal, {}, analyzer
        self.stdout_name = "load-" + "a" * 32 + ".stdout.txt"
        self.stderr_name = "load-" + "a" * 32 + ".stderr.txt"
        raw_out = m.json_bytes(self.state["loaderReceipt"])
        m.write_new(self.journal.directory / self.stdout_name, raw_out)
        m.write_new(self.journal.directory / self.stderr_name, b"")
        self.state["childCalls"] = [{"id": "a" * 32, "role": "load", "state": "RETURNED",
                                     "stdout": self.stdout_name, "stderr": self.stderr_name,
                                     "stdoutSha256": m.sha256(raw_out), "stderrSha256": m.sha256(b"")}]
        self.marker = {"runId": self.state["runId"], "starterSessionId": SESSION_ID, "attemptToken": "e" * 32,
                       "pid": PROCESS["pid"], "createdFileTime": PROCESS["createdFileTime"],
                       "reviewedDllSha256": m.DLL_SHA256, "loaderSha256": m.LOADER_SHA256}
        for name in ("stock-child-consumed.json", "loader-child-consumed.json"):
            m.write_new(self.journal.directory / name, m.json_bytes(self.marker))
        self.journal.save()
        self.source_patch = mock.patch.object(m, "SOURCE", self.source)
        self.source_patch.start()

    def tearDown(self):
        self.source_patch.stop()
        self.temporary.cleanup()

    def test_typed_capture_and_finalized_receipts_produce_scoped_new_bundle(self):
        self.host.collect_results(self.state)
        self.assertTrue(self.state["analysis"]["monitorCaptureAccepted"])
        self.assertEqual(self.state["outcome"], "REVIEWED_MONITOR_TEST_PASSED")
        self.assertFalse(self.state["playableVRProven"])
        original_zip = Path(self.state["resultZip"])
        original_bytes = original_zip.read_bytes()
        with zipfile.ZipFile(original_zip) as archive:
            self.assertEqual(set(archive.namelist()), {self.capture.name, self.stdout_name, self.stderr_name,
                             "stock-child-consumed.json", "loader-child-consumed.json", "capture-analysis.json",
                             "monitor-result.json", "READ-RESULT.txt", "CONTENTS-SHA256.json"})
            manifest = m.strict_json(archive.read("CONTENTS-SHA256.json"))
            for name, record in manifest.items():
                self.assertEqual(m.sha256(archive.read(name)), record["sha256"])
        self.host.collect_results(self.state)
        self.assertNotEqual(Path(self.state["resultZip"]), original_zip)
        self.assertEqual(original_zip.read_bytes(), original_bytes)

    def test_altered_child_log_prevents_overall_pass_and_records_exact_issue(self):
        (self.journal.directory / self.stdout_name).write_text("altered after return")
        self.host.collect_results(self.state)
        self.assertTrue(self.state["analysis"]["monitorCaptureAccepted"])
        self.assertEqual(self.state["outcome"], "CAPTURE_PASSED_RESULT_RECEIPTS_INCOMPLETE")
        self.assertTrue(any("differ" in issue and self.stdout_name in issue for issue in self.state["bundleEvidenceIssues"]))

    def test_missing_log_is_reported_and_never_silently_ignored(self):
        (self.journal.directory / self.stderr_name).unlink()
        self.host.collect_results(self.state)
        self.assertFalse(self.state["bundleEvidenceIntegrityVerified"])
        self.assertNotEqual(self.state["outcome"], "REVIEWED_MONITOR_TEST_PASSED")
        self.assertTrue(any(self.stderr_name in issue and "omitted" in issue for issue in self.state["bundleEvidenceIssues"]))

    def test_consumption_receipt_for_different_process_cannot_prove_this_load(self):
        self.marker["createdFileTime"] = "134384778410182997"
        (self.journal.directory / "loader-child-consumed.json").write_bytes(m.json_bytes(self.marker))
        self.host.collect_results(self.state)
        self.assertFalse(self.state["bundleEvidenceIntegrityVerified"])
        self.assertNotEqual(self.state["outcome"], "REVIEWED_MONITOR_TEST_PASSED")

    def test_generic_finished_file_never_becomes_capture_success(self):
        self.capture.write_text('{"status":"finished","originalBytesAndProtectionRestored":true}\n')
        self.host.collect_results(self.state)
        self.assertFalse(self.state["analysis"]["monitorCaptureAccepted"])
        self.assertEqual(self.state["outcome"], "MONITOR_EVIDENCE_REJECTED_OR_INCOMPLETE")


if __name__ == "__main__":
    unittest.main()
