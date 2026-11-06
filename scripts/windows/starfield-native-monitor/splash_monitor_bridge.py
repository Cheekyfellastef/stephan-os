"""Private stdio adapter for the existing Hybrid / Stephanos VR splash button.

The existing monitor ledger remains authoritative. This process has no network
listener, arbitrary command, caller-selected path, new game route, or Tk window.
Only the owning splash can confirm the current waiting game through its pipe.
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import re
import stat
import struct
import sys
import threading
import time
import types


SCHEMA = "stephanos.native-eye-output.splash.v1"
CUSTODY_SCHEMA = "stephanos.native-eye-output.provider-custody.v1"
CORE_NAME = "run_native_eye_output_monitor.py"
CORE_SHA256 = "f40df00ff7378b8d3c62714bfb32702226746735f73d804a2c5f3e3727f7ba6c"
MAX_COMMAND_BYTES = 8192
MAX_EVENT_BYTES = 32768
MODES = {"ready", "waiting", "existing", "done", "cleanup", "blocked"}
COMMANDS = {"prepare", "confirm", "finish", "cancel", "close"}
HEX32 = re.compile(r"[0-9a-f]{32}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
DECIMAL = re.compile(r"[1-9][0-9]{0,19}\Z")
REVIEWED_RUNNER_HASHES = {CORE_SHA256, "6e296ff22f3de9fc1ec0ef4a6751cc7cc85b315a2641a8d20c0e1d9bb6c1d4b3"}


class ProtocolError(RuntimeError):
    pass


def short_text(value, limit=1200):
    return str(value)[:limit]


def plain_file(path):
    path = Path(path).absolute()
    for item in (path,) + tuple(path.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ProtocolError("The splash package path is a link/reparse point.")
    if not path.is_file() or path.stat().st_size > 256 * 1024:
        raise ProtocolError("The required splash package member is missing or oversized.")
    with path.open("rb") as stream:
        raw = stream.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024:
        raise ProtocolError("The splash package member exceeded its read bound.")
    return raw


def verify_bridge_identity(path, expected):
    if not isinstance(expected, str) or HEX64.fullmatch(expected) is None:
        raise ProtocolError("Use the existing Hybrid / Stephanos VR button.")
    if hashlib.sha256(plain_file(path)).hexdigest() != expected:
        raise ProtocolError("The splash adapter changed after the launcher verified it.")
    return expected


def load_core(package):
    path = Path(package) / CORE_NAME
    raw = plain_file(path)
    if hashlib.sha256(raw).hexdigest() != CORE_SHA256:
        raise ProtocolError("The reviewed monitor core differs from the splash package.")
    name = "_starfield_splash_monitor_core"
    module = types.ModuleType(name)
    module.__file__ = str(path)
    module.__spec__ = importlib.util.spec_from_file_location(name, path)
    module.__VERIFIED_RUNNER_SHA256__ = CORE_SHA256
    sys.modules[name] = module
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def decode_request(raw):
    if not isinstance(raw, bytes) or not raw.endswith(b"\n") or len(raw) > MAX_COMMAND_BYTES:
        raise ProtocolError("A bounded complete JSON command line is required.")

    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ProtocolError("Duplicate command fields are not admitted.")
            value[key] = item
        return value

    def constant(_value):
        raise ProtocolError("Non-finite command numbers are not admitted.")

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeDecodeError) as error:
        raise ProtocolError("The splash command is not valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise ProtocolError("A command object is required.")
    return value


def validate_request(value, channel, sequence):
    if not isinstance(value, dict):
        raise ProtocolError("A command object is required.")
    command = value.get("command")
    if not isinstance(command, str) or command not in COMMANDS:
        raise ProtocolError("The command is outside the fixed monitor workflow.")
    allowed_keys = {"schema", "channel", "sequence", "command"}
    if command == "confirm":
        allowed_keys |= {"confirmationToken", "runId", "pid", "createdFileTime"}
    if set(value) != allowed_keys:
        raise ProtocolError("The command fields differ from the fixed protocol.")
    if value.get("schema") != SCHEMA or value.get("channel") != channel:
        raise ProtocolError("The command belongs to another splash channel.")
    if type(value.get("sequence")) is not int or value["sequence"] != sequence:
        raise ProtocolError("The command is repeated, skipped, or out of order.")
    return command


class ParentGuard:
    """Retain the exact PowerShell splash process, including its birth time."""
    def __init__(self, pid, filetime):
        if (type(pid) is not int or pid < 1 or pid > 0xFFFFFFFF or os.getppid() != pid
                or not isinstance(filetime, str) or DECIMAL.fullmatch(filetime) is None
                or int(filetime) > 0xFFFFFFFFFFFFFFFF):
            raise ProtocolError("The splash parent identity is invalid.")
        kernel = ctypes.WinDLL(r"C:\Windows\System32\kernel32.dll", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        kernel.GetProcessTimes.restype = wintypes.BOOL
        kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                     ctypes.POINTER(wintypes.DWORD)]
        kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        self.kernel = kernel
        self.handle = kernel.OpenProcess(0x1000 | 0x100000, False, pid)
        if not self.handle:
            raise ProtocolError("The owning splash process cannot be retained.")
        try:
            times = [wintypes.FILETIME() for _ in range(4)]
            if not kernel.GetProcessTimes(self.handle, *(ctypes.byref(item) for item in times)):
                raise ProtocolError("The owning splash creation time is unavailable.")
            actual = str(times[0].dwLowDateTime | (times[0].dwHighDateTime << 32))
            name, length = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
            if not kernel.QueryFullProcessImageNameW(self.handle, 0, name, ctypes.byref(length)):
                raise ProtocolError("The owning splash executable is unavailable.")
            expected_image = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
            if actual != filetime or name.value.casefold() != expected_image.casefold() or not self.alive():
                raise ProtocolError("The owning splash process identity changed.")
        except BaseException:
            self.close()
            raise

    def alive(self):
        return bool(self.handle) and self.kernel.WaitForSingleObject(self.handle, 0) == 258

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class SplashSession:
    """Serialize the five pipe commands around the existing monitor instance."""
    def __init__(self, factory, output, channel, result_root, bridge_digest=None):
        if not isinstance(channel, str) or HEX32.fullmatch(channel) is None:
            raise ProtocolError("The splash channel nonce is invalid.")
        self.factory, self.output = factory, output
        self.channel, self.result_root = channel, Path(result_root)
        self.bridge_digest = bridge_digest
        self.monitor = None
        self.mode = "ready"
        self.busy = False
        self.prepare_dispatched = False
        self.sequence = 0
        self.event_sequence = 0
        self.confirmation_token = None
        self.last_error = None
        self.close_requested = False
        self.close_reason = "CANCELLED_SPLASH_CLOSED"
        self.close_cleanup_dispatched = False
        self.closed = False
        self.transport_broken = False
        self.release_failed = False
        self.exit_code = 0
        self.progress = queue.Queue(maxsize=64)
        self.completed = queue.Queue(maxsize=1)
        self.worker = None

    def state(self):
        value = self.monitor.state if self.monitor is not None else None
        return value if isinstance(value, dict) else {}

    def owned_state(self):
        return (self.monitor is not None and bool(self.state())
                and self.monitor.journal.write_uncertain is False)

    def actions(self):
        if self.closed:
            return []
        actions = ["cancel", "close"]
        if self.busy or self.close_requested:
            return actions
        if self.mode == "ready":
            actions.insert(0, "prepare")
        if (self.mode == "waiting" and self.monitor is not None
                and self.monitor.confirmation_available is True and self.confirmation_token is not None):
            actions.insert(0, "confirm")
        if self.mode in {"waiting", "existing", "cleanup", "blocked"} and self.owned_state():
            actions.append("finish")
        return actions

    def result_paths(self, state):
        value = state.get("resultZip")
        if not isinstance(value, str) or len(value) > 1024:
            return None, None
        path = Path(value)
        match = re.fullmatch(r"Starfield-VR-monitor-result-([0-9a-f]{12})\.zip", path.name)
        if not match or path.parent != self.result_root:
            return None, None
        directory = self.result_root / ("result-" + match[1])
        if len(str(directory)) > 1024:
            return None, None
        try:
            for item in (path, directory) + tuple(path.parents):
                info = item.lstat()
                if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                    return None, None
            if not path.is_file() or not directory.is_dir():
                return None, None
        except OSError:
            return None, None
        return str(path), str(directory)

    def projection(self):
        state = self.state()
        process = state.get("process")
        if (isinstance(process, dict) and type(process.get("pid")) is int
                and 0 < process["pid"] <= 0xFFFFFFFF
                and isinstance(process.get("createdFileTime"), str)
                and DECIMAL.fullmatch(process["createdFileTime"]) is not None):
            process = {"pid": process["pid"], "createdFileTime": process["createdFileTime"]}
        else:
            process = None
        run_id = state.get("runId")
        if not isinstance(run_id, str) or HEX32.fullmatch(run_id) is None:
            run_id = None
        # Match Journal.release exactly: even malformed falsey non-null child
        # records retain custody. Missing prepared-state custody is unknown.
        pending = state.get("activeChild") is not None
        uncertain = self.monitor is not None and self.monitor.journal.write_uncertain is not False
        cleaned = state.get("cleanupComplete") is True
        custody_complete = "activeChild" in state and isinstance(state.get("childCalls"), list)
        released = (not self.busy and not self.release_failed and not pending and not uncertain
                    and (not self.prepare_dispatched or (cleaned and custody_complete)))
        analysis = state.get("analysis")
        analysis_ok = isinstance(analysis, dict) and analysis.get("monitorCaptureAccepted") is True
        cleanup = state.get("cleanupReceipt")
        normal = isinstance(cleanup, dict) and cleanup.get("normalExitProven") is True
        result_zip, result_directory = self.result_paths(state)
        outcome = state.get("outcome")
        if not isinstance(outcome, str) or len(outcome) > 100 or self.busy:
            outcome = None
        return {"mode": self.mode, "busy": self.busy, "allowedActions": self.actions(),
                "runId": run_id, "process": process, "confirmationToken": self.confirmation_token,
                "outcome": outcome, "cleanupComplete": cleaned, "normalExitProven": normal,
                "analysisAccepted": analysis_ok, "bundleEvidenceIntegrityVerified": state.get("bundleEvidenceIntegrityVerified") is True,
                "unresolvedChild": pending, "playableVRProven": False,
                "safeToClose": released, "providerSlotReleased": released,
                "resultZip": result_zip, "resultDirectory": result_directory,
                "error": self.last_error, "stage": short_text(state.get("stage", "READY"), 120)}

    def emit(self, kind, **payload):
        self.event_sequence += 1
        if self.transport_broken:
            return
        value = {"schema": SCHEMA, "channel": self.channel, "eventSequence": self.event_sequence,
                 "childPid": os.getpid(), "type": kind, "bridgeSha256": self.bridge_digest,
                 "runnerSha256": CORE_SHA256, **payload}
        raw = json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n"
        if len(raw.encode("ascii")) > MAX_EVENT_BYTES:
            raise ProtocolError("The bounded splash event exceeded its size limit.")
        try:
            self.output.write(raw)
            self.output.flush()
        except (BrokenPipeError, OSError, ValueError):
            # A lost output pipe must never prevent normal owned-game cleanup.
            self.transport_broken = True
            self.close_requested = True
            self.close_reason = "CANCELLED_SPLASH_DISCONNECTED"
            self.confirmation_token = None
            if self.monitor is not None:
                self.monitor.cancelled.set()

    def emit_state(self):
        if not self.transport_broken:
            self.emit("state", **self.projection())

    def notify(self, message):
        try:
            self.progress.put_nowait(short_text(message))
        except queue.Full:
            # Progress prose is advisory; never block the capture/cleanup worker.
            pass

    def perform(self, operation):
        try:
            if operation == "prepare":
                self.prepare_dispatched = True
                mode = self.monitor.prepare()
            elif operation == "confirm":
                mode = self.monitor.confirm_save_loaded()
            elif operation == "finish":
                reason = self.close_reason if self.close_requested else "OPERATOR_REQUESTED_CLEANUP"
                mode = self.monitor.finish(reason)
            else:
                raise ProtocolError("Unregistered monitor operation.")
            if self.monitor.cancelled.is_set() and mode in {"waiting", "existing"}:
                mode = self.monitor.finish("CANCELLED_BEFORE_PROBE")
            return {"mode": mode, "error": None}
        except Exception as error:
            try:
                return {"mode": self.monitor.fail(error), "error": short_text(error)}
            except Exception as reporting_error:
                # Do not repeat a possibly mutating operation to improve a report.
                return {"mode": "blocked", "error": short_text(error, 800) + "; reporting: " + short_text(reporting_error, 350)}

    def start_operation(self, operation):
        if self.busy:
            raise ProtocolError("A monitor operation is already active.")
        self.busy = True
        self.confirmation_token = None
        self.emit_state()

        def worker():
            try:
                if self.monitor is None:
                    self.monitor = self.factory(self.notify)
                if self.close_requested:
                    self.monitor.cancelled.set()
                result = self.perform(operation)
            except Exception as error:
                result = {"mode": "blocked", "error": short_text(error)}
            self.completed.put(result)

        self.worker = threading.Thread(target=worker, name="StarfieldSplashMonitor", daemon=False)
        self.worker.start()

    def command(self, value):
        command = validate_request(value, self.channel, self.sequence + 1)
        if command not in self.actions():
            raise ProtocolError("This command is not admitted in the current monitor state.")
        if command == "confirm":
            state = self.state()
            process = state.get("process") or {}
            if (not isinstance(value.get("confirmationToken"), str)
                    or value["confirmationToken"] != self.confirmation_token
                    or value.get("runId") != state.get("runId")
                    or type(value.get("pid")) is not int or value["pid"] != process.get("pid")
                    or not isinstance(value.get("createdFileTime"), str)
                    or value["createdFileTime"] != process.get("createdFileTime")):
                raise ProtocolError("The save confirmation is stale or belongs to another game.")
        self.sequence += 1
        if command in {"cancel", "close"}:
            self.request_stop("CANCELLED_SPLASH_CLOSED")
        else:
            self.start_operation(command)

    def request_stop(self, reason, error=None):
        if self.closed:
            return
        self.close_requested = True
        self.close_reason = reason
        self.confirmation_token = None
        if error is not None:
            self.last_error = short_text(error)
            self.exit_code = 2
        if self.monitor is not None:
            self.monitor.cancelled.set()

    def pump(self):
        for _ in range(32):
            try:
                message = self.progress.get_nowait()
            except queue.Empty:
                break
            self.emit("progress", message=message)
        try:
            result = self.completed.get_nowait()
        except queue.Empty:
            result = None
        if result is not None:
            if self.worker is not None:
                self.worker.join()
                self.worker = None
            self.busy = False
            self.mode = result["mode"] if result.get("mode") in MODES else "blocked"
            if result.get("error"):
                self.last_error = short_text(result["error"])
            if (self.mode == "waiting" and self.monitor is not None
                    and self.monitor.confirmation_available is True and not self.close_requested):
                import uuid
                self.confirmation_token = uuid.uuid4().hex
            self.emit_state()
        self.advance_close()

    def advance_close(self):
        if not self.close_requested or self.busy or self.closed:
            return
        state = self.state()
        if (self.mode in {"waiting", "existing", "blocked"} and self.owned_state()
                and state.get("cleanupComplete") is not True and not self.close_cleanup_dispatched):
            self.close_cleanup_dispatched = True
            self.start_operation("finish")
            return
        if self.monitor is not None:
            try:
                self.monitor.journal.release()
            except Exception as error:
                self.last_error = short_text(error)
                self.release_failed = True
            finally:
                try:
                    self.monitor.host.close()
                except Exception as error:
                    self.last_error = short_text(error)
                    self.release_failed = True
        if self.last_error or not self.projection()["safeToClose"]:
            self.exit_code = 2
        self.closed = True
        self.emit("closed", **self.projection(), exitCode=self.exit_code)


def run_session(factory, stream_in, stream_out, channel, result_root, parent_alive=lambda: True,
                bridge_digest=None):
    incoming = queue.Queue(maxsize=16)
    session = SplashSession(factory, stream_out, channel, result_root, bridge_digest)

    def read_commands():
        try:
            while True:
                line = stream_in.readline(MAX_COMMAND_BYTES + 1)
                if line == b"":
                    incoming.put(("eof", None))
                    return
                incoming.put(("line", line))
                if len(line) > MAX_COMMAND_BYTES or not line.endswith(b"\n"):
                    return
        except Exception as error:
            incoming.put(("error", short_text(error)))

    threading.Thread(target=read_commands, name="StarfieldSplashPipe", daemon=True).start()
    try:
        session.emit_state()
        while not session.closed:
            session.pump()
            if session.closed:
                break
            if not parent_alive():
                session.request_stop("CANCELLED_SPLASH_DISCONNECTED")
            try:
                kind, payload = incoming.get(timeout=0.05)
            except queue.Empty:
                session.advance_close()
                continue
            if kind == "eof":
                session.request_stop("CANCELLED_SPLASH_DISCONNECTED")
            elif kind == "error":
                session.request_stop("CANCELLED_SPLASH_DISCONNECTED", payload)
            elif not session.close_requested:
                try:
                    session.command(decode_request(payload))
                except ProtocolError as error:
                    session.request_stop("CANCELLED_INVALID_SPLASH_COMMAND", error)
            session.advance_close()
    except Exception as error:
        # Unexpected transport/parent-witness failures also preserve the worker
        # until its normal bounded cleanup has finished. Never dispose its pins
        # or launch another action while the in-flight call can still mutate.
        session.transport_broken = True
        session.request_stop("CANCELLED_SPLASH_BRIDGE_FAILURE", error)
        while not session.closed:
            session.pump()
            if not session.closed:
                time.sleep(0.05)
    return session.exit_code


def custody_paths(core, helper):
    """Exactly the paths used by the splash's absence-only fast check."""
    return {"outer": core.RUN_DIRECTORY / "session.json",
            "outerLock": core.RUN_DIRECTORY / "operator.lock",
            "stockMarker": core.RUN_DIRECTORY / "stock-child-consumed.json",
            "loadMarker": core.RUN_DIRECTORY / "loader-child-consumed.json",
            "starter": core.SOURCE / helper.SESSION_NAME,
            "starterLock": (core.SOURCE / helper.SESSION_NAME).with_suffix(".lock"),
            "heldProxy": helper.HELD}


def custody_snapshot(core, helper):
    values = {}
    for name, path in custody_paths(core, helper).items():
        path = core.plain_path(path)
        if not path.exists():
            values[name] = None
        elif name == "heldProxy":
            # Any held-path presence is a hold; never inspect arbitrary bytes.
            info = path.stat()
            values[name] = (info.st_size, info.st_mtime_ns)
        else:
            values[name] = core.bounded_bytes(path, 1024 * 1024 if name in {"outer", "starter"} else 8192)
    if values["outer"] is not None or values["starter"] is not None:
        receipt = core.plain_path(core.SOURCE / "proxy-isolation-receipt.json")
        values["restoreReceipt"] = core.bounded_bytes(receipt, 32768) if receipt.exists() else None
    return values


def validate_released_custody(core, helper, outer, starter, restore):
    """Consume typed terminal evidence, never a loose completed/true label."""
    if outer is None and starter is None:
        raise ProtocolError("MONITOR_CUSTODY_ORPHANED")
    if outer is not None:
        if (not isinstance(outer, dict) or outer.get("schema") != core.SCHEMA
                or outer.get("workspace") != str(core.WORKSPACE)
                or outer.get("handoffSha256") != core.HANDOFF_SHA256
                or outer.get("reviewedDllSha256") != core.DLL_SHA256
                or not isinstance(outer.get("runId"), str) or HEX32.fullmatch(outer["runId"]) is None
                or outer.get("runnerSha256") not in REVIEWED_RUNNER_HASHES
                or outer.get("stage") != "CLEANUP_COMPLETE"
                or outer.get("cleanupComplete") is not True
                or "activeChild" not in outer or outer["activeChild"] is not None
                or type(outer.get("captureAttempted")) is not bool
                or type(outer.get("saveLoadedConfirmed")) is not bool
                or not isinstance(outer.get("childCalls"), list) or len(outer["childCalls"]) > 2048):
            raise ProtocolError("MONITOR_OUTER_CLEANUP_UNPROVEN")
        child_ids = set()
        for child in outer["childCalls"]:
            if (not isinstance(child, dict) or not isinstance(child.get("id"), str)
                    or HEX32.fullmatch(child["id"]) is None or child["id"] in child_ids
                    or child.get("role") not in {"start", "status", "finish", "modules", "scene", "stock", "load"}
                    or child.get("state") not in {"RETURNED", "NOT_STARTED"}):
                raise ProtocolError("MONITOR_CHILD_CUSTODY_UNRESOLVED")
            child_ids.add(child["id"])
        cleanup = outer.get("cleanupReceipt")
        if not isinstance(cleanup, dict) or cleanup.get("proxyRestored") is not True:
            raise ProtocolError("MONITOR_CLEANUP_RECEIPT_UNPROVEN")
    else:
        cleanup = None
    if starter is None:
        if (outer.get("starterSessionId") is not None or outer.get("process") is not None
                or outer["captureAttempted"] is not False or outer["saveLoadedConfirmed"] is not False
                or cleanup.get("stage") != "NO_STARTER_SESSION_NO_GAME_PROXY_RESTORED"
                or any(child["role"] != "status" for child in outer["childCalls"])):
            raise ProtocolError("MONITOR_STARTER_CUSTODY_MISSING")
    else:
        if (not isinstance(starter, dict) or starter.get("schema") != helper.SCHEMA
                or starter.get("workspace") != str(core.WORKSPACE)
                or starter.get("handoffSha256") != core.HANDOFF_SHA256
                or starter.get("reviewedDllSha256") != core.DLL_SHA256
                or starter.get("sourceArchiveSha256") != helper.ARCHIVE_HASH
                or not isinstance(starter.get("sessionId"), str) or HEX32.fullmatch(starter["sessionId"]) is None
                or starter.get("proxyRestored") is not True
                or type(starter.get("launchRequested")) is not bool
                or starter.get("injected") is not False or starter.get("captureAttempted") is not False
                or starter.get("saveLoadedConfirmed") is not False):
            raise ProtocolError("MONITOR_STARTER_CLEANUP_UNPROVEN")
        if starter["launchRequested"]:
            if (starter.get("stage") != "GAME_EXIT_OBSERVED_PROXY_RESTORED"
                    or starter.get("gameExitObserved") is not True
                    or not core.process_valid(starter.get("process"))):
                raise ProtocolError("MONITOR_GAME_EXIT_UNPROVEN")
        elif starter.get("stage") != "PRELAUNCH_ABORT_PROXY_RESTORED" or starter.get("process") is not None:
            raise ProtocolError("MONITOR_PRELAUNCH_CLEANUP_UNPROVEN")
        if outer is not None:
            if (outer.get("starterSessionId") != starter["sessionId"]
                    or cleanup.get("sessionId") != starter["sessionId"]
                    or cleanup.get("stage") != starter["stage"]
                    or core.json_bytes(cleanup.get("process")) != core.json_bytes(starter.get("process"))
                    or core.json_bytes(outer.get("process")) != core.json_bytes(starter.get("process"))
                    or (starter["launchRequested"] and cleanup.get("gameExitObserved") is not True)):
                raise ProtocolError("MONITOR_CLEANUP_IDENTITY_MISMATCH")
        if (not isinstance(restore, dict) or restore.get("stage") != "restored"
                or restore.get("source") != str(helper.PROXY) or restore.get("held") != str(helper.HELD)
                or restore.get("expectedSha256") != helper.PROXY_HASH
                or restore.get("sourceSha256") != helper.PROXY_HASH
                or "heldSha256" not in restore or restore["heldSha256"] is not None
                or not isinstance(restore.get("utc"), str) or not restore["utc"]):
            raise ProtocolError("MONITOR_PROXY_RESTORE_RECEIPT_UNPROVEN")


def provider_custody(core, helper, host_factory=None):
    """Read existing custody twice around a fixed process observation; no writes."""
    first = custody_snapshot(core, helper)
    if all(value is None for value in first.values()):
        if custody_snapshot(core, helper) != first:
            raise ProtocolError("MONITOR_CUSTODY_CHANGED_DURING_OBSERVATION")
        return {"allowed": True, "providerSlotReleased": True, "reason": "NO_MONITOR_CUSTODY",
                "observationsCurrent": True, "noMutationPerformed": True}
    if any(first[key] is not None for key in ("outerLock", "starterLock", "heldProxy")):
        return {"allowed": False, "providerSlotReleased": False, "reason": "MONITOR_CUSTODY_HELD",
                "observationsCurrent": True, "noMutationPerformed": True}
    outer = core.strict_json(first["outer"]) if first["outer"] is not None else None
    starter = core.strict_json(first["starter"]) if first["starter"] is not None else None
    restore = core.strict_json(first["restoreReceipt"]) if first.get("restoreReceipt") is not None else None
    validate_released_custody(core, helper, outer, starter, restore)
    for name in ("stockMarker", "loadMarker"):
        if first[name] is None:
            if name == "loadMarker" and outer is not None and outer.get("probeLoadedProven") is True:
                raise ProtocolError("MONITOR_LOAD_RECEIPT_UNPROVEN")
            continue
        marker = core.strict_json(first[name])
        process = outer.get("process") if isinstance(outer, dict) else None
        if (not isinstance(marker, dict) or not core.process_valid(process)
                or marker.get("runId") != outer["runId"] or type(marker.get("pid")) is not int
                or marker["pid"] != process["pid"] or marker.get("createdFileTime") != process["createdFileTime"]):
            raise ProtocolError("MONITOR_INVOCATION_CUSTODY_MISMATCH")
        if name == "loadMarker" and (outer.get("captureAttempted") is not True
                or marker.get("attemptToken") != outer.get("captureAttemptToken")
                or marker.get("starterSessionId") != outer.get("starterSessionId")
                or marker.get("reviewedDllSha256") != core.DLL_SHA256
                or marker.get("loaderSha256") != core.LOADER_SHA256):
            raise ProtocolError("MONITOR_LOAD_CUSTODY_MISMATCH")
    host = (host_factory or helper.WindowsHost)()
    # A later legitimate VorpX/MutaR selection can change dxgi.dll. Completed
    # monitor custody is proved by its terminal owner/restore records, absent
    # locks and held path, and no live game; do not freeze the provider forever
    # to the monitor's original proxy hash. Existing slot validation still runs.
    games = host.games()
    if not isinstance(games, list) or games:
        raise ProtocolError("MONITOR_GAME_STILL_PRESENT_OR_UNOBSERVED")
    if custody_snapshot(core, helper) != first:
        raise ProtocolError("MONITOR_CUSTODY_CHANGED_DURING_OBSERVATION")
    return {"allowed": True, "providerSlotReleased": True, "reason": "MONITOR_CUSTODY_RELEASED",
            "observationsCurrent": True, "noMutationPerformed": True}


def custody_main():
    """Fixed metadata-only CLI for the existing provider-slot guard."""
    bridge_digest = globals().get("__VERIFIED_BRIDGE_SHA256__")
    pins = None
    try:
        if (os.name != "nt" or struct.calcsize("P") != 8 or sys.flags.optimize or sys.version_info < (3, 10)
                or not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode)):
            raise ProtocolError("MONITOR_CUSTODY_REQUIRES_ISOLATED_WINDOWS_RUNTIME")
        verify_bridge_identity(Path(__file__), bridge_digest)
        core = load_core(Path(__file__).parent)
        pins = core.ReadPins()
        pins.add([Path(__file__), Path(__file__).with_name(CORE_NAME), Path(__file__).with_name(core.HELPER_NAME)])
        verify_bridge_identity(Path(__file__), bridge_digest)
        if core.sha256(core.bounded_bytes(Path(__file__).with_name(CORE_NAME), 256 * 1024)) != CORE_SHA256:
            raise ProtocolError("MONITOR_CUSTODY_CORE_CHANGED")
        helper = core.pinned_module(Path(__file__).with_name(core.HELPER_NAME), core.HELPER_SHA256,
                                    "_starfield_custody_starter")
        result = provider_custody(core, helper)
    except Exception as error:
        reason = str(error) if isinstance(error, ProtocolError) and re.fullmatch(r"[A-Z0-9_]{1,100}", str(error)) else "MONITOR_CUSTODY_QUERY_FAILED"
        result = {"allowed": False, "providerSlotReleased": False, "reason": reason,
                  "observationsCurrent": False, "noMutationPerformed": True}
    finally:
        if pins is not None:
            pins.close()
    print(json.dumps({"schema": CUSTODY_SCHEMA, "bridgeSha256": bridge_digest,
                      "runnerSha256": CORE_SHA256, **result}), flush=True)
    return 0 if result["allowed"] is True else 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider-custody", action="store_true")
    parser.add_argument("--parent-pid", type=int)
    parser.add_argument("--parent-filetime")
    parser.add_argument("--channel")
    args = parser.parse_args(argv)
    if args.provider_custody:
        if any(value is not None for value in (args.parent_pid, args.parent_filetime, args.channel)):
            raise ProtocolError("Custody observation cannot be combined with a monitor session.")
        return custody_main()
    if (args.parent_pid is None or args.parent_filetime is None or args.channel is None):
        raise ProtocolError("The owning splash identity is required.")
    if HEX32.fullmatch(args.channel) is None:
        raise ProtocolError("The splash channel nonce is invalid.")
    bridge_digest = globals().get("__VERIFIED_BRIDGE_SHA256__")
    parent = None
    pins = None
    session_started = False
    try:
        if (os.name != "nt" or struct.calcsize("P") != 8 or sys.flags.optimize
                or not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode)):
            raise ProtocolError("The splash requires isolated 64-bit Windows Python 3.10 or newer.")
        if sys.version_info < (3, 10):
            raise ProtocolError("The existing Python runtime is too old for this monitor continuation.")
        bridge_digest = verify_bridge_identity(Path(__file__), bridge_digest)
        parent = ParentGuard(args.parent_pid, args.parent_filetime)
        core = load_core(Path(__file__).parent)
        pins = core.ReadPins()
        pins.add([Path(__file__), Path(__file__).with_name(CORE_NAME)])
        verify_bridge_identity(Path(__file__), bridge_digest)
        if core.sha256(core.bounded_bytes(Path(__file__).with_name(CORE_NAME), 256 * 1024)) != CORE_SHA256:
            raise ProtocolError("The monitor core changed before its read pin was acquired.")

        def factory(notify):
            journal = core.Journal(core.RUN_DIRECTORY)
            return core.Monitor(journal, core.WindowsActions(journal), notify)

        session_started = True
        return run_session(factory, sys.stdin.buffer, sys.stdout, args.channel, core.RUN_DIRECTORY,
                           parent.alive, bridge_digest)
    except Exception as error:
        if session_started:
            raise
        # No prepare/factory operation was dispatched. The splash may release
        # its own UI reservation; existing provider readiness still applies.
        failed = SplashSession(None, sys.stdout, args.channel, Path(__file__).parent, bridge_digest)
        failed.mode = "blocked"
        failed.last_error = short_text(error)
        failed.exit_code = 2
        failed.emit_state()
        failed.request_stop("CANCELLED_STARTUP_FAILURE", error)
        failed.advance_close()
        return 2
    finally:
        if pins is not None:
            pins.close()
        if parent is not None:
            parent.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # A failure outside the protocol never authorizes retry or cleanup
        # success. Existing durable session/child records remain authoritative.
        print(short_text(error), file=sys.stderr, flush=True)
        sys.exit(2)
