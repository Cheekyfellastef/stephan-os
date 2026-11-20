"""Actual Windows Job tests; Linux discovery only checks portable contracts.

Tests retain independent native handles for the harmless fixture root and its
descendant. A returned receipt alone is never the process-exclusion assertion.
"""

import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).with_name("owned_job.py")
FIXTURE = Path(__file__).with_name("owned_job_fixture.py")
SPEC = importlib.util.spec_from_file_location("starfield_owned_job_under_test", SOURCE)
owned_job = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(owned_job)


class PortableContractTests(unittest.TestCase):
    def inputs(self, **changes):
        values = dict(executable=r"C:\Windows\System32\cmd.exe", args=["/d"],
                      cwd=r"C:\fixed", env={"SystemRoot": r"C:\Windows"},
                      deadline_monotonic=time.monotonic() + 10, output_limit=8192,
                      parent_pid=123, parent_birth_filetime="133000000000000000")
        values.update(changes)
        return values

    def test_fixed_input_bounds_and_case_insensitive_environment(self):
        invalid = [
            {"executable": "cmd.exe"}, {"cwd": "relative"}, {"args": "caller command"},
            {"env": {"PATH": "one", "Path": "two"}}, {"env": {"=C:": "anything"}},
            {"output_limit": True}, {"output_limit": owned_job.MAX_OUTPUT_BYTES + 1},
            {"deadline_monotonic": float("nan")},
            {"deadline_monotonic": time.monotonic() + 700},
            {"parent_pid": True}, {"parent_birth_filetime": None},
            {"parent_birth_filetime": "9" * 21},
        ]
        for change in invalid:
            with self.subTest(change=change), self.assertRaises(ValueError):
                owned_job._validate_inputs(**self.inputs(**change))

    def test_filetime_is_exact_integer_not_float(self):
        birth = "133000000000000001"
        self.assertEqual(owned_job._validate_inputs(**self.inputs(parent_birth_filetime=birth)), int(birth))
        with self.assertRaises(ValueError):
            owned_job._validate_inputs(**self.inputs(parent_birth_filetime=float(birth)))

    def test_untrusted_helper_policy_refuses_before_any_native_call(self):
        for value in (True, {}, {"image": "vctip.exe"}, "pinned-msvc-telemetry-v1", lambda: True):
            with self.subTest(value=type(value).__name__), self.assertRaisesRegex(ValueError, "COMPLETED_HELPER_PIN_UNPROVEN"):
                owned_job.run_owned_stage(**self.inputs(), completed_helper=value)

    def test_windows_x64_structures_have_expected_abi_sizes(self):
        if ctypes.sizeof(ctypes.c_void_p) != 8:
            self.skipTest("x64 layout check")
        self.assertEqual(ctypes.sizeof(owned_job._STARTUPINFO), 104)
        self.assertEqual(ctypes.sizeof(owned_job._STARTUPINFOEX), 112)
        self.assertEqual(ctypes.sizeof(owned_job._PROCESS_INFORMATION), 24)
        self.assertEqual(ctypes.sizeof(owned_job._BASIC_LIMIT), 64)
        self.assertEqual(ctypes.sizeof(owned_job._EXTENDED_LIMIT), 144)
        self.assertEqual(ctypes.sizeof(owned_job._ACCOUNTING), 48)

    @unittest.skipIf(os.name == "nt", "non-Windows boundary")
    def test_non_windows_cannot_claim_native_execution(self):
        with self.assertRaisesRegex(OSError, "REQUIRES_64_BIT_WINDOWS"):
            owned_job.run_owned_stage(**self.inputs())


class NativeObserver:
    """Independent retained handles; does not consume the runner's zero flag."""

    def __init__(self):
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int32, ctypes.c_uint32]
        self.kernel.OpenProcess.restype = ctypes.c_void_p
        self.kernel.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(owned_job._FILETIME)] * 4
        self.kernel.GetProcessTimes.restype = ctypes.c_int32
        self.kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        self.kernel.WaitForSingleObject.restype = ctypes.c_uint32
        self.kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        self.kernel.GetExitCodeProcess.restype = ctypes.c_int32
        self.kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        self.kernel.CloseHandle.restype = ctypes.c_int32
        self.handles = []

    def capture(self, pid, expected_birth=None):
        handle = self.kernel.OpenProcess(0x1000 | 0x00100000, False, pid)
        if not handle:
            raise OSError(ctypes.get_last_error())
        self.handles.append(handle)
        values = [owned_job._FILETIME() for _ in range(4)]
        if not self.kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in values)):
            raise OSError(ctypes.get_last_error())
        birth = str((values[0].high << 32) | values[0].low)
        if expected_birth is not None and birth != str(expected_birth):
            raise AssertionError("Observer captured the wrong process birth")
        return handle, birth

    def exit(self, handle, timeout=5000):
        if self.kernel.WaitForSingleObject(handle, timeout) != 0:
            raise AssertionError("Owned fixture is still executable or its wait is unproved")
        code = ctypes.c_uint32()
        if not self.kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
            raise OSError(ctypes.get_last_error())
        return code.value

    def close(self):
        for handle in self.handles:
            self.kernel.CloseHandle(handle)
        self.handles.clear()


@unittest.skipUnless(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8, "actual 64-bit Windows required")
class WindowsOwnedJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="starfield-owned-job-fixture-")
        self.root = Path(self.temp.name)
        self.observer = NativeObserver()
        _, self.parent_birth = self.observer.capture(os.getpid())
        self.root_handle = None
        self.witness = self.root / "root.json"
        self.descendant = self.root / "descendant.json"
        self.ack = self.root / "continue"

    def tearDown(self):
        self.observer.close()
        self.temp.cleanup()

    def environment(self):
        values = {key.upper(): value for key, value in os.environ.items()
                  if key.upper() in {"SYSTEMROOT", "WINDIR"}}
        values.update(TEMP=str(self.root), TMP=str(self.root),
                      PATH=str(Path(sys.executable).parent) + ";" + str(Path(values["SYSTEMROOT"]) / "System32"))
        return values

    def bound(self, proof):
        self.assertFalse(self.witness.exists(), "Fixture executed before the suspended binding callback")
        self.assertTrue(proof["assigned_before_execution"])
        self.root_handle, _ = self.observer.capture(proof["root_pid"], proof["root_created_filetime"])
        self.assertEqual(self.observer.kernel.WaitForSingleObject(self.root_handle, 0), 258)
        return True

    def run_stage(self, mode="normal", **changes):
        values = dict(executable=sys.executable,
                      args=["-I", "-S", "-B", str(FIXTURE.resolve()), mode, str(self.witness),
                            str(self.ack), str(self.descendant)],
                      cwd=str(self.root), env=self.environment(), deadline_monotonic=time.monotonic() + 10,
                      output_limit=8192, parent_pid=os.getpid(), parent_birth_filetime=self.parent_birth,
                      on_suspended=self.bound)
        values.update(changes)
        return owned_job.run_owned_stage(**values)

    def wait_json(self, path, timeout=8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
            time.sleep(0.01)
        self.fail("Disposable fixture did not publish its atomic witness")

    def assert_excluded(self, result):
        self.assertTrue(result["zero_active_processes_observed"], result)
        self.assertEqual(result["active_processes"], 0, result)
        self.assertTrue(result["root_exited"], result)
        self.assertTrue(result["custody_released"], result)
        self.assertEqual(self.observer.exit(self.root_handle), result["root_exit_code"])

    def test_normal_zero_exit_and_complete_private_output(self):
        result = self.run_stage()
        self.assertTrue(result["operation_ok"], result)
        self.assertEqual(result["root_exit_code"], 0)
        self.assert_excluded(result)
        self.assertTrue(result["output_complete"])
        raw = base64.b64decode(result["output_base64"], validate=True)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), result["output_sha256"])
        self.assertEqual(len(raw), result["output_captured_bytes"])
        self.assertIn(b"owned-job-normal", raw)

    def test_running_permission_cannot_bypass_first_prelaunch_refusal(self):
        running_calls = []
        result = self.run_stage(cancel_requested=lambda: True,
            running_cancel_requested=lambda: running_calls.append(True) or False)
        self.assertTrue(result["cancelled"], result)
        self.assertFalse(result["root_created"])
        self.assertFalse(result["resume_confirmed"])
        self.assertTrue(result["prelaunch_excluded"])
        self.assertEqual(running_calls, [])
        self.assertFalse(self.witness.exists())

    def test_suspended_root_still_requires_ordinary_admission_before_resume(self):
        suspended = [False];running_calls = []
        def bind(proof):
            self.bound(proof);suspended[0] = True
            return True
        result = self.run_stage(cancel_requested=lambda: suspended[0], on_suspended=bind,
            running_cancel_requested=lambda: running_calls.append(True) or False)
        self.assertTrue(result["cancelled"], result)
        self.assertTrue(result["root_created"])
        self.assertFalse(result["resume_confirmed"])
        self.assertEqual(running_calls, [])
        self.assertFalse(self.witness.exists(), "Suspended fixture executed despite ordinary admission refusal")
        self.assert_excluded(result)

    def test_running_policy_is_selected_only_after_native_resume_confirmation(self):
        ordinary = [];running = []
        def before():
            ordinary.append(True)
            return len(ordinary) > 3  # ordinary policy would withdraw after resume
        result = self.run_stage(cancel_requested=before,
            running_cancel_requested=lambda: running.append(True) or False)
        self.assertTrue(result["operation_ok"], result)
        self.assertTrue(result["resume_confirmed"])
        self.assertEqual(len(ordinary), 3)
        self.assertGreater(len(running), 0)
        self.assert_excluded(result)

    def test_nonzero_exit_is_preserved_despite_job_zero(self):
        result = self.run_stage("failed")
        self.assertFalse(result["operation_ok"])
        self.assertEqual(result["root_exit_code"], 37)
        self.assertIn("ROOT_EXIT_NONZERO", result["failures"])
        self.assert_excluded(result)

    def test_signaled_root_waits_for_transient_job_accounting(self):
        real = owned_job._Win32
        observed = {"lagged": 0}

        def with_accounting_lag():
            api = real()
            query = api.k.QueryInformationJobObject

            def lag_after_actual_exit(*args):
                ok = query(*args)
                accounting = ctypes.cast(args[2], ctypes.POINTER(owned_job._ACCOUNTING)).contents
                if (ok and accounting.active_processes == 0 and self.root_handle
                        and self.observer.kernel.WaitForSingleObject(self.root_handle, 0) == 0
                        and observed["lagged"] < 3):
                    accounting.active_processes = 1
                    observed["lagged"] += 1
                return ok

            api.k.QueryInformationJobObject = lag_after_actual_exit
            return api

        with patch.object(owned_job, "_Win32", side_effect=with_accounting_lag):
            result = self.run_stage()
        self.assertEqual(observed["lagged"], 3)
        self.assertTrue(result["operation_ok"], result)
        self.assertFalse(result["termination_requested"], result)
        self.assertEqual(result["root_exit_code"], 0)
        self.assert_excluded(result)

    def test_deadline_terminates_only_owned_fixture_and_proves_zero(self):
        result = self.run_stage("sleep", deadline_monotonic=time.monotonic() + 1.5)
        self.assertFalse(result["operation_ok"])
        self.assertTrue(result["timed_out"])
        self.assertTrue(result["termination_requested"])
        self.assert_excluded(result)

    def test_root_exit_cannot_release_a_live_descendant_or_held_pipe(self):
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.run_stage, "orphan")
            child = self.wait_json(self.descendant)
            child_handle, _ = self.observer.capture(child["pid"], child["birth"])
            self.ack.write_text("ack", encoding="ascii")
            result = future.result(timeout=15)
        self.assertFalse(result["operation_ok"])
        self.assertEqual(result["root_exit_code"], 0)
        self.assertIn("ROOT_EXITED_WITH_LIVE_DESCENDANTS", result["failures"])
        self.assertTrue(result["termination_requested"])
        self.assert_excluded(result)
        self.observer.exit(child_handle)
        self.assertTrue(result["output_complete"], result)

    def helper_fixture(self, fault=None):
        # Only this test substitutes the harmless Python fixture for the exact
        # source-qualified MSVC binary. Production accepts no supplied path/hash.
        spec = importlib.util.spec_from_file_location("helper_native_pins", SOURCE.with_name("native_build.py"))
        build = importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
        pins = build.NativePins()
        image = str(Path(sys.executable).resolve())
        if fault == "foreign_image":
            foreign = self.root / "unexecuted-helper.exe"
            foreign.write_bytes(Path(image).read_bytes())
            image = str(foreign)
        real_api = owned_job._Win32
        retired = [False]
        def fault_api():
            api = real_api()
            query, terminate = api.k.QueryInformationJobObject, api.k.TerminateJobObject
            def terminate_observed(*args):
                retired[0] = True
                return terminate(*args)
            def query_observed(*args):
                ok = query(*args)
                if ok and args[1] == 1 and retired[0] and fault == "new_member":
                    ctypes.cast(args[2], ctypes.POINTER(owned_job._ACCOUNTING)).contents.total_processes += 1
                if ok and args[1] == 3 and fault == "extra_member":
                    ctypes.cast(args[2], ctypes.POINTER(owned_job._JOB_PROCESS_IDS)).contents.assigned = 2
                if args[1] == 3 and fault == "membership_failure":return 0
                return ok
            api.k.QueryInformationJobObject = query_observed
            api.k.TerminateJobObject = terminate_observed
            return api
        try:
            with ExitStack() as stack:
                stack.enter_context(patch.object(owned_job, "COMPLETED_HELPER_IMAGE", image))
                stack.enter_context(patch.object(owned_job, "COMPLETED_HELPER_SHA256", hashlib.sha256(Path(image).read_bytes()).hexdigest()))
                helper = owned_job.pin_completed_toolchain_helper(pins)
                stack.enter_context(patch.object(owned_job, "_Win32", side_effect=fault_api))
                cancelled = threading.Event()
                with ThreadPoolExecutor(max_workers=1) as pool:
                    mode = {"two_members":"two-orphans", "root_failure":"orphan-failed"}.get(fault, "orphan")
                    future = pool.submit(self.run_stage, mode, completed_helper=helper,
                        cancel_requested=cancelled.is_set)
                    child = self.wait_json(self.descendant)
                    child_handle, _ = self.observer.capture(child["pid"], child["birth"])
                    second_handle = None
                    if fault == "two_members":
                        second = self.wait_json(Path(str(self.descendant) + ".second"))
                        second_handle, _ = self.observer.capture(second["pid"], second["birth"])
                    if fault == "closed_pin":pins.close()
                    if fault == "cancel":cancelled.set()
                    self.ack.write_text("ack", encoding="ascii")
                    result = future.result(timeout=15)
                self.assert_excluded(result)
                self.observer.exit(child_handle)
                if second_handle:self.observer.exit(second_handle)
                self.assertTrue(result["output_complete"], result)
                return result
        finally:
            pins.close()

    def test_pinned_sole_helper_retirement_requires_native_zero_and_complete_output(self):
        result = self.helper_fixture()
        self.assertTrue(result["operation_ok"], result)
        self.assertTrue(result["termination_requested"])
        self.assertEqual(result["root_exit_code"], 0)
        self.assertTrue(result["completed_helper_retirement"]["sole_native_job_member_observed"])

    def test_unknown_image_extra_member_closed_pin_and_unknown_membership_refuse_retirement(self):
        for fault in ("foreign_image", "extra_member", "closed_pin", "membership_failure", "two_members", "root_failure"):
            with self.subTest(fault=fault):
                # Each real fixture needs fresh witness names and independent handles.
                directory = self.root / fault;directory.mkdir()
                self.witness = directory / "root.json";self.descendant = directory / "child.json";self.ack = directory / "ack"
                result = self.helper_fixture(fault)
                self.assertFalse(result["operation_ok"], result)
                self.assertIsNone(result["completed_helper_retirement"])

    def test_helper_retirement_cannot_erase_cancellation_or_process_set_growth(self):
        for fault in ("cancel", "new_member"):
            with self.subTest(fault=fault):
                directory = self.root / fault;directory.mkdir()
                self.witness = directory / "root.json";self.descendant = directory / "child.json";self.ack = directory / "ack"
                result = self.helper_fixture(fault)
                self.assertFalse(result["operation_ok"], result)
                if fault == "cancel":
                    self.assertTrue(result["cancelled"])
                    self.assertIsNone(result["completed_helper_retirement"])
                else:
                    self.assertIn("HELPER_RETIREMENT_PROCESS_SET_CHANGED", result["failures"])

    def test_output_overflow_is_bounded_and_never_complete(self):
        result = self.run_stage("overflow", output_limit=4096)
        self.assertFalse(result["operation_ok"])
        self.assertTrue(result["output_overflow"])
        self.assertFalse(result["output_complete"])
        self.assertEqual(result["output_captured_bytes"], 4096)
        self.assert_excluded(result)

    def test_cancel_after_actual_child_pickup(self):
        cancel = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.run_stage, "sleep", cancel_requested=cancel.is_set)
            self.wait_json(self.witness)
            cancel.set()
            result = future.result(timeout=15)
        self.assertFalse(result["operation_ok"])
        self.assertTrue(result["cancelled"])
        self.assertIn("CANCELLED", result["failures"])
        self.assert_excluded(result)

    def test_exact_parent_death_cancels_owned_job(self):
        parent_witness = self.root / "parent.json"
        parent = subprocess.Popen([sys.executable, "-I", "-S", "-B", str(FIXTURE.resolve()),
                                   "parent", str(parent_witness), str(self.ack), str(self.descendant)],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  env=self.environment())
        try:
            identity = self.wait_json(parent_witness)
            self.observer.capture(identity["pid"], identity["birth"])
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.run_stage, "sleep", parent_pid=parent.pid,
                                     parent_birth_filetime=identity["birth"])
                self.wait_json(self.witness)
                parent.terminate()
                parent.wait(timeout=5)
                result = future.result(timeout=15)
            self.assertFalse(result["operation_ok"])
            self.assertFalse(result["parent_alive_at_completion"])
            self.assertIn("PARENT_ENDED_OR_UNPROVEN", result["failures"])
            self.assert_excluded(result)
        finally:
            if parent.poll() is None:
                parent.terminate()
            parent.wait(timeout=5)

    def test_wrong_parent_birth_refuses_before_any_child(self):
        result = self.run_stage(parent_birth_filetime=str(int(self.parent_birth) + 1))
        self.assertFalse(result["launch_attempted"])
        self.assertFalse(result["root_created"])
        self.assertIsNone(result["root_exit_code"])
        self.assertTrue(result["prelaunch_excluded"])
        self.assertIn("PARENT_IDENTITY_MISMATCH", result["failures"])
        self.assertFalse(self.witness.exists())
        self.assertFalse(owned_job.observe_parent_identity(os.getpid(), str(int(self.parent_birth) + 1))["ok"])
        self.assertTrue(owned_job.observe_parent_identity(os.getpid(), self.parent_birth)["ok"])

    def test_binding_refusal_terminates_suspended_child_before_fixture_executes(self):
        def refuse(proof):
            self.bound(proof)
            with self.assertRaises(TypeError):
                proof["root_pid"] = 1
            return False
        result = self.run_stage(on_suspended=refuse)
        self.assertFalse(result["resume_confirmed"])
        self.assertFalse(result["operation_ok"])
        self.assertIn("PARENT_BINDING_REFUSED", result["failures"])
        self.assertFalse(self.witness.exists())
        self.assert_excluded(result)

    def test_job_query_failure_cannot_heal_into_custody_release(self):
        real = owned_job._Win32
        def with_query_failure():
            api = real()
            query = api.k.QueryInformationJobObject
            first = True
            def fail_once(*args):
                nonlocal first
                if first:
                    first = False
                    ctypes.set_last_error(5)
                    return False
                return query(*args)
            api.k.QueryInformationJobObject = fail_once
            return api
        with patch.object(owned_job, "_Win32", side_effect=with_query_failure):
            result = self.run_stage("sleep")
        self.assertFalse(result["operation_ok"])
        self.assertFalse(result["custody_released"])
        self.assertEqual(result["custody_error"], "JOB_ACCOUNTING_UNPROVEN")
        self.assertTrue(result["zero_active_processes_observed"])
        self.observer.exit(self.root_handle)

    def test_unknown_exit_code_stays_null_and_failed(self):
        real = owned_job._Win32
        def with_exit_failure():
            api = real()
            def fail_exit(*args):
                ctypes.set_last_error(5)
                return False
            api.k.GetExitCodeProcess = fail_exit
            return api
        with patch.object(owned_job, "_Win32", side_effect=with_exit_failure):
            result = self.run_stage()
        self.assertFalse(result["operation_ok"])
        self.assertIsNone(result["root_exit_code"])
        self.assertFalse(result["custody_released"])
        self.assertEqual(result["custody_error"], "ROOT_EXIT_CODE_UNPROVEN")
        self.assertEqual(self.observer.exit(self.root_handle), 0)

    def test_launcher_death_closes_noninherited_job_handle(self):
        launcher = subprocess.Popen(
            [sys.executable, "-I", "-S", "-B", str(FIXTURE.resolve()), "launcher", str(self.witness),
             str(self.ack), str(self.descendant), str(os.getpid()), self.parent_birth],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env=self.environment())
        try:
            root = self.wait_json(self.witness)
            child = self.wait_json(self.descendant)
            root_handle, _ = self.observer.capture(root["pid"], root["birth"])
            child_handle, _ = self.observer.capture(child["pid"], child["birth"])
            launcher.terminate()
            launcher.wait(timeout=5)
            self.observer.exit(root_handle)
            self.observer.exit(child_handle)
            # Death containment is physical evidence for the test. It cannot
            # manufacture a terminal receipt or release the caller's journal.
            self.assertFalse(Path(str(self.witness) + ".terminal.json").exists())
        finally:
            if launcher.poll() is None:
                launcher.terminate()
            launcher.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
