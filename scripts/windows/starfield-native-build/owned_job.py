"""Internal Windows process-tree boundary for the fixed Starfield build recipe.

There is deliberately no command-line entry point.  The reviewed recipe owns
all executable, argument, directory, environment and budget values.  This
module grants no source lease, runtime installation or game-launch authority.
The caller must retain its existing custody when native exclusion is unproved.

The Job is assigned during CreateProcessW, before the suspended child can run.
No compiler, Add-Type, package, service, process-tree kill or bootstrap binary is
needed to create this boundary: only Python's standard-library ctypes is used.
"""

from __future__ import annotations

import base64
import ctypes
import hashlib
import math
import ntpath
import os
import subprocess
import time
from types import MappingProxyType
from typing import Callable, Mapping, Sequence


SCHEMA = "stephanos.starfield-native-build.owned-stage.v1"
MAX_STAGE_SECONDS = 600.0
MAX_OUTPUT_BYTES = 1024 * 1024
DRAIN_SECONDS = 5.0
ROOT_EXIT_ACCOUNTING_SECONDS = 1.0
PROCESS_LIMIT = 16
POLL_SECONDS = 0.01

DWORD = ctypes.c_uint32
WORD = ctypes.c_uint16
BOOL = ctypes.c_int32
HANDLE = ctypes.c_void_p
SIZE_T = ctypes.c_size_t
ULONG_PTR = ctypes.c_size_t
LPVOID = ctypes.c_void_p

WAIT_OBJECT_0 = 0
WAIT_TIMEOUT = 258
ERROR_BROKEN_PIPE = 109
ERROR_INSUFFICIENT_BUFFER = 122
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SYNCHRONIZE = 0x00100000
HANDLE_FLAG_INHERIT = 1
JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8
JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x20002
PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x2000D
CREATE_SUSPENDED = 0x4
CREATE_UNICODE_ENVIRONMENT = 0x400
EXTENDED_STARTUPINFO_PRESENT = 0x80000
CREATE_NO_WINDOW = 0x08000000
STARTF_USESTDHANDLES = 0x100


class _FILETIME(ctypes.Structure):
    _fields_ = [("low", DWORD), ("high", DWORD)]


class _SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("length", DWORD), ("descriptor", LPVOID), ("inherit", BOOL)]


class _STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ("cb", DWORD), ("reserved", LPVOID), ("desktop", LPVOID), ("title", LPVOID),
        ("x", DWORD), ("y", DWORD), ("x_size", DWORD), ("y_size", DWORD),
        ("x_chars", DWORD), ("y_chars", DWORD), ("fill", DWORD), ("flags", DWORD),
        ("show", WORD), ("reserved_size", WORD), ("reserved_bytes", LPVOID),
        ("stdin", HANDLE), ("stdout", HANDLE), ("stderr", HANDLE),
    ]


class _STARTUPINFOEX(ctypes.Structure):
    _fields_ = [("startup", _STARTUPINFO), ("attributes", LPVOID)]


class _PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [("process", HANDLE), ("thread", HANDLE), ("pid", DWORD), ("tid", DWORD)]


class _BASIC_LIMIT(ctypes.Structure):
    _fields_ = [
        ("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
        ("flags", DWORD), ("minimum_working", SIZE_T), ("maximum_working", SIZE_T),
        ("active_limit", DWORD), ("affinity", ULONG_PTR), ("priority", DWORD),
        ("scheduling", DWORD),
    ]


class _IO_COUNTERS(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in (
        "read_operations", "write_operations", "other_operations",
        "read_bytes", "write_bytes", "other_bytes",
    )]


class _EXTENDED_LIMIT(ctypes.Structure):
    _fields_ = [
        ("basic", _BASIC_LIMIT), ("io", _IO_COUNTERS), ("process_memory", SIZE_T),
        ("job_memory", SIZE_T), ("peak_process_memory", SIZE_T), ("peak_job_memory", SIZE_T),
    ]


class _ACCOUNTING(ctypes.Structure):
    _fields_ = [
        ("user_time", ctypes.c_int64), ("kernel_time", ctypes.c_int64),
        ("period_user_time", ctypes.c_int64), ("period_kernel_time", ctypes.c_int64),
        ("page_faults", DWORD), ("total_processes", DWORD), ("active_processes", DWORD),
        ("terminated_processes", DWORD),
    ]


class _NativeFailure(Exception):
    def __init__(self, code: str, winerror: int | None = None):
        super().__init__(code)
        self.code = code
        self.winerror = winerror


class _Win32:
    """Explicit signatures avoid ctypes' default 32-bit handle truncation."""

    def __init__(self):
        if os.name != "nt" or ctypes.sizeof(HANDLE) != 8:
            raise OSError("OWNED_JOB_REQUIRES_64_BIT_WINDOWS")
        import sys
        if sys.getwindowsversion().major < 10:
            raise OSError("OWNED_JOB_REQUIRES_WINDOWS_10_OR_LATER")
        self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        signatures = {
            "CreateJobObjectW": (HANDLE, [LPVOID, ctypes.c_wchar_p]),
            "SetInformationJobObject": (BOOL, [HANDLE, ctypes.c_int, LPVOID, DWORD]),
            "QueryInformationJobObject": (BOOL, [HANDLE, ctypes.c_int, LPVOID, DWORD, LPVOID]),
            "TerminateJobObject": (BOOL, [HANDLE, DWORD]),
            "SetHandleInformation": (BOOL, [HANDLE, DWORD, DWORD]),
            "GetHandleInformation": (BOOL, [HANDLE, ctypes.POINTER(DWORD)]),
            "CreatePipe": (BOOL, [ctypes.POINTER(HANDLE), ctypes.POINTER(HANDLE),
                                  ctypes.POINTER(_SECURITY_ATTRIBUTES), DWORD]),
            "CreateFileW": (HANDLE, [ctypes.c_wchar_p, DWORD, DWORD, LPVOID, DWORD, DWORD, HANDLE]),
            "InitializeProcThreadAttributeList": (BOOL, [LPVOID, DWORD, DWORD, ctypes.POINTER(SIZE_T)]),
            "UpdateProcThreadAttribute": (BOOL, [LPVOID, DWORD, SIZE_T, LPVOID, SIZE_T, LPVOID, LPVOID]),
            "DeleteProcThreadAttributeList": (None, [LPVOID]),
            "CreateProcessW": (BOOL, [ctypes.c_wchar_p, ctypes.c_wchar_p, LPVOID, LPVOID,
                                      BOOL, DWORD, LPVOID, ctypes.c_wchar_p,
                                      ctypes.POINTER(_STARTUPINFOEX), ctypes.POINTER(_PROCESS_INFORMATION)]),
            "IsProcessInJob": (BOOL, [HANDLE, HANDLE, ctypes.POINTER(BOOL)]),
            "OpenProcess": (HANDLE, [DWORD, BOOL, DWORD]),
            "GetProcessId": (DWORD, [HANDLE]),
            "GetProcessTimes": (BOOL, [HANDLE, ctypes.POINTER(_FILETIME), ctypes.POINTER(_FILETIME),
                                       ctypes.POINTER(_FILETIME), ctypes.POINTER(_FILETIME)]),
            "QueryFullProcessImageNameW": (BOOL, [HANDLE, DWORD, ctypes.c_wchar_p, ctypes.POINTER(DWORD)]),
            "WaitForSingleObject": (DWORD, [HANDLE, DWORD]),
            "GetExitCodeProcess": (BOOL, [HANDLE, ctypes.POINTER(DWORD)]),
            "ResumeThread": (DWORD, [HANDLE]),
            "PeekNamedPipe": (BOOL, [HANDLE, LPVOID, DWORD, LPVOID, ctypes.POINTER(DWORD), LPVOID]),
            "ReadFile": (BOOL, [HANDLE, LPVOID, DWORD, ctypes.POINTER(DWORD), LPVOID]),
            "CloseHandle": (BOOL, [HANDLE]),
        }
        for name, (restype, argtypes) in signatures.items():
            function = getattr(self.k, name)
            function.restype = restype
            function.argtypes = argtypes

    @staticmethod
    def require(value, code):
        if not value:
            raise _NativeFailure(code, ctypes.get_last_error())

    def birth(self, process) -> int:
        created, exited, kernel, user = (_FILETIME() for _ in range(4))
        self.require(self.k.GetProcessTimes(process, ctypes.byref(created), ctypes.byref(exited),
                                            ctypes.byref(kernel), ctypes.byref(user)), "PROCESS_BIRTH_UNPROVEN")
        return (int(created.high) << 32) | int(created.low)

    def image(self, process) -> str:
        size = DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        self.require(self.k.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)),
                     "PROCESS_IMAGE_UNPROVEN")
        return buffer.value


def _parent_birth_input(parent_pid, parent_birth_filetime):
    if type(parent_pid) is not int or not 0 < parent_pid <= 0xFFFFFFFF:
        raise ValueError("OWNED_STAGE_PARENT_IDENTITY_INVALID")
    if isinstance(parent_birth_filetime, str):
        if (not 1 <= len(parent_birth_filetime) <= 20 or not parent_birth_filetime.isascii()
                or not parent_birth_filetime.isdecimal()):
            raise ValueError("OWNED_STAGE_PARENT_IDENTITY_INVALID")
        parent_birth_filetime = int(parent_birth_filetime)
    if type(parent_birth_filetime) is not int or not 0 < parent_birth_filetime <= 0xFFFFFFFFFFFFFFFF:
        raise ValueError("OWNED_STAGE_PARENT_IDENTITY_INVALID")
    return parent_birth_filetime


def observe_parent_identity(parent_pid: int, parent_birth_filetime: int | str) -> dict:
    """Read-only, fresh exact-birth check for pre-staging/inter-stage admission.

    This observation grants no lease and does not replace run_owned_stage's
    retained parent handle.  An exited or recycled PID never reports alive.
    """
    parent_birth_filetime = _parent_birth_input(parent_pid, parent_birth_filetime)
    result = {"ok": False, "reason": "PARENT_IDENTITY_UNPROVEN", "pid": parent_pid,
              "created_filetime": None, "alive": False}
    api = _Win32()
    handle = None
    try:
        handle = api.k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, parent_pid)
        api.require(handle, "PARENT_OPEN_UNPROVEN")
        result["created_filetime"] = str(api.birth(handle))
        if api.k.GetProcessId(handle) != parent_pid or int(result["created_filetime"]) != parent_birth_filetime:
            raise _NativeFailure("PARENT_IDENTITY_MISMATCH")
        state = api.k.WaitForSingleObject(handle, 0)
        if state != WAIT_TIMEOUT:
            raise _NativeFailure("PARENT_ENDED" if state == WAIT_OBJECT_0 else "PARENT_STATE_UNPROVEN")
        result.update(ok=True, reason="PARENT_IDENTITY_LIVE", alive=True)
    except _NativeFailure as error:
        result["reason"] = error.code
    finally:
        if handle and not api.k.CloseHandle(handle):
            result.update(ok=False, reason="PARENT_HANDLE_CLOSE_FAILED", alive=False)
    return result


def _validate_inputs(executable, args, cwd, env, deadline_monotonic, output_limit,
                     parent_pid, parent_birth_filetime):
    if (not isinstance(executable, str) or not ntpath.isabs(executable)
            or not isinstance(cwd, str) or not ntpath.isabs(cwd)
            or any(char in executable + cwd for char in "\0\r\n")):
        raise ValueError("OWNED_STAGE_FIXED_ABSOLUTE_PATHS_REQUIRED")
    if (not isinstance(args, (list, tuple)) or len(args) > 64
            or any(not isinstance(arg, str) or "\0" in arg for arg in args)
            or sum(len(arg) for arg in args) > 24000):
        raise ValueError("OWNED_STAGE_ARGUMENTS_INVALID")
    if not isinstance(env, Mapping) or not env or len(env) > 128:
        raise ValueError("OWNED_STAGE_ENVIRONMENT_INVALID")
    seen = set()
    for key, value in env.items():
        if (not isinstance(key, str) or not key or any(char in key for char in "=\0\r\n")
                or not isinstance(value, str) or "\0" in value or key.upper() in seen):
            raise ValueError("OWNED_STAGE_ENVIRONMENT_INVALID")
        seen.add(key.upper())
    if sum(len(key) + len(value) + 2 for key, value in env.items()) > 24000:
        raise ValueError("OWNED_STAGE_ENVIRONMENT_TOO_LARGE")
    if (isinstance(deadline_monotonic, bool) or not isinstance(deadline_monotonic, (int, float))
            or not math.isfinite(deadline_monotonic)
            or deadline_monotonic - time.monotonic() > MAX_STAGE_SECONDS):
        raise ValueError("OWNED_STAGE_DEADLINE_INVALID")
    if type(output_limit) is not int or not 1 <= output_limit <= MAX_OUTPUT_BYTES:
        raise ValueError("OWNED_STAGE_OUTPUT_LIMIT_INVALID")
    return _parent_birth_input(parent_pid, parent_birth_filetime)


def run_owned_stage(*, executable: str, args: Sequence[str], cwd: str,
                    env: Mapping[str, str], deadline_monotonic: float, output_limit: int,
                    parent_pid: int, parent_birth_filetime: int | str,
                    cancel_requested: Callable[[], bool] | None = None,
                    running_cancel_requested: Callable[[], bool] | None = None,
                    on_suspended: Callable[[Mapping], bool] | None = None) -> dict:
    """Execute one internally selected stage; never call with public input.

    The deadline is an absolute monotonic time within the caller's aggregate
    budget.  on_suspended may durably bind the real child identity before resume;
    when supplied, only a literal True acknowledges that binding.  Callback
    exceptions refuse execution.  No callback or child JSON can grant Job zero.
    """
    parent_birth_filetime = _validate_inputs(
        executable, args, cwd, env, deadline_monotonic, output_limit, parent_pid, parent_birth_filetime)
    if cancel_requested is not None and not callable(cancel_requested):
        raise ValueError("OWNED_STAGE_CANCEL_CALLBACK_INVALID")
    if running_cancel_requested is not None and (not callable(running_cancel_requested) or cancel_requested is None):
        raise ValueError("OWNED_STAGE_RUNNING_CANCEL_CALLBACK_INVALID")
    if on_suspended is not None and not callable(on_suspended):
        raise ValueError("OWNED_STAGE_BIND_CALLBACK_INVALID")
    api = _Win32()
    k = api.k
    started = time.monotonic()
    result = {
        "schema": SCHEMA, "operation_ok": False, "reason": "NATIVE_STAGE_UNPROVEN", "failures": [],
        "launch_attempted": False, "root_created": False, "assigned_before_execution": False,
        "resume_confirmed": False, "root_pid": None, "root_created_filetime": None,
        "root_image_path": None, "root_exited": False, "root_exit_code": None,
        "parent_pid": parent_pid, "parent_created_filetime": str(parent_birth_filetime),
        "parent_identity_verified": False, "parent_alive_at_completion": False,
        "parent_binding_accepted": on_suspended is None,
        "cancelled": False, "timed_out": False, "termination_requested": False,
        "zero_active_processes_observed": False, "active_processes": None,
        "prelaunch_excluded": True, "custody_released": False, "custody_error": None,
        "pipe_eof_observed": False, "output_complete": False, "output_overflow": False,
        "output_observed_bytes": 0, "output_captured_bytes": 0,
        "output_sha256": None, "output_base64": "", "output_text": "", "native_errors": [],
        "elapsed_ms": 0,
    }
    parent = job = stdin_handle = read_handle = write_handle = None
    attributes = None
    attributes_initialized = False
    attribute_buffer = job_list = handle_list = environment = None
    pi = _PROCESS_INFORMATION()
    captured = bytearray()
    pipe_failed = False

    def fail(code, *, custody=False, winerror=None):
        if code not in result["failures"] and len(result["failures"]) < 16:
            result["failures"].append(code)
        if result["reason"] == "NATIVE_STAGE_UNPROVEN":
            result["reason"] = code
        if custody and result["custody_error"] is None:
            result["custody_error"] = code
        if winerror is not None and len(result["native_errors"]) < 8:
            result["native_errors"].append({"code": code, "winerror": int(winerror)})

    def parent_alive():
        if not parent or not result["parent_identity_verified"]:
            return False
        state = k.WaitForSingleObject(parent, 0)
        if state == WAIT_TIMEOUT:
            return True
        if state != WAIT_OBJECT_0:
            fail("PARENT_STATE_UNPROVEN", winerror=ctypes.get_last_error())
        return False

    def interrupted():
        if not parent_alive():
            result["cancelled"] = True
            fail("PARENT_ENDED_OR_UNPROVEN")
            return True
        try:
            # Continuation cannot authorize creation or resume. Only the native
            # ResumeThread witness activates the running-only policy callback.
            callback = (running_cancel_requested if result["resume_confirmed"]
                        and running_cancel_requested is not None else cancel_requested)
            cancelled = False if callback is None else callback()
            if type(cancelled) is not bool:
                raise ValueError("nonboolean cancellation state")
        except Exception:
            result["cancelled"] = True
            fail("CANCELLATION_STATE_UNPROVEN")
            return True
        if cancelled:
            result["cancelled"] = True
            fail("CANCELLED")
            return True
        if time.monotonic() >= deadline_monotonic:
            result["cancelled"] = True
            result["timed_out"] = True
            fail("DEADLINE_EXCEEDED")
            return True
        return False

    def root_state():
        if not result["root_created"]:
            return None
        state = k.WaitForSingleObject(pi.process, 0)
        if state == WAIT_TIMEOUT:
            return False
        if state != WAIT_OBJECT_0:
            fail("ROOT_WAIT_UNPROVEN", custody=True, winerror=ctypes.get_last_error())
            return None
        result["root_exited"] = True
        if result["root_exit_code"] is None:
            code = DWORD()
            if k.GetExitCodeProcess(pi.process, ctypes.byref(code)):
                result["root_exit_code"] = int(code.value)
            else:
                fail("ROOT_EXIT_CODE_UNPROVEN", custody=True, winerror=ctypes.get_last_error())
        return True

    def job_active():
        if not job:
            return None
        accounting = _ACCOUNTING()
        if not k.QueryInformationJobObject(job, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
            fail("JOB_ACCOUNTING_UNPROVEN", custody=True, winerror=ctypes.get_last_error())
            return None
        result["active_processes"] = int(accounting.active_processes)
        if accounting.active_processes == 0:
            result["zero_active_processes_observed"] = True
        return int(accounting.active_processes)

    def pump_output():
        nonlocal pipe_failed
        if not read_handle or pipe_failed or result["pipe_eof_observed"]:
            return
        # Peek makes each read nonblocking: this is the pipe's only reader.
        # Limit each turn so continuously writing children cannot starve the
        # deadline, cancellation and parent-liveness checks.
        for _ in range(4):
            available = DWORD()
            if not k.PeekNamedPipe(read_handle, None, 0, None, ctypes.byref(available), None):
                error = ctypes.get_last_error()
                if error == ERROR_BROKEN_PIPE:
                    result["pipe_eof_observed"] = True
                else:
                    pipe_failed = True
                    fail("OUTPUT_PIPE_UNPROVEN", winerror=error)
                return
            if not available.value:
                return
            count = min(int(available.value), 65536)
            buffer = ctypes.create_string_buffer(count)
            read = DWORD()
            if not k.ReadFile(read_handle, buffer, count, ctypes.byref(read), None) or read.value > count:
                pipe_failed = True
                fail("OUTPUT_READ_UNPROVEN", winerror=ctypes.get_last_error())
                return
            if read.value == 0:
                pipe_failed = True
                fail("OUTPUT_READ_MADE_NO_PROGRESS")
                return
            data = buffer.raw[:read.value]
            result["output_observed_bytes"] += len(data)
            room = max(0, output_limit - len(captured))
            captured.extend(data[:room])
            if result["output_observed_bytes"] > output_limit:
                result["output_overflow"] = True
                fail("OUTPUT_LIMIT_EXCEEDED")
                return

    def terminate_owned_job():
        if not job or result["termination_requested"]:
            return
        result["termination_requested"] = True
        if not k.TerminateJobObject(job, 79):
            fail("JOB_TERMINATION_UNPROVEN", custody=True, winerror=ctypes.get_last_error())

    def close(handle):
        if handle and handle != INVALID_HANDLE_VALUE:
            if not k.CloseHandle(handle):
                fail("OWNED_HANDLE_CLOSE_FAILED", winerror=ctypes.get_last_error())

    try:
        parent = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, parent_pid)
        api.require(parent, "PARENT_OPEN_UNPROVEN")
        if k.GetProcessId(parent) != parent_pid or api.birth(parent) != parent_birth_filetime:
            raise _NativeFailure("PARENT_IDENTITY_MISMATCH")
        result["parent_identity_verified"] = True
        if interrupted():
            raise _NativeFailure("PRELAUNCH_INTERRUPTED")

        job = k.CreateJobObjectW(None, None)
        api.require(job, "JOB_CREATE_FAILED")
        api.require(k.SetHandleInformation(job, HANDLE_FLAG_INHERIT, 0), "JOB_HANDLE_FLAGS_UNPROVEN")
        flags = DWORD()
        api.require(k.GetHandleInformation(job, ctypes.byref(flags)), "JOB_HANDLE_FLAGS_UNPROVEN")
        if flags.value & HANDLE_FLAG_INHERIT:
            raise _NativeFailure("JOB_HANDLE_INHERITANCE_REJECTED")
        limits = _EXTENDED_LIMIT()
        limits.basic.flags = (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                              | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
                              | JOB_OBJECT_LIMIT_ACTIVE_PROCESS)
        limits.basic.active_limit = PROCESS_LIMIT
        api.require(k.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)),
                    "JOB_LIMITS_UNPROVEN")

        sa = _SECURITY_ATTRIBUTES(ctypes.sizeof(_SECURITY_ATTRIBUTES), None, True)
        read, write = HANDLE(), HANDLE()
        api.require(k.CreatePipe(ctypes.byref(read), ctypes.byref(write), ctypes.byref(sa), 65536),
                    "OUTPUT_PIPE_CREATE_FAILED")
        read_handle, write_handle = read.value, write.value
        api.require(k.SetHandleInformation(read_handle, HANDLE_FLAG_INHERIT, 0), "OUTPUT_HANDLE_FLAGS_UNPROVEN")
        stdin_handle = k.CreateFileW("NUL", 0x80000000, 3, ctypes.byref(sa), 3, 0x80, None)
        if stdin_handle in (None, INVALID_HANDLE_VALUE):
            raise _NativeFailure("NULL_INPUT_CREATE_FAILED", ctypes.get_last_error())

        size = SIZE_T()
        first = k.InitializeProcThreadAttributeList(None, 2, 0, ctypes.byref(size))
        if first or ctypes.get_last_error() != ERROR_INSUFFICIENT_BUFFER or not 0 < size.value <= 65536:
            raise _NativeFailure("ATTRIBUTE_SIZE_UNPROVEN", ctypes.get_last_error())
        attribute_buffer = ctypes.create_string_buffer(size.value)
        attributes = ctypes.cast(attribute_buffer, LPVOID)
        api.require(k.InitializeProcThreadAttributeList(attributes, 2, 0, ctypes.byref(size)),
                    "ATTRIBUTE_LIST_CREATE_FAILED")
        attributes_initialized = True
        job_list = (HANDLE * 1)(job)
        handle_list = (HANDLE * 2)(stdin_handle, write_handle)
        api.require(k.UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                                job_list, ctypes.sizeof(job_list), None, None),
                    "ATOMIC_JOB_ATTRIBUTE_FAILED")
        api.require(k.UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                                handle_list, ctypes.sizeof(handle_list), None, None),
                    "INHERITED_HANDLE_ATTRIBUTE_FAILED")
        startup = _STARTUPINFOEX()
        startup.startup.cb = ctypes.sizeof(startup)
        startup.startup.flags = STARTF_USESTDHANDLES
        startup.startup.stdin = stdin_handle
        startup.startup.stdout = write_handle
        startup.startup.stderr = write_handle
        startup.attributes = attributes
        environment = ctypes.create_unicode_buffer(
            "\0".join(key + "=" + env[key] for key in sorted(env, key=str.upper)) + "\0\0")
        command = ctypes.create_unicode_buffer(subprocess.list2cmdline([executable, *args]))
        if interrupted():
            raise _NativeFailure("PRELAUNCH_INTERRUPTED")
        result["launch_attempted"] = True
        result["prelaunch_excluded"] = False
        created = k.CreateProcessW(
            executable, command, None, None, True,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
            environment, cwd, ctypes.byref(startup), ctypes.byref(pi))
        api.require(created, "PROCESS_CREATE_FAILED")
        result["root_created"] = True
        result["root_pid"] = int(pi.pid)
        if k.GetProcessId(pi.process) != pi.pid:
            raise _NativeFailure("ROOT_PID_UNPROVEN")
        result["root_created_filetime"] = str(api.birth(pi.process))
        result["root_image_path"] = api.image(pi.process)
        if ntpath.normcase(ntpath.normpath(result["root_image_path"])) != ntpath.normcase(ntpath.normpath(executable)):
            raise _NativeFailure("ROOT_IMAGE_MISMATCH")
        member = BOOL()
        api.require(k.IsProcessInJob(pi.process, job, ctypes.byref(member)), "ROOT_JOB_MEMBERSHIP_UNPROVEN")
        if not member.value:
            raise _NativeFailure("ROOT_NOT_IN_OWNED_JOB")
        result["assigned_before_execution"] = True
        # Only the contained root/descendants retain output handles after this.
        close(write_handle)
        write_handle = None
        close(stdin_handle)
        stdin_handle = None
        if on_suspended is not None:
            bound = MappingProxyType({
                "root_pid": result["root_pid"], "root_created_filetime": result["root_created_filetime"],
                "root_image_path": result["root_image_path"], "assigned_before_execution": True,
                "parent_pid": parent_pid, "parent_created_filetime": str(parent_birth_filetime),
            })
            try:
                accepted = on_suspended(bound) is True
            except Exception:
                accepted = False
            result["parent_binding_accepted"] = accepted
            if not accepted:
                fail("PARENT_BINDING_REFUSED")
                raise _NativeFailure("PARENT_BINDING_REFUSED")
        if interrupted():
            raise _NativeFailure("BEFORE_RESUME_INTERRUPTED")
        if k.ResumeThread(pi.thread) != 1:
            raise _NativeFailure("ROOT_RESUME_UNPROVEN", ctypes.get_last_error())
        result["resume_confirmed"] = True

        root_exit_observation_deadline = None
        while True:
            pump_output()
            if interrupted() or pipe_failed or result["output_overflow"]:
                break
            ended = root_state()
            active = job_active()
            if ended is None or active is None:
                break
            if ended:
                if active == 0:
                    break
                # The process handle can signal before Job accounting removes
                # that process. Observe a bounded settling interval while still
                # pumping output and enforcing cancellation/owner/deadline.
                # Only a subsequent native zero count may complete the stage.
                if root_exit_observation_deadline is None:
                    root_exit_observation_deadline = min(
                        deadline_monotonic, time.monotonic() + ROOT_EXIT_ACCOUNTING_SECONDS)
                if time.monotonic() >= root_exit_observation_deadline:
                    fail("ROOT_EXITED_WITH_LIVE_DESCENDANTS")
                    break
            time.sleep(POLL_SECONDS)
    except _NativeFailure as error:
        # A failed API before any root exists is an operation refusal.  Once a
        # root exists, missing identity/native provenance remains sticky even
        # if a later termination attempt happens to observe zero.
        custody_fault = result["root_created"] and error.code not in (
            "PARENT_BINDING_REFUSED", "PRELAUNCH_INTERRUPTED", "BEFORE_RESUME_INTERRUPTED")
        fail(error.code, custody=custody_fault, winerror=error.winerror)
    except Exception:
        fail("OWNED_STAGE_INTERNAL_FAILURE", custody=result["launch_attempted"])
    finally:
        # A pre-resume failure may leave the parent holding the pipe writer.
        close(write_handle)
        write_handle = None
        close(stdin_handle)
        stdin_handle = None
        if job:
            ended = root_state()
            active = job_active()
            if result["root_created"] and (ended is not True or active != 0):
                terminate_owned_job()
            drain_deadline = time.monotonic() + DRAIN_SECONDS
            while True:
                pump_output()
                ended = root_state()
                active = job_active()
                terminal = active == 0 and (not result["root_created"] or ended is True)
                if terminal and (not read_handle or result["pipe_eof_observed"] or pipe_failed):
                    break
                if time.monotonic() >= drain_deadline:
                    if not terminal:
                        fail("NATIVE_DRAIN_UNPROVEN", custody=True)
                    if read_handle and not result["pipe_eof_observed"]:
                        fail("OUTPUT_DRAIN_UNPROVEN")
                    break
                time.sleep(POLL_SECONDS)
            if not result["root_created"] and active == 0 and result["custody_error"] is None:
                result["prelaunch_excluded"] = True
            result["custody_released"] = bool(
                active == 0 and (not result["root_created"] or ended is True)
                and result["custody_error"] is None)
        if result["parent_identity_verified"]:
            result["parent_alive_at_completion"] = parent_alive()
            interrupted()  # Late cancellation/deadline/parent death cannot become success.
        if attributes_initialized:
            k.DeleteProcThreadAttributeList(attributes)
        close(pi.thread)
        close(pi.process)
        close(read_handle)
        # The Job handle is never inherited. Closing it kills only this Job if
        # drain was unproved; closing alone never upgrades the terminal proof.
        close(job)
        close(parent)

    result["output_complete"] = bool(result["pipe_eof_observed"] and not pipe_failed
                                     and not result["output_overflow"])
    result["output_captured_bytes"] = len(captured)
    result["output_sha256"] = hashlib.sha256(captured).hexdigest()
    result["output_base64"] = base64.b64encode(captured).decode("ascii")
    result["output_text"] = captured.decode("utf-8", errors="replace")
    if result["root_exited"] and result["root_exit_code"] not in (None, 0):
        fail("ROOT_EXIT_NONZERO")
    result["operation_ok"] = bool(
        result["resume_confirmed"] and result["assigned_before_execution"]
        and result["parent_identity_verified"] and result["parent_binding_accepted"]
        and result["parent_alive_at_completion"] and result["root_exited"]
        and result["root_exit_code"] == 0 and result["custody_released"]
        and result["output_complete"] and not result["failures"])
    if result["operation_ok"]:
        result["reason"] = "COMPLETED"
    result["elapsed_ms"] = int((time.monotonic() - started) * 1000)
    return result
