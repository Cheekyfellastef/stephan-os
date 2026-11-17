"""Exercise actual stdio dispatch against the existing core with its fake host.

No Windows API, Starfield, DLL or headset is exercised. No import search path is
changed: each dependency below is loaded from its exact sibling source file.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest


ROOT = Path(__file__).parent


def module_from_file(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


b = module_from_file("splash_bridge_under_test", "splash_monitor_bridge.py")
fixtures = module_from_file("splash_core_fixtures", "test_run_native_eye_output_monitor.py")
m = fixtures.m
CHANNEL = "1" * 32
BRIDGE_DIGEST = hashlib.sha256((ROOT / "splash_monitor_bridge.py").read_bytes()).hexdigest()


def request(command, sequence=1, **fields):
    return {"schema": b.SCHEMA, "channel": CHANNEL, "sequence": sequence, "command": command, **fields}


def confirm_request(state, sequence=2):
    return request("confirm", sequence, confirmationToken=state["confirmationToken"], runId=state["runId"],
                   pid=state["process"]["pid"], createdFileTime=state["process"]["createdFileTime"])


def wire(value):
    return (json.dumps(value) + "\n").encode("utf-8")


class ProtocolTests(unittest.TestCase):
    def test_only_closed_typed_command_schema_is_admitted(self):
        for change in ({"sequence": True}, {"sequence": 1.0}, {"sequence": 0},
                       {"sequence": 2}, {"channel": "2" * 32}, {"schema": "other"},
                       {"command": "shell"}, {"command": ["prepare"]}, {"path": "somewhere"}):
            with self.subTest(change=change), self.assertRaises(b.ProtocolError):
                b.validate_request({**request("prepare"), **change}, CHANNEL, 1)
        self.assertEqual(b.validate_request(request("prepare"), CHANNEL, 1), "prepare")

    def test_line_reader_rejects_duplicates_nonfinite_partial_and_oversized_input(self):
        invalid = [b'{"command":"prepare","command":"confirm"}\n', b'{"value":NaN}\n',
                   b'{"value":Infinity}\n', b'[]\n', b'\xff\n', b'{}',
                   b" " * b.MAX_COMMAND_BYTES + b"\n"]
        for raw in invalid:
            with self.subTest(raw=raw[:50]), self.assertRaises(b.ProtocolError):
                b.decode_request(raw)
        self.assertEqual(b.decode_request(wire(request("prepare"))), request("prepare"))

    def test_confirm_requires_exact_fields(self):
        with self.assertRaises(b.ProtocolError):
            b.validate_request(request("confirm"), CHANNEL, 1)
        value = request("confirm", confirmationToken="a" * 32, runId="b" * 32,
                        pid=10, createdFileTime="134384778410182996")
        self.assertEqual(b.validate_request(value, CHANNEL, 1), "confirm")

    def test_verified_core_is_loaded_from_checked_bytes_and_receives_its_digest(self):
        core = b.load_core(ROOT)
        self.assertEqual(core.__VERIFIED_RUNNER_SHA256__, b.CORE_SHA256)
        self.assertEqual(hashlib.sha256((ROOT / b.CORE_NAME).read_bytes()).hexdigest(), b.CORE_SHA256)
        self.assertEqual(core.HELPER_SHA256, hashlib.sha256((ROOT / core.HELPER_NAME).read_bytes()).hexdigest())
        self.assertEqual(core.ANALYZER_SHA256, hashlib.sha256((ROOT / core.ANALYZER_NAME).read_bytes()).hexdigest())
        self.assertEqual(core.WORKSPACE, Path.home() / "Documents" / "Codex" / "2026-11-05" / "starfield-vr-did-not-start-and")

    def test_changed_core_is_rejected_without_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / b.CORE_NAME).write_text("raise RuntimeError('must not execute')\n")
            with self.assertRaises(b.ProtocolError):
                b.load_core(folder)

    def test_bridge_identity_rejects_missing_digest_and_changed_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "bridge.py"
            path.write_bytes(b"original")
            expected = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(b.verify_bridge_identity(path, expected), expected)
            with self.assertRaises(b.ProtocolError):
                b.verify_bridge_identity(path, None)
            path.write_bytes(b"changed")
            with self.assertRaises(b.ProtocolError):
                b.verify_bridge_identity(path, expected)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / "monitor"
        self.journal = m.Journal(self.directory)
        self.host = fixtures.FakeHost(self.journal)
        self.host.close = lambda: self.host.calls.append("host-close")
        self.monitor = m.Monitor(self.journal, self.host)
        self.sink = io.StringIO()
        self.session = b.SplashSession(self.factory, self.sink, CHANNEL, self.directory, BRIDGE_DIGEST)
        self.addCleanup(self.close_session)

    def factory(self, notify):
        self.monitor.notify = notify
        return self.monitor

    def settle(self):
        deadline = time.monotonic() + 4
        while True:
            self.session.pump()
            if self.session.closed or (not self.session.busy and not self.session.close_requested):
                break
            if time.monotonic() >= deadline:
                self.fail("The offline operation did not settle")
            time.sleep(0.002)

    def close_session(self):
        if not self.session.closed:
            self.session.request_stop("CANCELLED_TEST_COMPLETE")
            self.settle()

    def prepare(self):
        self.session.command(request("prepare"))
        self.settle()
        self.assertEqual(self.session.mode, "waiting")
        return self.session.projection()

    def test_only_prepare_does_not_confirm_or_load(self):
        state = self.prepare()
        self.assertEqual(self.host.calls.count("start"), 1)
        self.assertNotIn("load", self.host.calls)
        self.assertFalse(self.monitor.state["saveLoadedConfirmed"])
        self.assertRegex(state["confirmationToken"], r"^[0-9a-f]{32}$")
        self.assertEqual(state["process"]["createdFileTime"], fixtures.PROCESS["createdFileTime"])
        self.assertFalse(state["providerSlotReleased"])
        self.assertFalse(state["safeToClose"])

    def test_current_button_confirmation_runs_exactly_once(self):
        state = self.prepare()
        self.session.command(confirm_request(state))
        self.settle()
        self.assertEqual(self.host.calls.count("load"), 1)
        self.assertEqual(self.host.calls.count("finish"), 1)
        self.assertEqual(self.session.mode, "done")
        self.assertTrue(self.session.projection()["safeToClose"])
        self.assertTrue(self.session.projection()["providerSlotReleased"])
        self.assertFalse(self.session.projection()["playableVRProven"])
        with self.assertRaises(b.ProtocolError):
            self.session.command(confirm_request(state, 3))
        self.assertEqual(self.host.calls.count("load"), 1)

    def test_confirm_cannot_be_queued_before_waiting(self):
        unknown = request("confirm", confirmationToken="a" * 32, runId="b" * 32,
                          pid=fixtures.PROCESS["pid"], createdFileTime=fixtures.PROCESS["createdFileTime"])
        with self.assertRaises(b.ProtocolError):
            self.session.command(unknown)
        self.assertIsNone(self.session.monitor)
        self.assertEqual(self.host.calls, [])

    def test_waiting_token_is_rotated_after_scene_refusal(self):
        self.host.scenes = [{**fixtures.ready_scene(), "rootStable": False}, fixtures.ready_scene()]
        first = self.prepare()
        self.session.command(confirm_request(first))
        self.settle()
        second = self.session.projection()
        self.assertEqual(self.session.mode, "waiting")
        self.assertNotEqual(first["confirmationToken"], second["confirmationToken"])
        self.assertNotIn("stock", self.host.calls)
        self.assertNotIn("load", self.host.calls)
        with self.assertRaises(b.ProtocolError):
            self.session.command(confirm_request(first, 3))
        self.session.command(confirm_request(second, 3))
        self.settle()
        self.assertEqual(self.host.calls.count("load"), 1)

    def test_confirmation_must_echo_exact_process_and_run(self):
        state = self.prepare()
        for change in ({"pid": True}, {"pid": fixtures.PROCESS["pid"] + 1},
                       {"createdFileTime": str(int(fixtures.PROCESS["createdFileTime"]) + 1)},
                       {"createdFileTime": int(fixtures.PROCESS["createdFileTime"])},
                       {"runId": "f" * 32}, {"confirmationToken": "f" * 32}):
            with self.subTest(change=change), self.assertRaises(b.ProtocolError):
                self.session.command({**confirm_request(state), **change})
        self.assertNotIn("focus", self.host.calls)
        self.assertNotIn("load", self.host.calls)

    def test_duplicate_or_skipped_sequence_cannot_repeat_prepare(self):
        self.prepare()
        for sequence in (1, 3, True, 2.0):
            with self.subTest(sequence=sequence), self.assertRaises(b.ProtocolError):
                self.session.command(request("prepare", sequence))
        self.assertEqual(self.host.calls.count("start"), 1)

    def test_busy_only_admits_cancellation_and_keeps_worker_for_cleanup(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        self.host.on_verify = lambda: (entered.set(), release.wait(3))
        self.session.command(request("prepare"))
        self.assertTrue(entered.wait(2))
        with self.assertRaises(b.ProtocolError):
            self.session.command(request("finish", 2))
        self.session.command(request("cancel", 2))
        self.assertFalse(self.session.closed)
        self.assertTrue(self.monitor.cancelled.is_set())
        release.set()
        self.settle()
        self.assertTrue(self.session.closed)
        self.assertNotIn("start", self.host.calls)
        self.assertNotIn("load", self.host.calls)
        self.assertTrue(self.session.projection()["safeToClose"])

    def test_close_before_factory_returns_cannot_start_game(self):
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)

        def delayed(notify):
            entered.set()
            release.wait(3)
            return self.factory(notify)

        self.session.factory = delayed
        self.session.command(request("prepare"))
        self.assertTrue(entered.wait(2))
        self.assertIsNone(self.session.monitor)
        self.session.command(request("close", 2))
        release.set()
        self.settle()
        self.assertTrue(self.session.closed)
        self.assertNotIn("start", self.host.calls)
        self.assertNotIn("load", self.host.calls)

    def test_waiting_close_finishes_owned_game_without_loading(self):
        self.prepare()
        self.session.command(request("close", 2))
        self.settle()
        self.assertTrue(self.session.closed)
        self.assertEqual(self.host.calls.count("finish"), 1)
        self.assertNotIn("load", self.host.calls)
        self.assertFalse(self.journal.lock.exists())

    def test_cleanup_incomplete_cannot_release_provider_on_close(self):
        self.prepare()
        self.host.manual_close_required = True
        self.session.command(request("close", 2))
        self.settle()
        self.assertTrue(self.session.closed)
        self.assertEqual(self.session.exit_code, 2)
        self.assertFalse(self.session.projection()["safeToClose"])
        self.assertFalse(self.session.projection()["providerSlotReleased"])
        self.assertEqual(self.host.calls.count("finish"), 1)

    def test_existing_attempt_is_cleanup_only_and_never_reconfirmed(self):
        first = self.prepare()
        self.journal.release()
        second_journal = m.Journal(self.directory)
        second_host = fixtures.FakeHost(second_journal)
        second_host.close = lambda: None
        second_monitor = m.Monitor(second_journal, second_host)
        second = b.SplashSession(lambda notify: second_monitor, io.StringIO(), CHANNEL, self.directory)
        second.command(request("prepare"))
        deadline = time.monotonic() + 3
        while second.busy and time.monotonic() < deadline:
            second.pump()
            time.sleep(0.002)
        second.pump()
        self.assertEqual(second.mode, "existing")
        self.assertNotIn("confirm", second.actions())
        self.assertIsNone(second.confirmation_token)
        with self.assertRaises(b.ProtocolError):
            second.command(confirm_request(first, 2))
        self.assertNotIn("load", second_host.calls)
        second.request_stop("CANCELLED_TEST_COMPLETE")
        while not second.closed and time.monotonic() < deadline:
            second.pump()
            time.sleep(0.002)
        self.assertTrue(second.closed)

    def test_rejected_core_operation_and_reporting_error_are_not_retried(self):
        calls = []

        def prepare():
            calls.append("prepare")
            raise RuntimeError("action failed")

        def fail(_error):
            calls.append("fail")
            raise RuntimeError("reporting failed")

        self.monitor.prepare, self.monitor.fail = prepare, fail
        self.session.command(request("prepare"))
        self.settle()
        self.assertEqual(calls, ["prepare", "fail"])
        self.assertEqual(self.session.mode, "blocked")
        self.assertIn("reporting failed", self.session.last_error)

    def test_uncertain_journal_or_pending_child_never_releases_provider(self):
        self.prepare()
        self.monitor.state["cleanupComplete"] = True
        for child in ({"role": "load", "pid": 90000}, {}, [], False, 0, ""):
            self.monitor.state["activeChild"] = child
            with self.subTest(child=child):
                self.assertFalse(self.session.projection()["safeToClose"])
                self.assertTrue(self.session.projection()["unresolvedChild"])
        del self.monitor.state["activeChild"]
        self.assertFalse(self.session.projection()["safeToClose"])
        self.monitor.state["activeChild"] = None
        self.journal.write_uncertain = True
        self.assertFalse(self.session.projection()["providerSlotReleased"])
        self.session.request_stop("CANCELLED_TEST_COMPLETE")
        self.settle()
        self.assertTrue(self.journal.lock.exists())

    def test_done_does_not_manufacture_capture_or_playable_success(self):
        self.prepare()
        self.session.command(request("finish", 2))
        self.settle()
        projected = self.session.projection()
        self.assertEqual(projected["mode"], "done")
        self.assertTrue(projected["cleanupComplete"])
        self.assertFalse(projected["analysisAccepted"])
        self.assertFalse(projected["playableVRProven"])
        self.assertNotEqual(projected["outcome"], "REVIEWED_MONITOR_TEST_PASSED")

    def test_result_paths_only_project_existing_scoped_results(self):
        self.prepare()
        nonce = "a" * 12
        result = self.directory / ("Starfield-VR-monitor-result-" + nonce + ".zip")
        directory = self.directory / ("result-" + nonce)
        result.write_bytes(b"fixture")
        directory.mkdir()
        self.monitor.state["resultZip"] = str(result)
        self.assertEqual(self.session.projection()["resultZip"], str(result))
        self.assertEqual(self.session.projection()["resultDirectory"], str(directory))
        for path in (result.with_name("another-file.txt"), result.parent.parent / result.name):
            self.monitor.state["resultZip"] = str(path)
            self.assertIsNone(self.session.projection()["resultZip"])
        self.monitor.state["resultZip"] = str(result)
        result.unlink()
        self.assertIsNone(self.session.projection()["resultZip"])

    def test_result_symlink_is_not_exposed_as_a_result_action(self):
        self.prepare()
        nonce = "b" * 12
        outside = self.directory.parent / "other.zip"
        outside.write_bytes(b"fixture")
        result = self.directory / ("Starfield-VR-monitor-result-" + nonce + ".zip")
        (self.directory / ("result-" + nonce)).mkdir()
        try:
            result.symlink_to(outside)
        except OSError as error:
            self.skipTest("Symlink fixture unavailable: " + str(error))
        self.monitor.state["resultZip"] = str(result)
        self.assertIsNone(self.session.projection()["resultZip"])

    def test_events_bind_channel_child_and_monotonic_sequence(self):
        self.session.emit_state()
        self.prepare()
        self.session.command(request("close", 2))
        self.settle()
        events = [json.loads(line) for line in self.sink.getvalue().splitlines()]
        self.assertEqual([item["eventSequence"] for item in events], list(range(1, len(events) + 1)))
        self.assertTrue(all(item["channel"] == CHANNEL and item["childPid"] == os.getpid() for item in events))
        self.assertTrue(all(item["bridgeSha256"] == BRIDGE_DIGEST and item["runnerSha256"] == b.CORE_SHA256 for item in events))
        self.assertEqual(events[-1]["type"], "closed")
        self.assertEqual(events[-1]["allowedActions"], [])
        self.assertTrue(all(len(line.encode()) <= b.MAX_EVENT_BYTES for line in self.sink.getvalue().splitlines()))


class InterpreterShutdownTests(unittest.TestCase):
    def run_child_with_open_input(self, command, *, parent_loss=False, expected_exit=0):
        # Use an actual interpreter with its normal buffered sys.stdin. Keep
        # the parent's write pipe open until wait() proves real process exit;
        # communicate() would close it early and conceal the shutdown defect.
        code = """
import importlib.util, sys, time
from pathlib import Path
spec = importlib.util.spec_from_file_location('bridge_shutdown_fixture', sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)
factory_called = False
def forbidden_factory(_notify):
    global factory_called
    factory_called = True
    raise AssertionError('A shutdown handshake cannot prepare the monitor')
deadline = time.monotonic() + 0.2
alive = (lambda: time.monotonic() < deadline) if sys.argv[3] == 'lost' else (lambda: True)
result = bridge.run_session(forbidden_factory, sys.stdin.buffer, sys.stdout, '1' * 32,
                            Path(sys.argv[2]), parent_alive=alive)
sys.exit(97 if factory_called else result)
"""
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary) / "must-not-be-created"
            child = subprocess.Popen(
                [sys.executable, "-I", "-S", "-B", "-u", "-c", code,
                 str(ROOT / "splash_monitor_bridge.py"), str(workspace),
                 "lost" if parent_loss else "alive"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                child.stdin.write(command)
                child.stdin.flush()
                exit_code = child.wait(timeout=10)
                self.assertFalse(child.stdin.closed)
                output = child.stdout.read().decode("utf-8")
                errors = child.stderr.read().decode("utf-8", "replace")
                self.assertEqual(exit_code, expected_exit, errors)
                self.assertEqual(errors, "")
                self.assertFalse(workspace.exists())
                events = [json.loads(line) for line in output.splitlines()]
                self.assertEqual(events[0]["type"], "state")
                self.assertEqual(events[0]["mode"], "ready")
                self.assertEqual(events[-1]["type"], "closed")
                self.assertEqual(events[-1]["exitCode"], exit_code)
                self.assertTrue(events[-1]["safeToClose"])
                self.assertTrue(events[-1]["providerSlotReleased"])
                self.assertIsNone(events[-1]["runId"])
                return events
            finally:
                child.stdin.close()
                if child.poll() is None:
                    # This is only the disposable no-factory test interpreter.
                    # There can be no game/helper child or mutation to preserve.
                    child.kill()
                    child.wait(timeout=5)
                child.stdout.close()
                child.stderr.close()

    def test_close_exits_normally_with_parent_input_pipe_still_open(self):
        self.run_child_with_open_input(wire(request("close")))

    def test_invalid_command_exits_blocked_without_buffered_input_abort(self):
        events = self.run_child_with_open_input(b'{"command": "unknown"}\n', expected_exit=2)
        self.assertIn("outside the fixed monitor workflow", events[-1]["error"])

    def test_parent_loss_during_partial_input_exits_without_buffered_input_abort(self):
        self.run_child_with_open_input(b'{"command":', parent_loss=True)


class PipeLifecycleTests(unittest.TestCase):
    def test_handshake_then_close_never_constructs_monitor_or_touches_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = io.StringIO()
            workspace = Path(temporary) / "must-not-be-created"

            def forbidden_factory(_notify):
                raise AssertionError("Close-only handshake must not construct the monitor")

            result = b.run_session(forbidden_factory, io.BytesIO(wire(request("close"))), output,
                                   CHANNEL, workspace, bridge_digest=BRIDGE_DIGEST)
            self.assertEqual(result, 0)
            self.assertFalse(workspace.exists())
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([row["type"] for row in events], ["state", "closed"])
            self.assertTrue(events[-1]["providerSlotReleased"])
            self.assertIsNone(events[-1]["runId"])
            self.assertIsNone(events[-1]["process"])

    def run_pipe(self, *, on_waiting=None, parent_alive=None, on_load=None, broken_waiting_output=False):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "monitor"
            journal = m.Journal(directory)
            host = fixtures.FakeHost(journal)
            host.close = lambda: host.calls.append("host-close")
            monitor = m.Monitor(journal, host)
            if on_load:
                host.on_load = lambda: on_load(monitor)
            read_fd, write_fd = os.pipe()
            reader = os.fdopen(read_fd, "rb", buffering=0)
            writer = os.fdopen(write_fd, "wb", buffering=0)
            events = []

            class Sink:
                def write(self, text):
                    value = json.loads(text)
                    events.append(value)
                    if value["type"] == "state" and value["mode"] == "ready" and not value["busy"]:
                        writer.write(wire(request("prepare")))
                    if value["type"] == "state" and value["mode"] == "waiting" and not value["busy"]:
                        if broken_waiting_output:
                            raise BrokenPipeError("The owning UI disappeared")
                        if on_waiting:
                            on_waiting(value, writer)
                    return len(text)

                def flush(self):
                    pass

            def factory(notify):
                monitor.notify = notify
                return monitor

            try:
                result = b.run_session(factory, reader, Sink(), CHANNEL, directory,
                                       parent_alive or (lambda: True), BRIDGE_DIGEST)
                state = dict(monitor.state or {})
                calls = list(host.calls)
                lock_present = journal.lock.exists()
            finally:
                if not writer.closed:
                    writer.close()
                reader.close()
            return result, state, calls, events, lock_present

    def test_parent_eof_while_waiting_normally_closes_without_confirmation(self):
        result, state, calls, events, locked = self.run_pipe(on_waiting=lambda _state, writer: writer.close())
        self.assertEqual(result, 0)
        self.assertEqual(calls.count("start"), 1)
        self.assertNotIn("load", calls)
        self.assertEqual(calls.count("finish"), 1)
        self.assertTrue(state["cleanupComplete"])
        self.assertFalse(locked)
        self.assertEqual(events[-1]["type"], "closed")
        self.assertTrue(events[-1]["providerSlotReleased"])

    def test_broken_output_does_not_skip_normal_cleanup(self):
        _result, state, calls, _events, locked = self.run_pipe(broken_waiting_output=True)
        self.assertTrue(state["cleanupComplete"])
        self.assertNotIn("load", calls)
        self.assertEqual(calls.count("finish"), 1)
        self.assertFalse(locked)

    def test_parent_death_after_reserved_loader_consumes_once_and_finishes(self):
        entered = threading.Event()

        def loading(monitor):
            entered.set()
            if not monitor.cancelled.wait(3):
                raise AssertionError("Parent death did not cancel the active operation")

        result, state, calls, _events, locked = self.run_pipe(
            on_waiting=lambda value, writer: writer.write(wire(confirm_request(value))),
            parent_alive=lambda: not entered.is_set(), on_load=loading)
        self.assertEqual(result, 0)
        self.assertEqual(calls.count("load"), 1)
        self.assertEqual(calls.count("finish"), 1)
        self.assertTrue(state["captureAttempted"])
        self.assertTrue(state["cancelledByOperator"])
        self.assertTrue(state["cleanupComplete"])
        self.assertFalse(locked)

    def test_parent_witness_exception_keeps_worker_until_cleanup(self):
        entered = threading.Event()

        def loading(monitor):
            entered.set()
            if not monitor.cancelled.wait(3):
                raise AssertionError("Parent witness failure did not cancel")

        def witness():
            if entered.is_set():
                raise OSError("Parent handle witness failed")
            return True

        result, state, calls, _events, locked = self.run_pipe(
            on_waiting=lambda value, writer: writer.write(wire(confirm_request(value))),
            parent_alive=witness, on_load=loading)
        self.assertEqual(result, 2)
        self.assertEqual(calls.count("load"), 1)
        self.assertEqual(calls.count("finish"), 1)
        self.assertTrue(state["cleanupComplete"])
        self.assertFalse(locked)

    def test_invalid_command_cancels_owned_waiting_game_without_injection(self):
        result, state, calls, events, _locked = self.run_pipe(
            on_waiting=lambda _value, writer: writer.write(wire(request("confirm", 2))))
        self.assertEqual(result, 2)
        self.assertEqual(calls.count("finish"), 1)
        self.assertNotIn("load", calls)
        self.assertTrue(state["cleanupComplete"])
        self.assertIn("fields differ", events[-1]["error"])


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        workspace = root / "saved-work"
        self.core = types.SimpleNamespace(
            WORKSPACE=workspace, SOURCE=workspace / "work" / "stephanos-openxr",
            RUN_DIRECTORY=workspace / "outputs" / "Starfield-VR-monitor-one-click-v1",
            SCHEMA=m.SCHEMA, HANDOFF_SHA256=m.HANDOFF_SHA256, DLL_SHA256=m.DLL_SHA256,
            LOADER_SHA256=m.LOADER_SHA256,
            plain_path=m.plain_path, bounded_bytes=m.bounded_bytes, strict_json=m.strict_json,
            json_bytes=m.json_bytes, process_valid=m.process_valid)
        self.helper = types.SimpleNamespace(
            SESSION_NAME="native-eye-output-monitor-session-v1.json",
            SCHEMA="stephanos.native-eye-output.monitor-session.v1",
            ARCHIVE_HASH="1ea602071f2452f0afc70de1b9a63e6e99ef765f9edccb160b1c8a8f9ffca951",
            PROXY=root / "game" / "dxgi.dll",
            HELD=root / "game" / "dxgi.stephanos-eye-capture-20261106-held",
            PROXY_HASH="63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41")
        self.paths = b.custody_paths(self.core, self.helper)
        self.games = []
        self.process_observations = 0
        self.on_games = None

    def host_factory(self):
        owner = self

        class ReadOnlyHost:
            def games(self):
                owner.process_observations += 1
                if owner.on_games:
                    owner.on_games()
                return owner.games

            def proxy_state(self):
                raise AssertionError("Later legitimate provider proxy must not be frozen to old hash")

        return ReadOnlyHost()

    def write(self, key, value):
        path = self.paths[key]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(m.json_bytes(value))

    def completed_records(self):
        starter = {"schema": self.helper.SCHEMA, "workspace": str(self.core.WORKSPACE),
                   "handoffSha256": m.HANDOFF_SHA256, "reviewedDllSha256": m.DLL_SHA256,
                   "sourceArchiveSha256": self.helper.ARCHIVE_HASH, "sessionId": "b" * 32,
                   "stage": "GAME_EXIT_OBSERVED_PROXY_RESTORED", "launchRequested": True,
                   "proxyRestored": True, "gameExitObserved": True, "process": dict(fixtures.PROCESS),
                   "injected": False, "captureAttempted": False, "saveLoadedConfirmed": False}
        cleanup = {key: starter[key] for key in ("sessionId", "stage", "proxyRestored", "gameExitObserved", "process")}
        outer = {"schema": self.core.SCHEMA, "workspace": str(self.core.WORKSPACE),
                 "handoffSha256": m.HANDOFF_SHA256, "reviewedDllSha256": m.DLL_SHA256,
                 "runId": "a" * 32, "runnerSha256": b.CORE_SHA256, "stage": "CLEANUP_COMPLETE",
                 "cleanupComplete": True, "activeChild": None, "childCalls": [],
                 "captureAttempted": True, "saveLoadedConfirmed": True,
                 "starterSessionId": starter["sessionId"], "process": dict(fixtures.PROCESS),
                 "cleanupReceipt": cleanup}
        restore = {"stage": "restored", "source": str(self.helper.PROXY), "held": str(self.helper.HELD),
                   "expectedSha256": self.helper.PROXY_HASH, "sourceSha256": self.helper.PROXY_HASH,
                   "heldSha256": None, "utc": "2026-11-06T22:00:00+00:00"}
        self.write("outer", outer)
        self.write("starter", starter)
        (self.core.SOURCE / "proxy-isolation-receipt.json").write_bytes(m.json_bytes(restore))
        return outer, starter, restore

    def observe(self):
        return b.provider_custody(self.core, self.helper, self.host_factory)

    def test_no_monitor_custody_is_read_only_and_does_not_require_runtime_game_query(self):
        before = list(Path(self.temporary.name).rglob("*"))
        result = self.observe()
        self.assertTrue(result["allowed"])
        self.assertEqual(result["reason"], "NO_MONITOR_CUSTODY")
        self.assertEqual(self.process_observations, 0)
        self.assertEqual(before, list(Path(self.temporary.name).rglob("*")))

    def test_each_lock_and_held_proxy_blocks_without_process_mutation(self):
        for key in ("outerLock", "starterLock", "heldProxy"):
            self.write(key, {"held": True})
            result = self.observe()
            self.assertFalse(result["allowed"])
            self.assertEqual(result["reason"], "MONITOR_CUSTODY_HELD")
            self.paths[key].unlink()
        self.assertEqual(self.process_observations, 0)

    def test_orphaned_consumption_marker_cannot_reopen_provider_slot(self):
        self.write("loadMarker", {"runId": "a" * 32})
        with self.assertRaisesRegex(b.ProtocolError, "ORPHANED"):
            self.observe()

    def test_verified_completed_monitor_allows_later_legitimate_provider_proxy(self):
        self.completed_records()
        self.helper.PROXY.parent.mkdir()
        self.helper.PROXY.write_bytes(b"later-canonical-provider-contents")
        before = {str(path): path.read_bytes() for path in Path(self.temporary.name).rglob("*") if path.is_file()}
        result = self.observe()
        self.assertTrue(result["allowed"])
        self.assertEqual(result["reason"], "MONITOR_CUSTODY_RELEASED")
        self.assertEqual(self.process_observations, 1)
        self.assertEqual(before, {str(path): path.read_bytes() for path in Path(self.temporary.name).rglob("*") if path.is_file()})

    def test_incomplete_or_falsey_child_custody_never_releases(self):
        outer, starter, restore = self.completed_records()
        for value in ({}, [], False, 0, "", {"role": "start"}):
            with self.subTest(value=value), self.assertRaises(b.ProtocolError):
                b.validate_released_custody(self.core, self.helper, {**outer, "activeChild": value}, starter, restore)
        for change in ({"cleanupComplete": 1}, {"captureAttempted": 1}, {"saveLoadedConfirmed": 1},
                       {"stage": "STEAM_LAUNCH_INTENT"}, {"runnerSha256": "0" * 64},
                       {"childCalls": [{"id": "c" * 32, "role": "start", "state": "UNRESOLVED"}]}):
            with self.subTest(change=change), self.assertRaises(b.ProtocolError):
                b.validate_released_custody(self.core, self.helper, {**outer, **change}, starter, restore)

    def test_delayed_steam_launch_cannot_be_reclassified_as_completed_cleanup(self):
        outer, starter, restore = self.completed_records()
        starter.update(stage="LAUNCH_UNRESOLVED_PROXY_PRESERVED", process=None)
        with self.assertRaises(b.ProtocolError):
            b.validate_released_custody(self.core, self.helper, outer, starter, restore)

    def test_starter_identity_and_typed_exit_restore_evidence_are_required(self):
        outer, starter, restore = self.completed_records()
        for change in ({"proxyRestored": 1}, {"gameExitObserved": 1}, {"launchRequested": 1},
                       {"sessionId": "f" * 32}, {"workspace": "another-workspace"}):
            with self.subTest(change=change), self.assertRaises(b.ProtocolError):
                b.validate_released_custody(self.core, self.helper, outer, {**starter, **change}, restore)
        for change in ({"stage": "isolated"}, {"sourceSha256": "0" * 64}, {"heldSha256": "0" * 64}):
            with self.subTest(change=change), self.assertRaises(b.ProtocolError):
                b.validate_released_custody(self.core, self.helper, outer, starter, {**restore, **change})
        without_held_evidence = {key: value for key, value in restore.items() if key != "heldSha256"}
        with self.assertRaises(b.ProtocolError):
            b.validate_released_custody(self.core, self.helper, outer, starter, without_held_evidence)

    def test_current_game_blocks_even_when_old_cleanup_records_are_valid(self):
        self.completed_records()
        self.games = [dict(fixtures.PROCESS)]
        with self.assertRaisesRegex(b.ProtocolError, "STILL_PRESENT"):
            self.observe()

    def test_records_changing_during_process_observation_are_not_accepted(self):
        self.completed_records()
        self.on_games = lambda: self.paths["outerLock"].write_bytes(b"new owner")
        with self.assertRaisesRegex(b.ProtocolError, "CHANGED_DURING"):
            self.observe()

    def test_completed_starter_without_outer_wrapper_can_release_its_original_custody(self):
        self.completed_records()
        self.paths["outer"].unlink()
        self.assertTrue(self.observe()["allowed"])

    def test_no_start_cleanup_requires_no_start_or_load_child(self):
        outer, _starter, _restore = self.completed_records()
        self.paths["starter"].unlink()
        outer.update(starterSessionId=None, process=None, captureAttempted=False, saveLoadedConfirmed=False,
                     cleanupReceipt={"stage": "NO_STARTER_SESSION_NO_GAME_PROXY_RESTORED", "proxyRestored": True})
        self.write("outer", outer)
        self.assertTrue(self.observe()["allowed"])
        outer["childCalls"] = [{"id": "c" * 32, "role": "start", "state": "RETURNED"}]
        self.write("outer", outer)
        with self.assertRaisesRegex(b.ProtocolError, "STARTER_CUSTODY_MISSING"):
            self.observe()

    def test_invocation_marker_must_belong_to_completed_run_and_game(self):
        outer, _starter, _restore = self.completed_records()
        self.write("stockMarker", {"runId": outer["runId"], "pid": fixtures.PROCESS["pid"] + 1,
                                   "createdFileTime": fixtures.PROCESS["createdFileTime"]})
        with self.assertRaisesRegex(b.ProtocolError, "INVOCATION_CUSTODY_MISMATCH"):
            self.observe()


if __name__ == "__main__":
    unittest.main()
