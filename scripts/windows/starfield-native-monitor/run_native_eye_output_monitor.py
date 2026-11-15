"""One-use monitor core for the existing Starfield splash screen.

No original build/source/checkpoint is replaced. The reviewed starter and
analyzer must be beside this file. The splash adapter owns the operator UI.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import re
import runpy
import stat
import subprocess
import sys
import threading
import time
import types
import uuid
import zipfile


WORKSPACE = Path.home() / "Documents" / "Codex" / "2026-11-05" / "starfield-vr-did-not-start-and"
SOURCE = WORKSPACE / "work" / "stephanos-openxr"
OUTPUTS = WORKSPACE / "outputs"
RUN_DIRECTORY = OUTPUTS / "Starfield-VR-monitor-one-click-v1"
GAME = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Starfield\Starfield.exe")
SCHEMA = "stephanos.native-eye-output.one-click.v1"
HELPER_NAME = "start_native_eye_output_session.py"
ANALYZER_NAME = "analyze_native_eye_output_session.py"
HELPER_SHA256 = "d1b1386f6bdaa6dbea6f9faab019c30b06e6e5619fe44b512c673422d675449c"
ANALYZER_SHA256 = "18c2ec52d3d0184e7b6c2a77efe45108d5843a524c3386d285f50f83f3395336"
HANDOFF_SHA256 = "2c234970c5bcd7cf54544c496a7f74b398ee2ecaa9055ebcead4f64d5c42685f"
DLL_SHA256 = "43e6fd3b2a3e92abd11312e46d1f17ef427a220185fb4a3271b702b7efab8448"
LOADER_SHA256 = "44d00cd273e767077add83f95b149dfb83edbf2cd3f01988928f153ee5de009c"
MAPPED_IDENTITY_SHA256 = "1673d03577c8a1381983b2fbe130db212fcac577293334d747d4f71fb83efffa"
WAITING = "FRESH_MONITOR_GAME_WAITING_FOR_SAVE"
FINISHED = {"GAME_EXIT_OBSERVED_PROXY_RESTORED", "PRELAUNCH_ABORT_PROXY_RESTORED"}
MAX_CAPTURE_BYTES = 64 * 1024 * 1024
MAX_CHILD_BYTES = 4 * 1024 * 1024
INTERNAL_ACTIONS = {"modules", "stock", "scene", "load"}


class Blocked(RuntimeError):
    pass


class UncertainChild(Blocked):
    """A dispatched child has not returned; it must never be repeated."""


def utc():
    return datetime.now(timezone.utc).isoformat()


def plain_path(path):
    path = Path(path).absolute()
    for item in (path,) + tuple(path.parents):
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise Blocked("A required path is a symlink/reparse point: " + str(item))
    return path


def bounded_bytes(path, maximum):
    path = plain_path(path)
    if not path.is_file() or path.stat().st_size > maximum:
        raise Blocked("Missing, non-regular or oversized file: " + path.name)
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise Blocked("File grew beyond its read bound: " + path.name)
    return raw


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON field: " + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError("Invalid JSON number: " + value)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8-sig")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def write_new(path, raw):
    path = plain_path(path)
    descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def json_bytes(record):
    return (json.dumps(record, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def process_valid(process):
    return (isinstance(process, dict) and type(process.get("pid")) is int
            and 0 < process["pid"] < 2**32
            and str(process.get("path", "")).casefold() == str(GAME).casefold()
            and isinstance(process.get("createdFileTime"), str)
            and re.fullmatch(r"[1-9][0-9]{16,19}", process["createdFileTime"]) is not None)


def same_process(first, second):
    return (process_valid(first) and process_valid(second)
            and first["pid"] == second["pid"]
            and first["createdFileTime"] == second["createdFileTime"])


def waiting_receipt(session):
    if (not isinstance(session, dict) or session.get("stage") != WAITING
            or session.get("launchRequested") is not True
            or session.get("handoffSha256") != HANDOFF_SHA256
            or session.get("reviewedDllSha256") != DLL_SHA256
            or any(session.get(field) is not False for field in
                   ("injected", "captureAttempted", "saveLoadedConfirmed"))
            or not re.fullmatch(r"[0-9a-f]{32}", str(session.get("sessionId", "")))
            or not process_valid(session.get("process"))):
        raise Blocked("The saved starter session is not an unconsumed waiting monitor process.")
    return session


def waiting_session(status):
    if not isinstance(status, dict) or status.get("operationLockPresent") is not False:
        raise Blocked("The existing starter has a busy or unresolved operation lock.")
    session = waiting_receipt(status.get("session"))
    games = status.get("games")
    if (not isinstance(games, list) or len(games) != 1
            or not same_process(games[0], session["process"])
            or status.get("proxyState") != "isolated"):
        raise Blocked("The sole live game/proxy does not match the saved monitor process.")
    return session


def readiness_valid(record, pid):
    if not isinstance(record, dict):
        return False
    before, after = record.get("counterBefore"), record.get("counterAfter")
    flags = record.get("loadedFlags")
    # A wrapping counter is refused rather than treated as unobserved progress.
    return (type(record.get("pid")) is int and record["pid"] == pid
            and isinstance(flags, list) and len(flags) == 2
            and all(type(item) is int for item in flags) and flags == [0, 1]
            and record.get("loadedCandidate") is True and record.get("rootStable") is True
            and type(before) is int and type(after) is int
            and 0 <= before < after <= 0xFFFFFFFF)


class Journal:
    """One exclusive owner and CAS-protected durable state, outside SOURCE."""
    def __init__(self, directory):
        self.directory = plain_path(directory)
        self.path = self.directory / "session.json"
        self.lock = self.directory / "operator.lock"
        self.token = None
        self.version = None
        self.write_uncertain = False
        self.state = None

    def acquire(self):
        plain_path(self.directory.parent)
        self.directory.mkdir(exist_ok=True)
        plain_path(self.directory)
        self.token = json_bytes({"owner": uuid.uuid4().hex, "pid": os.getpid(), "utc": utc()})
        try:
            write_new(self.lock, self.token)
        except FileExistsError as exc:
            self.token = None
            raise Blocked("This monitor window is already running, or a previous operation is unresolved. The lock is preserved.") from exc
        if self.path.exists():
            raw = bounded_bytes(self.path, 1024 * 1024)
            state = strict_json(raw)
            if (not isinstance(state, dict) or state.get("schema") != SCHEMA
                    or state.get("workspace") != str(WORKSPACE)
                    or state.get("handoffSha256") != HANDOFF_SHA256
                    or state.get("reviewedDllSha256") != DLL_SHA256
                    or not re.fullmatch(r"[0-9a-f]{32}", str(state.get("runId", "")))):
                raise Blocked("The existing one-click session identity differs; it is preserved.")
            self.version, self.state = sha256(raw), state
            return False
        self.state = {"schema": SCHEMA, "runId": uuid.uuid4().hex, "workspace": str(WORKSPACE),
                      "handoffSha256": HANDOFF_SHA256, "reviewedDllSha256": DLL_SHA256,
                      "createdUtc": utc(), "stage": "RESERVED", "events": [],
                      "captureAttempted": False, "saveLoadedConfirmed": False,
                      "starterSessionId": None, "process": None, "activeChild": None,
                      "childCalls": [], "probeLoadedProven": False, "probeLoadState": "NOT_ATTEMPTED",
                      "operatorLockOwner": strict_json(self.token)["owner"],
                      "windowProcessId": os.getpid(), "headsetNeeded": False}
        self.save(new=True)
        return True

    def save(self, new=False):
        self.state["updatedUtc"] = utc()
        raw = json_bytes(self.state)
        if len(raw) > 1024 * 1024:
            raise Blocked("Session record would exceed its bound; no further action is admitted.")
        if not new and (self.version is None or sha256(bounded_bytes(self.path, 1024 * 1024)) != self.version):
            self.write_uncertain = True
            raise Blocked("Session changed outside this window; preserving it and its lock.")
        self.write_uncertain = True
        if new:
            write_new(self.path, raw)
        else:
            temporary = self.directory / ("session." + uuid.uuid4().hex + ".tmp")
            write_new(temporary, raw)
            if sha256(bounded_bytes(self.path, 1024 * 1024)) != self.version:
                raise Blocked("Session changed before its durable update; both records are preserved.")
            os.replace(temporary, self.path)
        self.version = sha256(raw)
        self.write_uncertain = False

    def event(self, stage, **fields):
        self.state.update(fields, stage=stage)
        self.state["events"].append({"stage": stage, "utc": utc()})
        self.save()

    def release(self):
        if self.token is None or self.write_uncertain:
            return
        if self.state and self.state.get("activeChild") is not None:
            return
        if bounded_bytes(self.lock, 8192) != self.token:
            raise Blocked("Operation lock identity changed; preserving it.")
        self.lock.unlink()
        self.token = None


class Monitor:
    """Platform-injected state machine. No GUI callback is synthesized here."""
    def __init__(self, journal, host, notify=lambda _message: None):
        self.journal, self.host, self.notify = journal, host, notify
        self.cancelled = threading.Event()
        self.confirmation_available = False
        self.guard = None
        self.owned_in_this_window = False

    @property
    def state(self):
        return self.journal.state

    def prepare(self):
        fresh = self.journal.acquire()
        self.host.verify_artifacts()
        if not fresh:
            # Reopening can only collect evidence and finish the SAME process.
            self.confirmation_available = False
            return "existing"
        if self.cancelled.is_set():
            return self.finish("CANCELLED_BEFORE_PROBE")
        self.notify("Checking the saved files and current Starfield process…")
        status = self.host.helper("status")
        if status.get("operationLockPresent") is not False:
            raise Blocked("An existing starter operation is unresolved; it will not be repeated.")
        self.host.assert_no_capture()
        if status.get("session") is None:
            if status.get("games") != [] or status.get("proxyState") != "restored":
                raise Blocked("Starfield must be closed and the original proxy restored before this fresh test.")
            self.journal.event("STARTER_LAUNCH_INTENT")
            self.notify("Opening Starfield for the monitor test…")
            if self.cancelled.is_set():
                return self.finish("CANCELLED_BEFORE_PROBE")
            start_receipt = self.host.helper("start")
            self.state["starterStartReceipt"] = start_receipt
            returned = waiting_receipt(start_receipt)
            self.state.update(starterSessionId=returned["sessionId"], process=returned["process"],
                              starterSession=returned, ownershipSource="this_window_start_receipt")
            self.journal.save()
            self.owned_in_this_window = True
            status = self.host.helper("status")
        else:
            self.state["adoptedExistingWaitingStarter"] = True
        session = waiting_session(status)
        self.guard = self.host.open_guard(session["process"])
        self.journal.event("WAITING_FOR_FRESH_SAVE_CONFIRMATION", process=session["process"],
                           starterSessionId=session["sessionId"], starterSession=session)
        self.confirmation_available = True
        self.owned_in_this_window = True
        return "waiting"

    def _same_waiting_process(self):
        status = self.host.helper("status")
        session = waiting_session(status)
        if (session["sessionId"] != self.state.get("starterSessionId")
                or not same_process(session["process"], self.state.get("process"))):
            raise Blocked("The waiting process/session changed; no probe will be loaded.")
        if self.guard is None:
            self.guard = self.host.open_guard(self.state["process"])
        if not self.host.guard_alive(self.guard):
            raise Blocked("The owned game process has exited; this attempt cannot be reused.")
        self.state["lastObservedProcessIdentity"] = {"process": status["games"][0], "observedUtc": utc()}
        self.journal.save()
        return session

    def confirm_save_loaded(self):
        """Called ONLY by this window's actual 'Save loaded' button handler."""
        if (not self.confirmation_available or self.state.get("stage") != "WAITING_FOR_FRESH_SAVE_CONFIRMATION"
                or self.state.get("captureAttempted") is not False):
            raise Blocked("A fresh button confirmation is not available for this session.")
        self.confirmation_available = False
        self._same_waiting_process()
        process = self.state["process"]
        self.journal.event("FRESH_SAVE_BUTTON_CONFIRMED", saveLoadedConfirmed=True,
                           saveConfirmation={"source": "current_window_button", "utc": utc(),
                                             "runId": self.state["runId"],
                                             "starterSessionId": self.state["starterSessionId"],
                                             "pid": process["pid"], "createdFileTime": process["createdFileTime"]})
        if self.cancelled.is_set():
            return self.finish("CANCELLED_BEFORE_PROBE")
        self.notify("Returning focus to Starfield. Leave your character still while the test runs.")
        if not self.host.focus_game(process, self.guard):
            raise Blocked("The owned game could not be brought to the foreground. No probe was loaded.")
        self.host.verify_artifacts()
        self._same_waiting_process()
        modules = self.host.original_check("modules", process)
        if (not isinstance(modules, dict) or type(modules.get("pid")) is not int or modules.get("pid") != process["pid"]
                or modules.get("createdFileTime") != process["createdFileTime"]
                or modules.get("independentModulesPassed") is not True):
            raise Blocked("Fresh process / stock-DXGI / provider absence was not verified.")
        scene = self.host.original_check("scene", process)
        self.state["sceneReadiness"] = scene
        if not readiness_valid(scene, process["pid"]):
            # Read-only denial; no stock receipt or capture attempt was created.
            self.journal.event("WAITING_FOR_FRESH_SAVE_CONFIRMATION", saveLoadedConfirmed=False,
                               readinessMessage="The loaded scene/counter was not ready. Load the save, leave the game unpaused, and confirm again.")
            self.confirmation_available = True
            return "waiting"
        self.host.assert_stock_absent(process)
        stock = self.host.original_check("stock", process)
        if (not isinstance(stock, dict) or type(stock.get("pid")) is not int or stock.get("pid") != process["pid"]
                or stock.get("proxyMapped") is not False
                or str(stock.get("systemDxgi", "")).casefold() != r"c:\windows\system32\dxgi.dll"
                or stock.get("rollbackReceipt") != "proxy-isolation-receipt.json"):
            raise Blocked("The stock DXGI receipt did not pass its independent checks.")
        self.state.update(moduleReadiness=modules, stockDxgi=stock)
        self.journal.save()
        self._same_waiting_process()
        self.host.assert_no_capture()
        if self.cancelled.is_set():
            return self.finish("CANCELLED_BEFORE_PROBE")
        attempt = uuid.uuid4().hex
        self.journal.event("CAPTURE_ATTEMPT_RESERVED", captureAttempted=True,
                           captureAttemptToken=attempt, captureAbsentBeforeLoad=True,
                           observedProcessCreatedFileTime=self.state["lastObservedProcessIdentity"]["process"]["createdFileTime"],
                           probeLoadState="UNKNOWN",
                           loaderInvocationUtc=utc())
        start_time = self.host.monotonic()
        deadline = start_time + 210.0
        self.state["watchdogSecondsFromInvocation"] = 210
        self.journal.save()
        if self.cancelled.is_set():
            self.journal.event("CANCELLED_AFTER_RESERVATION_BEFORE_LOADER", probeLoadState="NOT_DISPATCHED")
            return self.finish("CANCELLED_BEFORE_PROBE")
        self.notify("Running the reviewed monitor capture. This stage is bounded to 3½ minutes.")
        try:
            loader = self.host.load_once(process, attempt, deadline)
            self.state["loaderReceipt"] = loader
            self.state["probeLoadedProven"] = bool(isinstance(loader, dict)
                                                   and loader.get("moduleLoaded") is True
                                                   and loader.get("pid") == process["pid"]
                                                   and loader.get("dllSha256") == DLL_SHA256)
            if self.state["probeLoadedProven"]:
                self.state["probeLoadState"] = "MODULE_LOAD_PROVEN"
            deadline = min(deadline, self.host.monotonic() + 180.0)
            self.journal.event("LOADER_RETURNED_CAPTURE_PENDING")
        except UncertainChild as error:
            # The same child may still be running. No new loader is permitted.
            self.state["loaderError"] = str(error)
            self.journal.event("LOADER_DISPATCH_UNRESOLVED")
        except Exception as error:
            # Failed/invalid stdout can occur after injection; still allow the
            # bounded native worker to finish and inspect whatever it recorded.
            self.state["loaderError"] = str(error)
            self.journal.event("LOADER_FAILED_OR_RECEIPT_INVALID")
        terminal_seen = False
        while self.host.monotonic() < deadline:
            if self.cancelled.is_set() or not self.host.guard_alive(self.guard):
                break
            if self.host.capture_terminal_seen(process):
                terminal_seen = True
                self.host.sleep(1.0)  # Native post-restoration/report delay is 250 ms.
                break
            self.host.sleep(min(1.0, max(0.0, deadline - self.host.monotonic())))
        timed_out = not terminal_seen and not self.cancelled.is_set() and self.host.monotonic() >= deadline
        self.journal.event("CAPTURE_WAIT_ENDED", terminalSeen=terminal_seen, timedOut=timed_out,
                           cancelledByOperator=self.cancelled.is_set())
        return self.finish("CAPTURE_WAIT_ENDED")

    def finish(self, reason="OPERATOR_REQUESTED_CLEANUP"):
        self.confirmation_available = False
        if self.state is None:
            raise Blocked("No owned one-click session is available for cleanup.")
        self.notify("Closing the owned game normally and checking proxy restoration…")
        self.state["finishReason"] = reason
        self.journal.save()
        try:
            # An unresolved launcher could still start later. Frozen helper must
            # not be raced. A live loader, unlike a launcher, never starts games.
            active = self.state.get("activeChild")
            if active and active.get("role") != "load":
                raise Blocked("A prior non-loader operation is unresolved; cleanup is held for reconciliation.")
            status = self.host.helper("status")
            if status.get("operationLockPresent") is not False:
                raise Blocked("The original starter is busy/unresolved; no cleanup will race it.")
            session = status.get("session")
            if not isinstance(session, dict):
                if status.get("games") == [] and status.get("proxyState") == "restored":
                    cleanup = {"stage": "NO_STARTER_SESSION_NO_GAME_PROXY_RESTORED", "proxyRestored": True,
                               "gameExitObserved": False, "normalExitProven": False}
                else:
                    raise Blocked("No owned starter session was found; game and proxy are preserved.")
            else:
                expected_id = self.state.get("starterSessionId")
                # If start failed before returning, do not invent ownership.
                if expected_id is None or session.get("sessionId") != expected_id:
                    raise Blocked("The starter session is not bound to this GUI attempt; cleanup is held.")
                recorded = self.state.get("process")
                if recorded is not None and not same_process(session.get("process"), recorded):
                    raise Blocked("The starter process identity changed; no automatic close is permitted.")
                cleanup = self.host.helper("finish")
            self.state["cleanupReceipt"] = cleanup
            self.state["cleanupComplete"] = (cleanup.get("proxyRestored") is True
                                             and cleanup.get("stage") in FINISHED | {"NO_STARTER_SESSION_NO_GAME_PROXY_RESTORED"})
        except Exception as error:
            self.state.update(cleanupComplete=False, cleanupError=str(error))
        self.journal.event("CLEANUP_COMPLETE" if self.state.get("cleanupComplete") else "CLEANUP_REQUIRED")
        self.host.collect_results(self.state)
        self.journal.save()
        return "done" if self.state.get("cleanupComplete") else "cleanup"

    def fail(self, error):
        self.confirmation_available = False
        if self.state is None or self.journal.write_uncertain:
            return "blocked"
        self.state["error"] = str(error)
        self.journal.event("BLOCKED")
        if (self.owned_in_this_window and self.state.get("starterSessionId") is not None
                and self.state.get("activeChild") is None):
            return self.finish("BLOCKED_AFTER_OWNED_START")
        self.host.collect_results(self.state)
        self.journal.save()
        return "blocked"


def pinned_module(path, expected, module_name):
    """Execute the exact bytes checked, not a second pathname read or pyc."""
    raw = bounded_bytes(path, 256 * 1024)
    if sha256(raw) != expected:
        raise Blocked("Reviewed Python file changed: " + Path(path).name)
    module = types.ModuleType(module_name)
    module.__file__ = str(path)
    module.__spec__ = importlib.util.spec_from_file_location(module_name, path)
    sys.modules[module_name] = module
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def verified_runner_identity(path, bootstrapped_digest):
    """Only the launcher's verified executed bytes may authorize child code."""
    if (not isinstance(bootstrapped_digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", bootstrapped_digest) is None):
        raise Blocked("The verified splash identity is missing. Use the Hybrid / Stephanos VR button.")
    if sha256(bounded_bytes(path, 256 * 1024)) != bootstrapped_digest:
        raise Blocked("The runner file changed after the launcher verified it; no game action is admitted.")
    return bootstrapped_digest


def verify_originals(helper):
    path = OUTPUTS / "Starfield-VR-HANDOFF.json"
    if helper.digest(path) != HANDOFF_SHA256:
        raise Blocked("The original handoff JSON changed.")
    handoff = helper.read_json(path)
    if handoff.get("workspace") != str(WORKSPACE) or handoff.get("activeSource") != str(SOURCE):
        raise Blocked("The handoff names a different workspace.")
    helper.verify_files(SOURCE, handoff["files"])
    archive = OUTPUTS / "Starfield-VR-reviewed-handoff.zip"
    if helper.digest(archive) != helper.ARCHIVE_HASH or archive.stat().st_size != 1399942:
        raise Blocked("The reviewed backup archive changed.")
    expected = {"state": handoff["state"], "captureExecuted": False, "liveGamePid": None,
                "review": handoff["review"], "artifacts": handoff["artifactHashes"],
                "handoff": str(path), "archive": handoff["archive"]}
    saved_checkpoint = helper.read_json(SOURCE / "native-eye-output-v1-checkpoint.json")
    # Python equality conflates JSON false/true with 0/1.  Match the frozen
    # starter's typed comparison, including nested review/artifact fields.
    if json.dumps(saved_checkpoint, sort_keys=True) != json.dumps(expected, sort_keys=True):
        raise Blocked("The saved native experiment checkpoint changed.")
    if helper.digest(GAME) != helper.GAME_HASH:
        raise Blocked("The installed game changed.")
    return handoff


class ReadPins:
    """Keep reviewed input files read-only while this controller is active."""
    def __init__(self):
        import ctypes
        from ctypes import wintypes
        self.ctypes, self.types = ctypes, wintypes
        self.kernel = ctypes.WinDLL(r"C:\Windows\System32\kernel32.dll", use_last_error=True)
        self.kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                           ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        self.kernel.CreateFileW.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.handles = {}

    def add(self, paths):
        for path in paths:
            path = plain_path(path)
            if str(path) in self.handles:
                continue
            handle = self.kernel.CreateFileW(str(path), 0x80000000, 1, None, 3, 0, None)
            if handle == self.ctypes.c_void_p(-1).value:
                raise Blocked("Cannot hold reviewed input read-only: " + path.name)
            self.handles[str(path)] = handle

    def close(self):
        for handle in self.handles.values():
            self.kernel.CloseHandle(handle)
        self.handles.clear()


class ProcessGuard:
    def __init__(self, process):
        if not process_valid(process):
            raise Blocked("Invalid owned process identity.")
        import ctypes
        from ctypes import wintypes
        self.C, self.W, self.process = ctypes, wintypes, process
        self.kernel = ctypes.WinDLL(r"C:\Windows\System32\kernel32.dll", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                         wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        self.kernel.GetProcessTimes.restype = wintypes.BOOL
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.WaitForSingleObject.restype = wintypes.DWORD
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.handle = self.kernel.OpenProcess(0x101000, False, process["pid"])
        if not self.handle:
            raise Blocked("The recorded game process cannot be inspected.")
        try:
            name, size = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
            if not self.kernel.QueryFullProcessImageNameW(self.handle, 0, name, ctypes.byref(size)):
                raise Blocked("The game executable path could not be verified.")
            times = [wintypes.FILETIME() for _ in range(4)]
            if not self.kernel.GetProcessTimes(self.handle, *(ctypes.byref(item) for item in times)):
                raise Blocked("The game creation identity could not be verified.")
            self.filetime = str(times[0].dwLowDateTime | times[0].dwHighDateTime << 32)
            if name.value.casefold() != str(GAME).casefold() or self.filetime != process["createdFileTime"]:
                raise Blocked("The game PID has a different executable or creation identity.")
            if not self.alive():
                raise Blocked("The recorded game process has already exited.")
        except BaseException:
            self.close()
            raise

    def alive(self):
        status = self.kernel.WaitForSingleObject(self.handle, 0)
        if status not in (0, 258):
            raise Blocked("Game process liveness could not be observed.")
        return status == 258

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class WindowsActions:
    def __init__(self, journal, package_directory=None):
        if os.name != "nt":
            raise Blocked("Live actions require the Windows Battle Bridge.")
        if not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode):
            raise Blocked("Use the Hybrid / Stephanos VR button (isolated Python is required).")
        self.journal = journal
        self.package = plain_path(package_directory or Path(__file__).parent)
        self.runner_path = self.package / Path(__file__).name
        self.runner_hash = verified_runner_identity(self.runner_path, globals().get("__VERIFIED_RUNNER_SHA256__"))
        self.pins = ReadPins()
        try:
            self.pins.add([self.runner_path, self.package / HELPER_NAME, self.package / ANALYZER_NAME])
            verified_runner_identity(self.runner_path, self.runner_hash)
            self.helper_module = pinned_module(self.package / HELPER_NAME, HELPER_SHA256, "_starfield_frozen_starter")
            self.analyzer = pinned_module(self.package / ANALYZER_NAME, ANALYZER_SHA256, "_starfield_frozen_analyzer")
        except BaseException:
            self.pins.close()
            raise
        self.children = {}
        self.guards = []

    def verify_artifacts(self):
        for name, expected in ((HELPER_NAME, HELPER_SHA256), (ANALYZER_NAME, ANALYZER_SHA256)):
            if sha256(bounded_bytes(self.package / name, 256 * 1024)) != expected:
                raise Blocked("Frozen package member changed: " + name)
        if sha256(bounded_bytes(self.runner_path, 256 * 1024)) != self.runner_hash:
            raise Blocked("The active GUI runner changed.")
        if self.journal.state is not None:
            saved = self.journal.state.get("runnerSha256")
            if saved is not None and saved != self.runner_hash:
                raise Blocked("This session belongs to a different GUI runner build.")
            if saved is None:
                self.journal.state["runnerSha256"] = self.runner_hash
                self.journal.save()
        handoff_path = OUTPUTS / "Starfield-VR-HANDOFF.json"
        self.pins.add([handoff_path, OUTPUTS / "Starfield-VR-reviewed-handoff.zip",
                       SOURCE / "native-eye-output-v1-checkpoint.json", GAME])
        if self.helper_module.digest(handoff_path) != HANDOFF_SHA256:
            raise Blocked("The original handoff JSON changed.")
        handoff = self.helper_module.read_json(handoff_path)
        # Validate relative names before opening the corresponding read pins.
        self.helper_module.verify_files(SOURCE, handoff["files"])
        self.pins.add([SOURCE / name for name in handoff["files"]])
        verify_originals(self.helper_module)

    def assert_no_capture(self):
        for item in plain_path(SOURCE).iterdir():
            name = item.name.lower()
            if name.startswith("native-eye-output-") and name.endswith(".jsonl"):
                raise Blocked("A native-eye-output capture already exists; it will not be overwritten or repeated.")

    def assert_stock_absent(self, process):
        if plain_path(SOURCE / ("stock-dxgi-%d.json" % process["pid"])).exists():
            raise Blocked("This process already has a stock-DXGI receipt; it is preserved.")

    def _refresh_children(self):
        state = self.journal.state
        changed = False
        for entry in state["childCalls"]:
            child = self.children.get(entry["id"])
            if child is not None and entry["state"] in ("RUNNING", "UNRESOLVED") and child.poll() is not None:
                entry.update(state="RETURNED", returnCode=child.returncode, completedUtc=utc())
                changed = True
        pending = [entry for entry in state["childCalls"] if entry["state"] in ("RUNNING", "UNRESOLVED")]
        active = pending[0].copy() if pending else None
        if active != state.get("activeChild"):
            state["activeChild"] = active
            changed = True
        if changed:
            self.journal.save()
        return pending

    def _run(self, role, argv, seconds):
        pending = self._refresh_children()
        if pending and (any(entry["role"] != "load" for entry in pending) or role not in ("status", "finish")):
            raise UncertainChild("An earlier helper is unresolved; its invocation will not be repeated.")
        call_id = uuid.uuid4().hex
        stdout_path = self.journal.directory / (role + "-" + call_id + ".stdout.txt")
        stderr_path = self.journal.directory / (role + "-" + call_id + ".stderr.txt")
        # O_EXCL output files retain exactly this invocation's stdout/stderr.
        entry = {"id": call_id, "role": role, "state": "INTENT", "createdUtc": utc(),
                 "stdout": stdout_path.name, "stderr": stderr_path.name}
        self.journal.state["childCalls"].append(entry)
        self.journal.save()
        try:
            with plain_path(stdout_path).open("xb") as out, plain_path(stderr_path).open("xb") as err:
                child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                         cwd=str(SOURCE), creationflags=subprocess.CREATE_NO_WINDOW,
                                         close_fds=True, shell=False)
        except Exception as error:
            entry.update(state="NOT_STARTED", error=str(error))
            self.journal.save()
            raise
        self.children[call_id] = child
        entry.update(state="RUNNING", pid=child.pid)
        self.journal.state["activeChild"] = (pending[0].copy() if pending else entry.copy())
        self.journal.save()
        deadline = time.monotonic() + max(0.0, seconds)
        while child.poll() is None and time.monotonic() < deadline:
            if stdout_path.stat().st_size > MAX_CHILD_BYTES or stderr_path.stat().st_size > MAX_CHILD_BYTES:
                break
            time.sleep(0.1)
        if child.poll() is None:
            entry.update(state="UNRESOLVED", timedOutUtc=utc())
            self.journal.state["activeChild"] = (pending[0].copy() if pending else entry.copy())
            self.journal.save()
            # Never terminate the game or an uncertain helper to manufacture an
            # exit receipt. Its durable identity and lock remain for inspection.
            raise UncertainChild(role + " did not return within its bound; its exact invocation is retained.")
        self._refresh_children()
        raw_out = bounded_bytes(stdout_path, MAX_CHILD_BYTES)
        raw_err = bounded_bytes(stderr_path, MAX_CHILD_BYTES)
        entry.update(stdoutSha256=sha256(raw_out), stderrSha256=sha256(raw_err))
        self.journal.save()
        try:
            data = strict_json(raw_out) if raw_out.strip() else None
        except (ValueError, UnicodeDecodeError) as error:
            raise Blocked(role + " returned an invalid receipt; no action is automatically retried.") from error
        if child.returncode != 0 and not (role in ("start", "finish") and isinstance(data, dict) and "stage" in data):
            detail = raw_err.decode("utf-8-sig", errors="replace").strip()[-1800:]
            raise Blocked(role + " did not complete successfully. " + detail)
        if not isinstance(data, dict):
            raise Blocked(role + " returned no object receipt.")
        return data

    def helper(self, action):
        if action not in ("start", "status", "finish"):
            raise Blocked("Unregistered starter action.")
        if sha256(bounded_bytes(self.package / HELPER_NAME, 256 * 1024)) != HELPER_SHA256:
            raise Blocked("Frozen starter changed.")
        timeout = {"start": 240, "status": 50, "finish": 100}[action]
        return self._run(action, [sys.executable, "-I", "-S", "-B", str(self.package / HELPER_NAME), action], timeout)

    def original_check(self, operation, process):
        if operation not in ("modules", "stock", "scene") or not process_valid(process):
            raise Blocked("Unregistered preflight check.")
        return self._run(operation, [sys.executable, "-I", "-S", "-B", str(self.runner_path),
                                    "--internal", operation, "--pid", str(process["pid"]),
                                    "--filetime", process["createdFileTime"]], 45)

    def load_once(self, process, attempt, deadline):
        return self._run("load", [sys.executable, "-I", "-S", "-B", str(self.runner_path),
                                 "--internal", "load", "--pid", str(process["pid"]),
                                 "--filetime", process["createdFileTime"], "--attempt", attempt],
                         max(0.0, deadline - time.monotonic()))

    def open_guard(self, process):
        guard = ProcessGuard(process)
        self.guards.append(guard)
        return guard

    @staticmethod
    def guard_alive(guard):
        return guard.alive()

    @staticmethod
    def focus_game(process, guard):
        import ctypes
        from ctypes import wintypes
        if not guard.alive():
            return False
        user = ctypes.WinDLL(r"C:\Windows\System32\user32.dll", use_last_error=True)
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
        user.EnumWindows.restype = wintypes.BOOL
        user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user.GetWindowThreadProcessId.restype = wintypes.DWORD
        user.IsWindowVisible.argtypes = [wintypes.HWND]
        user.IsWindowVisible.restype = wintypes.BOOL
        user.SetForegroundWindow.argtypes = [wintypes.HWND]
        user.SetForegroundWindow.restype = wintypes.BOOL
        user.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
        user.ShowWindowAsync.restype = wintypes.BOOL
        user.GetForegroundWindow.argtypes = []
        user.GetForegroundWindow.restype = wintypes.HWND
        found = []
        @callback_type
        def collect(window, _argument):
            pid = wintypes.DWORD()
            user.GetWindowThreadProcessId(window, ctypes.byref(pid))
            if pid.value == process["pid"] and user.IsWindowVisible(window):
                found.append(window)
            return True
        if not user.EnumWindows(collect, 0) or len(found) != 1 or not guard.alive():
            return False
        user.ShowWindowAsync(found[0], 9)
        user.SetForegroundWindow(found[0])
        for _ in range(20):
            if user.GetForegroundWindow() == found[0] and guard.alive():
                return True
            time.sleep(0.1)
        return False

    def capture_terminal_seen(self, process):
        path = plain_path(SOURCE / ("native-eye-output-%d.jsonl" % process["pid"]))
        if not path.exists():
            return False
        try:
            raw = bounded_bytes(path, MAX_CAPTURE_BYTES)
            if not raw.endswith(b"\n"):
                return False
            lines = [line for line in raw.splitlines() if line.strip()]
            last = strict_json(lines[-1]) if lines else None
            return isinstance(last, dict) and "originalBytesAndProtectionRestored" in last
        except (ValueError, UnicodeDecodeError, OSError, Blocked):
            return False

    def collect_results(self, state):
        self._refresh_children()
        result_id = uuid.uuid4().hex[:12]
        directory = plain_path(self.journal.directory / ("result-" + result_id))
        directory.mkdir()
        copied = []
        evidence_issues = []
        process = state.get("process")
        analysis = None
        state.pop("captureReadError", None)
        if process_valid(process):
            source = plain_path(SOURCE / ("native-eye-output-%d.jsonl" % process["pid"]))
            if source.exists():
                try:
                    raw = bounded_bytes(source, MAX_CAPTURE_BYTES)
                    destination = directory / source.name
                    write_new(destination, raw)
                    copied.append(destination)
                    state["captureSnapshot"] = {"name": source.name, "bytes": len(raw), "sha256": sha256(raw),
                                                "copiedUtc": utc(), "cleanupComplete": state.get("cleanupComplete") is True,
                                                "processExitObserved": state.get("cleanupReceipt", {}).get("gameExitObserved") is True}
                    analysis = self.analyzer.analyze_file(
                        destination, loader_receipt=state.get("loaderReceipt"), expected_pid=process["pid"],
                        expected_process_created_filetime=process["createdFileTime"],
                        observed_process_created_filetime=state.get("observedProcessCreatedFileTime"),
                        timed_out=state.get("timedOut", False))
                except Exception as error:
                    state["captureReadError"] = str(error)
            if analysis is None and state.get("captureAttempted"):
                analysis = self.analyzer.analyze_records(
                    [], loader_receipt=state.get("loaderReceipt"), expected_pid=process["pid"],
                    expected_process_created_filetime=process["createdFileTime"],
                    observed_process_created_filetime=state.get("observedProcessCreatedFileTime"),
                    timed_out=state.get("timedOut", False), parse_errors=[state.get("captureReadError", "Native capture file is absent.")])
        state["analysis"] = analysis
        accepted = bool(analysis and analysis.get("monitorCaptureAccepted") is True)
        cleaned = state.get("cleanupComplete") is True
        normal = state.get("cleanupReceipt", {}).get("normalExitProven") is True
        pending = bool(state.get("activeChild"))
        state["resultZip"] = str(self.journal.directory / ("Starfield-VR-monitor-result-" + result_id + ".zip"))
        state["playableVRProven"] = False
        for entry in state["childCalls"]:
            for key in ("stdout", "stderr"):
                name = entry.get(key, "")
                if not re.fullmatch(r"(?:start|status|finish|modules|scene|stock|load)-[0-9a-f]{32}\.(?:stdout|stderr)\.txt", name):
                    evidence_issues.append("Unrecognized scoped child receipt name for " + str(entry.get("id")) + ": " + key)
                    continue
                try:
                    content = bounded_bytes(self.journal.directory / name, MAX_CHILD_BYTES)
                    expected_digest = entry.get(key + "Sha256")
                    if not isinstance(expected_digest, str):
                        evidence_issues.append(name + ": the child did not return a finalized receipt hash; this is a snapshot.")
                    elif sha256(content) != expected_digest:
                        evidence_issues.append(name + ": contents differ from the recorded child-return hash.")
                    destination = directory / name
                    write_new(destination, content)
                    copied.append(destination)
                except (OSError, Blocked) as error:
                    evidence_issues.append(name + ": omitted because " + str(error))
        for name, required in (("stock-child-consumed.json", bool(state.get("stockDxgi"))),
                               ("loader-child-consumed.json", state.get("probeLoadedProven") is True)):
            source = plain_path(self.journal.directory / name)
            if not source.exists():
                if required:
                    evidence_issues.append(name + ": required invocation-consumption receipt is absent.")
                continue
            try:
                raw = bounded_bytes(source, 8192)
                receipt = strict_json(raw)
                if (not isinstance(receipt, dict) or receipt.get("runId") != state["runId"]
                        or not process_valid(process) or type(receipt.get("pid")) is not int
                        or receipt.get("pid") != process["pid"] or receipt.get("createdFileTime") != process["createdFileTime"]):
                    raise Blocked("Invocation receipt is not bound to this session/process.")
                if name.startswith("loader") and (receipt.get("attemptToken") != state.get("captureAttemptToken")
                        or receipt.get("starterSessionId") != state.get("starterSessionId")
                        or receipt.get("reviewedDllSha256") != DLL_SHA256 or receipt.get("loaderSha256") != LOADER_SHA256):
                    raise Blocked("Loader invocation receipt differs from the reserved attempt.")
                destination = directory / name
                write_new(destination, raw)
                copied.append(destination)
            except (ValueError, OSError, Blocked) as error:
                evidence_issues.append(name + ": omitted because " + str(error))
        state["bundleEvidenceIssues"] = evidence_issues
        state["bundleEvidenceIntegrityVerified"] = not evidence_issues
        if accepted and cleaned and normal and not pending and not state.get("cancelledByOperator") and not evidence_issues:
            outcome = "REVIEWED_MONITOR_TEST_PASSED"
        elif accepted and evidence_issues:
            outcome = "CAPTURE_PASSED_RESULT_RECEIPTS_INCOMPLETE"
        elif accepted:
            outcome = "CAPTURE_PASSED_CLEANUP_OR_EXIT_PROVENANCE_INCOMPLETE"
        elif state.get("captureAttempted"):
            outcome = "MONITOR_EVIDENCE_REJECTED_OR_INCOMPLETE"
        elif state.get("finishReason", "").startswith("CANCELLED"):
            outcome = "CANCELLED_BEFORE_PROBE"
        else:
            outcome = "BLOCKED_BEFORE_PROBE"
        state["outcome"] = outcome
        if analysis is not None:
            analysis_path = directory / "capture-analysis.json"
            write_new(analysis_path, json_bytes(analysis))
            copied.append(analysis_path)
        summary = directory / "monitor-result.json"
        write_new(summary, json_bytes(state))
        copied.append(summary)
        text_path = directory / "READ-RESULT.txt"
        lines = ["STEPHANOS STARFIELD VR — MONITOR TEST RESULT", "", "Outcome: " + outcome,
                 "Native capture accepted: " + str(accepted), "Proxy restoration verified: " + str(cleaned),
                 "Normal game exit proven: " + str(normal), "Unresolved helper remains: " + str(pending),
                 "Result receipt integrity verified: " + str(not evidence_issues),
                 "", "This is a bounded monitor experiment. It does not prove playable headset VR.",
                 "View the result in the Starfield VR splash. Detailed evidence remains in this result folder.",
                 "Do not rerun the capture. The same window may only check normal cleanup."]
        for key in ("error", "loaderError", "cleanupError", "captureReadError"):
            if state.get(key):
                lines.extend(["", key + ": " + str(state[key])])
        if analysis:
            lines.extend(["", "Analyzer outcome: " + analysis["outcome"]])
            lines.extend("- " + reason for reason in analysis["reasons"])
        if evidence_issues:
            lines.extend(["", "Receipt omissions or integrity issues:"])
            lines.extend("- " + issue for issue in evidence_issues)
        write_new(text_path, ("\n".join(lines) + "\n").encode("utf-8"))
        copied.append(text_path)
        manifest = directory / "CONTENTS-SHA256.json"
        write_new(manifest, json_bytes({path.name: {"bytes": path.stat().st_size,
                                                  "sha256": sha256(bounded_bytes(path, MAX_CAPTURE_BYTES))}
                                       for path in copied}))
        copied.append(manifest)
        archive_path = plain_path(state["resultZip"])
        with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in copied:
                archive.write(path, path.name)

    monotonic = staticmethod(time.monotonic)
    sleep = staticmethod(time.sleep)

    def close(self):
        for guard in self.guards:
            guard.close()
        self.pins.close()


def validate_internal_admission(state, lock, action, pid, filetime, attempt=None, parent_pid=None):
    """Fixed child entry cannot bypass the current GUI's durable admission."""
    if action not in ("stock", "load"):
        raise Blocked("This admission is only for the two receipt/mutation child actions.")
    if (not isinstance(state, dict) or state.get("schema") != SCHEMA
            or state.get("workspace") != str(WORKSPACE)
            or state.get("handoffSha256") != HANDOFF_SHA256
            or state.get("reviewedDllSha256") != DLL_SHA256
            or not re.fullmatch(r"[0-9a-f]{32}", str(state.get("runId", "")))
            or not re.fullmatch(r"[0-9a-f]{32}", str(state.get("starterSessionId", "")))
            or not process_valid(state.get("process"))
            or type(pid) is not int or pid != state["process"]["pid"]
            or not isinstance(filetime, str) or filetime != state["process"]["createdFileTime"]
            or state.get("saveLoadedConfirmed") is not True):
        raise Blocked("Child invocation lacks the exact confirmed GUI session identity.")
    confirmation = state.get("saveConfirmation")
    if (not isinstance(confirmation, dict) or confirmation.get("source") != "current_window_button"
            or confirmation.get("runId") != state["runId"]
            or confirmation.get("starterSessionId") != state["starterSessionId"]
            or type(confirmation.get("pid")) is not int or confirmation["pid"] != pid
            or confirmation.get("createdFileTime") != filetime
            or not isinstance(confirmation.get("utc"), str)):
        raise Blocked("The current GUI save-loaded confirmation is absent or belongs to another process.")
    if (not isinstance(lock, dict) or not re.fullmatch(r"[0-9a-f]{32}", str(lock.get("owner", "")))
            or lock.get("owner") != state.get("operatorLockOwner")
            or type(lock.get("pid")) is not int or lock["pid"] != state.get("windowProcessId")
            or type(parent_pid) is not int or parent_pid != lock["pid"]):
        raise Blocked("This child was not invoked by the owning GUI process.")
    expected_stage = "CAPTURE_ATTEMPT_RESERVED" if action == "load" else "FRESH_SAVE_BUTTON_CONFIRMED"
    if state.get("stage") != expected_stage or state.get("captureAttempted") is not (action == "load"):
        raise Blocked("The one-attempt capture admission is not in its required stage.")
    if action == "load":
        if (not isinstance(attempt, str) or re.fullmatch(r"[0-9a-f]{32}", attempt) is None
                or attempt != state.get("captureAttemptToken") or state.get("captureAbsentBeforeLoad") is not True
                or state.get("observedProcessCreatedFileTime") != filetime
                or not readiness_valid(state.get("sceneReadiness"), pid)):
            raise Blocked("The capture nonce, absence proof or scene readiness is not bound to this invocation.")
        if (state.get("moduleReadiness", {}).get("independentModulesPassed") is not True
                or state.get("moduleReadiness", {}).get("createdFileTime") != filetime
                or state.get("stockDxgi", {}).get("proxyMapped") is not False
                or state.get("stockDxgi", {}).get("pid") != pid):
            raise Blocked("The capture lacks its process-bound module/DXGI receipts.")
    return state["process"]


def _internal_outer(action, pid, filetime, attempt):
    state = strict_json(bounded_bytes(RUN_DIRECTORY / "session.json", 1024 * 1024))
    lock = strict_json(bounded_bytes(RUN_DIRECTORY / "operator.lock", 8192))
    process = validate_internal_admission(state, lock, action, pid, filetime, attempt, os.getppid())
    own_hash = sha256(bounded_bytes(Path(__file__), 256 * 1024))
    if state.get("runnerSha256") != own_hash:
        raise Blocked("The child runner is not the exact owner-recorded build.")
    return state, process


def _fixed_module_observation(process, api, old_api):
    C, W = api["C"], api["W"]
    handle = api["check"](api["open_process"](0x410, False, process["pid"]))
    try:
        times = [W.FILETIME() for _ in range(4)]
        api["check"](api["process_times"](handle, *(C.byref(item) for item in times)))
        filetime = str(times[0].dwLowDateTime | times[0].dwHighDateTime << 32)
        name, size = C.create_unicode_buffer(32768), W.DWORD(32768)
        api["check"](api["query_image"](handle, 0, name, C.byref(size)))
        if filetime != process["createdFileTime"] or name.value.casefold() != str(GAME).casefold():
            raise Blocked("The read-only module check observed a different game identity.")
        mapped = api["modules"](handle)
        api["verify_independent_audit_modules"](mapped)
        old_probe_names = {value[0].casefold() for value in old_api["PROBES"].values()}
        if any(path.name.casefold() in old_probe_names for path in mapped):
            raise Blocked("An earlier reviewed probe is already resident; a fresh unprobed game is required.")
        return {"pid": process["pid"], "createdFileTime": filetime,
                "independentModulesPassed": True, "oldProbeAbsent": True,
                "systemDxgi": r"C:\Windows\System32\dxgi.dll", "observedUtc": utc()}
    finally:
        api["close"](handle)


def internal_main(args):
    if os.name != "nt" or not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode) or sys.flags.optimize:
        raise Blocked("A non-optimized isolated Windows Python process is required.")
    process = {"pid": args.pid, "path": str(GAME), "createdFileTime": args.filetime}
    if not process_valid(process):
        raise Blocked("The fixed child process identity is invalid.")
    package = plain_path(Path(__file__).parent)
    pins = ReadPins()
    guard = None
    try:
        pins.add([Path(__file__), package / HELPER_NAME, OUTPUTS / "Starfield-VR-HANDOFF.json",
                  OUTPUTS / "Starfield-VR-reviewed-handoff.zip", SOURCE / "native-eye-output-v1-checkpoint.json", GAME])
        helper = pinned_module(package / HELPER_NAME, HELPER_SHA256, "_starfield_child_starter")
        handoff = helper.read_json(OUTPUTS / "Starfield-VR-HANDOFF.json")
        if helper.digest(OUTPUTS / "Starfield-VR-HANDOFF.json") != HANDOFF_SHA256:
            raise Blocked("The original handoff changed.")
        helper.verify_files(SOURCE, handoff["files"])
        pins.add([SOURCE / name for name in handoff["files"]])
        verify_originals(helper)
        guard = ProcessGuard(process)
        pinned_module(SOURCE / "mapped_probe_identity.py", MAPPED_IDENTITY_SHA256, "mapped_probe_identity")
        if args.internal == "modules":
            api = runpy.run_path(str(SOURCE / "load-native-eye-output.py"))
            old_api = runpy.run_path(str(SOURCE / "load-native-trace.py"))
            print(json.dumps(_fixed_module_observation(process, api, old_api)))
            return 0
        if args.internal == "scene":
            script = SOURCE / "check-loaded-scene.py"
            sys.argv = [str(script), str(process["pid"])]
            runpy.run_path(str(script), run_name="__main__")
            return 0
        state, process = _internal_outer(args.internal, args.pid, args.filetime, args.attempt)
        original_host, original_store = helper.WindowsHost(), helper.Store(SOURCE)
        status = {"session": helper.summary(original_store.load(), original_store),
                  "operationLockPresent": plain_path(original_store.lock).exists(),
                  "games": original_host.games(), "proxyState": original_host.proxy_state()}
        session = waiting_session(status)
        if session["sessionId"] != state["starterSessionId"] or not same_process(session["process"], process):
            raise Blocked("The original starter no longer owns this exact waiting game.")
        if args.internal == "stock":
            destination = plain_path(SOURCE / ("stock-dxgi-%d.json" % process["pid"]))
            if destination.exists():
                raise Blocked("An existing stock-DXGI receipt cannot be overwritten.")
            _internal_outer("stock", args.pid, args.filetime, None)
            write_new(RUN_DIRECTORY / "stock-child-consumed.json", json_bytes({"runId": state["runId"],
                      "pid": process["pid"], "createdFileTime": process["createdFileTime"], "utc": utc()}))
            if destination.exists() or not guard.alive():
                raise Blocked("Stock-DXGI receipt/process changed during admission.")
            script = SOURCE / "check-stock-dxgi.py"
            sys.argv = [str(script), str(process["pid"])]
            runpy.run_path(str(script), run_name="__main__")
            return 0
        if args.internal != "load":
            raise Blocked("Unregistered internal operation.")
        for item in plain_path(SOURCE).iterdir():
            if item.name.lower().startswith("native-eye-output-") and item.name.lower().endswith(".jsonl"):
                raise Blocked("A native capture already exists; the loader is not admitted.")
        if helper.digest(SOURCE / "load-native-eye-output.py") != LOADER_SHA256 or helper.digest(SOURCE / "native-eye-output.dll") != DLL_SHA256:
            raise Blocked("Reviewed loader/DLL identity differs.")
        _internal_outer("load", args.pid, args.filetime, args.attempt)
        # This exclusive marker consumes this native invocation before any of
        # the reviewed loader's remote-process mutation can occur.
        write_new(RUN_DIRECTORY / "loader-child-consumed.json", json_bytes({
            "runId": state["runId"], "starterSessionId": state["starterSessionId"],
            "attemptToken": args.attempt, "pid": process["pid"], "createdFileTime": process["createdFileTime"],
            "reviewedDllSha256": DLL_SHA256, "loaderSha256": LOADER_SHA256, "utc": utc()}))
        _internal_outer("load", args.pid, args.filetime, args.attempt)
        if not guard.alive() or plain_path(SOURCE / ("native-eye-output-%d.jsonl" % process["pid"])).exists():
            raise Blocked("Capture path/process changed immediately before the reviewed loader.")
        script = SOURCE / "load-native-eye-output.py"
        sys.argv = [str(script), "--pid", str(process["pid"]), "--expected-process-created-filetime",
                    process["createdFileTime"], "--expected-dll-sha256", DLL_SHA256, "--probe", "native-eye-output"]
        runpy.run_path(str(script), run_name="__main__")
        return 0
    finally:
        if guard is not None:
            guard.close()
        pins.close()


def native_error(message):
    """A missing GUI/dependency must be visible before any game mutation."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        user = ctypes.WinDLL(r"C:\Windows\System32\user32.dll", use_last_error=True)
        user.MessageBoxW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT]
        user.MessageBoxW.restype = ctypes.c_int
        user.MessageBoxW(None, str(message), "Stephanos Starfield monitor test", 0x10)
    else:
        print(str(message), file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--internal", choices=sorted(INTERNAL_ACTIONS))
    parser.add_argument("--pid", type=int)
    parser.add_argument("--filetime")
    parser.add_argument("--attempt")
    args = parser.parse_args(argv)
    if args.internal:
        return internal_main(args)
    if any(value is not None for value in (args.pid, args.filetime, args.attempt)):
        raise Blocked("Process arguments are only accepted by fixed internal child operations.")
    if os.name != "nt" or not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode):
        raise Blocked("Use the Hybrid / Stephanos VR button on the existing Windows Battle Bridge.")
    raise Blocked("This core has no separate launcher. Use the Hybrid / Stephanos VR button.")


if __name__ == "__main__":
    child_invocation = "--internal" in sys.argv
    try:
        sys.exit(main())
    except Exception as error:
        if child_invocation:
            print(json.dumps({"status": "BLOCKED", "error": str(error), "noAutomaticRetry": True}), file=sys.stderr)
        else:
            native_error("The monitor test could not continue.\n\n" + str(error) + "\n\nNo automatic retry will run.")
        sys.exit(2)
