"""Fixed Starfield paired-observer build, called only by the existing mailbox.

The recipe is committed source. This module has no command/path selection CLI,
network client, game launcher, loader, provider switch or automatic lock repair.
Private source is read from the existing workbench and reconstructed in a new
build directory. Only hashes and a closed proof record leave this process.
"""
from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import sys
import time
import types


SCHEMA = "stephanos.starfield-native-build.v1"
STAGE = "paired-source-observe-v1"
PACKAGE = "VR-Research-Lab/native/starfield-paired-observer-v1/"
RECIPE = PACKAGE + "build-recipe.json"
ENTRY = "scripts/windows/starfield-native-build/native_build.py"
JOB = "scripts/windows/starfield-native-build/owned_job.py"
LAUNCHER = "scripts/windows/starfield-native-build/start_native_build.ps1"
RUNTIME_MODULE = "scripts/windows/starfield-native-build/pinned_python_runtime.ps1"
RUNTIME_MANIFEST = "scripts/windows/starfield-native-build/python_runtime_v1.json"
FIXED_MEMBERS = (ENTRY, JOB, RECIPE, LAUNCHER, RUNTIME_MODULE, RUNTIME_MANIFEST)
BUILDER = PACKAGE + "reconstruct_paired_observer.py"
ORIGINAL_PACKAGE = "1ea602071f2452f0afc70de1b9a63e6e99ef765f9edccb160b1c8a8f9ffca951"
EXPECTED_ARTIFACTS = (
    "test-scoped-eye-ledger.exe", "test-paired-scoped-eye-ledger.exe",
    "test-paired-source-observation.exe", "native-paired-source-observe-test.exe",
    "native-paired-source-observe.dll",
)
REQUEST = re.compile(r"[a-z0-9][a-z0-9-]{7,95}\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")
MEMBER = re.compile(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\Z")
FALSE_CLAIMS = {
    "arbitraryShellAllowed": False, "arbitraryPathAllowed": False,
    "arbitraryExecutableAllowed": False, "providerMutationAllowed": False,
    "sourceMutationAllowed": False, "launchAllowed": False,
    "pixelsCaptured": False, "gpuCommandsIssued": False,
    "openXrSubmitted": False, "headsetPlaytestReady": False,
}


class BuildBlocked(RuntimeError):
    pass


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise BuildBlocked("DUPLICATE_JSON_FIELD")
            result[key] = value
        return result

    def constant(_value):
        raise BuildBlocked("NONFINITE_JSON_VALUE")

    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError) as error:
        raise BuildBlocked("INVALID_JSON") from error


def validate_packet(packet):
    required = {"schemaVersion", "sourceHead", "requestId", "stage", "sourceClosureSha256",
                "parentPid", "parentBirthFileTime", "launcherPid", "launcherBirthFileTime", "files"}
    if not isinstance(packet, dict) or set(packet) != required:
        raise BuildBlocked("INPUT_FIELDS_INVALID")
    if (packet["schemaVersion"] != "stephanos.starfield-native-build-input.v1"
            or packet["stage"] != STAGE or not isinstance(packet["sourceHead"], str) or not SHA.fullmatch(packet["sourceHead"])
            or not isinstance(packet["requestId"], str) or not REQUEST.fullmatch(packet["requestId"])
            or not isinstance(packet["sourceClosureSha256"], str) or not SHA256.fullmatch(packet["sourceClosureSha256"])
            or type(packet["parentPid"]) is not int or not 0 < packet["parentPid"] <= 0xFFFFFFFF
            or not isinstance(packet["parentBirthFileTime"], str)
            or not re.fullmatch(r"[1-9][0-9]{0,19}", packet["parentBirthFileTime"])
            or int(packet["parentBirthFileTime"]) > 0xFFFFFFFFFFFFFFFF
            or type(packet["launcherPid"]) is not int or not 0 < packet["launcherPid"] <= 0xFFFFFFFF
            or not isinstance(packet["launcherBirthFileTime"], str)
            or not re.fullmatch(r"[1-9][0-9]{0,19}", packet["launcherBirthFileTime"])
            or int(packet["launcherBirthFileTime"]) > 0xFFFFFFFFFFFFFFFF):
        raise BuildBlocked("INPUT_IDENTITY_INVALID")
    records = packet["files"]
    if not isinstance(records, dict) or not 9 <= len(records) <= 30:
        raise BuildBlocked("SOURCE_CLOSURE_INVALID")
    verified = {}
    total = 0
    for path, row in records.items():
        if (path not in FIXED_MEMBERS
                and not re.fullmatch(re.escape(PACKAGE) + r"[A-Za-z0-9_-]+\.(?:py|h|cpp|cmd|json)", path)):
            raise BuildBlocked("SOURCE_MEMBER_REFUSED")
        if not isinstance(row, dict) or set(row) != {"bytes", "sha256", "gitBlob", "base64"}:
            raise BuildBlocked("SOURCE_RECORD_INVALID")
        if (type(row["bytes"]) is not int or not 0 < row["bytes"] <= 256 * 1024
                or not isinstance(row["sha256"], str) or not SHA256.fullmatch(row["sha256"])
                or not isinstance(row["gitBlob"], str) or not SHA.fullmatch(row["gitBlob"])
                or not isinstance(row["base64"], str) or len(row["base64"]) > 350000):
            raise BuildBlocked("SOURCE_RECORD_BOUND")
        try:
            raw = base64.b64decode(row["base64"], validate=True)
        except (ValueError, TypeError) as error:
            raise BuildBlocked("SOURCE_ENCODING_INVALID") from error
        blob = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
        if len(raw) != row["bytes"] or digest(raw) != row["sha256"] or blob != row["gitBlob"]:
            raise BuildBlocked("SOURCE_BYTES_CHANGED")
        verified[path] = raw
        total += len(raw)
    if total > 1536 * 1024 or any(path not in verified for path in (*FIXED_MEMBERS, BUILDER)):
        raise BuildBlocked("SOURCE_CLOSURE_BOUND")
    calculated = digest("".join(path + "\0" + digest(verified[path]) + "\n" for path in sorted(verified)).encode())
    if calculated != packet["sourceClosureSha256"]:
        raise BuildBlocked("SOURCE_CLOSURE_CHANGED")
    recipe = strict_json(verified[RECIPE])
    if (not isinstance(recipe, dict)
            or set(recipe) != {"schemaVersion", "stage", "originalPackageSha256", "publicMembers"}
            or recipe["schemaVersion"] != "stephanos.starfield-native-build-recipe.v1"
            or recipe["stage"] != STAGE or recipe["originalPackageSha256"] != ORIGINAL_PACKAGE
            or not isinstance(recipe["publicMembers"], list) or not 3 <= len(recipe["publicMembers"]) <= 24):
        raise BuildBlocked("RECIPE_INVALID")
    expected = set(FIXED_MEMBERS)
    seen = set()
    for row in recipe["publicMembers"]:
        if (not isinstance(row, dict) or set(row) != {"path", "sha256"}
                or not isinstance(row["path"], str) or not row["path"].startswith(PACKAGE)
                or row["path"].casefold() in seen or row["path"] not in verified
                or row["path"] == RECIPE or row["sha256"] != digest(verified[row["path"]])):
            raise BuildBlocked("RECIPE_MEMBER_INVALID")
        expected.add(row["path"])
        seen.add(row["path"].casefold())
    if set(verified) != expected:
        raise BuildBlocked("RECIPE_CLOSURE_MISMATCH")
    return verified, recipe


def load_verified(name, path, raw):
    module = types.ModuleType(name)
    module.__file__ = path
    sys.modules[name] = module
    exec(compile(raw, path, "exec"), module.__dict__)
    return module


def safe_relative(value):
    if (not isinstance(value, str) or not MEMBER.fullmatch(value)
            or any(part in (".", "..") or part.endswith('.')
                   or re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part, re.IGNORECASE)
                   for part in value.split('/'))
            or ":" in value or "\\" in value):
        raise BuildBlocked("RELATIVE_MEMBER_INVALID")
    return value


def require_plain(path, *, directory=False):
    path = Path(path)
    for candidate in (path,) + tuple(path.parents):
        info = candidate.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise BuildBlocked("REPARSE_PATH_REFUSED")
    info = path.stat()
    if directory:
        if not stat.S_ISDIR(info.st_mode):
            raise BuildBlocked("DIRECTORY_REQUIRED")
    elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise BuildBlocked("PLAIN_SINGLE_LINK_FILE_REQUIRED")
    return info


class _FileTime(ctypes.Structure):
    _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]


class _FileInformation(ctypes.Structure):
    _fields_ = [("attributes", ctypes.c_uint32), ("created", _FileTime),
                ("accessed", _FileTime), ("written", _FileTime),
                ("volume", ctypes.c_uint32), ("size_high", ctypes.c_uint32),
                ("size_low", ctypes.c_uint32), ("links", ctypes.c_uint32),
                ("index_high", ctypes.c_uint32), ("index_low", ctypes.c_uint32)]


class NativePins:
    """Deny replacement of observed ancestors and writes to selected inputs."""
    def __init__(self):
        self.kernel = ctypes.WinDLL(r"C:\Windows\System32\kernel32.dll", use_last_error=True)
        self.kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
            ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        self.kernel.CreateFileW.restype = wintypes.HANDLE
        self.kernel.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(_FileInformation)]
        self.kernel.GetFileInformationByHandle.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.directories = {}
        self.streams = []

    def pin_parents(self, path):
        for parent in reversed(tuple(Path(path).parents)):
            key = str(parent).casefold()
            if key in self.directories:
                continue
            require_plain(parent, directory=True)
            # FILE_LIST_DIRECTORY participates in sharing checks; attributes-only
            # access would not enforce the omitted FILE_SHARE_DELETE permission.
            handle = self.kernel.CreateFileW(str(parent), 0x81, 3, None, 3, 0x02200000, None)
            if handle in (None, ctypes.c_void_p(-1).value):
                raise BuildBlocked("ANCESTOR_PIN_FAILED")
            info = _FileInformation()
            if (not self.kernel.GetFileInformationByHandle(handle, ctypes.byref(info))
                    or info.attributes & 0x400 or not info.attributes & 0x10):
                self.kernel.CloseHandle(handle)
                raise BuildBlocked("ANCESTOR_IDENTITY_UNPROVEN")
            self.directories[key] = handle

    def read(self, path, maximum):
        import msvcrt
        self.pin_parents(path)
        require_plain(path)
        handle = self.kernel.CreateFileW(str(path), 0x80000000, 1, None, 3, 0x00200000, None)
        if handle in (None, ctypes.c_void_p(-1).value):
            raise BuildBlocked("INPUT_PIN_FAILED")
        try:
            info = _FileInformation()
            if (not self.kernel.GetFileInformationByHandle(handle, ctypes.byref(info))
                    or info.attributes & 0x410 or info.links != 1
                    or (info.size_high << 32 | info.size_low) > maximum):
                raise BuildBlocked("INPUT_IDENTITY_UNPROVEN")
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
            handle = None
            stream = os.fdopen(fd, "rb")
            self.streams.append(stream)
            raw = stream.read(maximum + 1)
            if len(raw) > maximum:
                raise BuildBlocked("INPUT_READ_BOUND")
            return raw
        finally:
            if handle is not None:
                self.kernel.CloseHandle(handle)

    def close(self):
        for stream in reversed(self.streams):
            stream.close()
        for handle in reversed(list(self.directories.values())):
            self.kernel.CloseHandle(handle)
        self.streams.clear()
        self.directories.clear()


class ActiveBuild:
    def __init__(self, directory, packet):
        require_plain(directory, directory=True)
        self.path = directory / "active.json"
        self.kernel = None
        self.keeper = None
        self.delete_pending = False
        self.release_committed = False
        try:
            if os.name == "nt":
                import msvcrt
                self.kernel = ctypes.WinDLL(r"C:\Windows\System32\kernel32.dll", use_last_error=True)
                self.kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                    ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
                self.kernel.CreateFileW.restype = wintypes.HANDLE
                self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                self.kernel.CloseHandle.restype = wintypes.BOOL
                self.kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
                self.kernel.SetFileInformationByHandle.restype = wintypes.BOOL
                self.kernel.GetCurrentProcess.argtypes = []
                self.kernel.GetCurrentProcess.restype = wintypes.HANDLE
                self.kernel.DuplicateHandle.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE,
                    ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                self.kernel.DuplicateHandle.restype = wintypes.BOOL
                # DELETE access belongs to this exact new handle; other opens
                # may read, but cannot replace or write the current owner file.
                handle = self.kernel.CreateFileW(str(self.path), 0xC0010000, 1, None, 1, 0x00200000, None)
                if handle in (None, ctypes.c_void_p(-1).value):
                    raise BuildBlocked("PRIOR_BUILD_CUSTODY_UNRESOLVED")
                try:
                    duplicate = wintypes.HANDLE()
                    process = self.kernel.GetCurrentProcess()
                    if not self.kernel.DuplicateHandle(process, handle, process, ctypes.byref(duplicate), 0, False, 2):
                        raise BuildBlocked("CUSTODY_KEEPER_UNPROVEN")
                    self.keeper = duplicate.value
                    fd = msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY)
                except Exception:
                    self.kernel.CloseHandle(handle)
                    self.close_keeper()
                    raise
                self.stream = os.fdopen(fd, "w+b")
            else:
                # Portable fixture seam only; production run_build rejects it.
                self.stream = self.path.open("xb+")
        except FileExistsError as error:
            raise BuildBlocked("PRIOR_BUILD_CUSTODY_UNRESOLVED") from error
        self.identity = os.fstat(self.stream.fileno())
        self.record = {"schemaVersion": "stephanos.starfield-native-build-custody.v1",
            "requestId": packet["requestId"], "sourceHead": packet["sourceHead"],
            "sourceClosureSha256": packet["sourceClosureSha256"], "parentPid": packet["parentPid"],
            "parentBirthFileTime": packet["parentBirthFileTime"], "workerGoal": 1595,
            "missionGoal": 1769, "stage": STAGE, "state": "RESERVED", "root": None,
            "executionCustodyReleased": False}
        self.write()

    def write(self):
        raw = json.dumps(self.record, sort_keys=True, separators=(",", ":")).encode()
        if len(raw) > 32768:
            raise BuildBlocked("CUSTODY_RECORD_BOUND")
        current = self.path.lstat()
        if (current.st_ino, current.st_dev) != (self.identity.st_ino, self.identity.st_dev):
            raise BuildBlocked("CUSTODY_PATH_CHANGED")
        self.stream.seek(0)
        self.stream.write(raw)
        self.stream.truncate()
        self.stream.flush()
        os.fsync(self.stream.fileno())

    def bind(self, identity):
        # The native runner calls this while the root is still suspended in its
        # owned Job. A flushed record is required before it may resume.
        self.record["state"] = "ROOT_SUSPENDED_IN_OWNED_JOB"
        self.record["root"] = dict(identity)
        self.write()
        return True

    def finish(self, receipt):
        release = (receipt["executionCustodyReleased"] is True and receipt["allJobsEmpty"] is True
                   and receipt["originalSourceUnchanged"] is True and receipt.get("terminalFinalized") is True)
        # This on-disk owner remains an exclusion record until its exact native
        # handle is released. It never advertises release while still present.
        self.record["state"] = ("TERMINAL_DURABLE_RELEASE_PENDING" if release
                                else "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD")
        self.record["executionCustodyReleased"] = False
        self.record["allJobsEmpty"] = receipt["allJobsEmpty"]
        self.write()
        # A separate retained native handle keeps exclusion through Python's
        # buffered-stream close, including a close exception.
        self.stream.close()
        if release:
            if self.kernel is None or self.keeper is None:
                raise BuildBlocked("CUSTODY_RELEASE_REQUIRES_WINDOWS")
            disposition = ctypes.c_ubyte(1)
            if not self.kernel.SetFileInformationByHandle(self.keeper, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)):
                raise BuildBlocked("CUSTODY_HANDLE_RELEASE_FAILED")
            self.delete_pending = True
            if not self.kernel.CloseHandle(self.keeper):
                # A failed close must not leave a delete-on-close request on
                # a retained keeper that will later disappear at worker exit.
                clear = ctypes.c_ubyte(0)
                if self.kernel.SetFileInformationByHandle(self.keeper, 4, ctypes.byref(clear), ctypes.sizeof(clear)):
                    self.delete_pending = False
                raise BuildBlocked("CUSTODY_KEEPER_CLOSE_FAILED")
            self.keeper = None
            self.delete_pending = False
            self.release_committed = True
            return True
        self.close_keeper()
        return False

    def close_keeper(self):
        if self.keeper is not None:
            if self.delete_pending:
                clear = ctypes.c_ubyte(0)
                if not self.kernel.SetFileInformationByHandle(self.keeper, 4, ctypes.byref(clear), ctypes.sizeof(clear)):
                    raise BuildBlocked("CUSTODY_DELETE_RESET_UNPROVEN")
                self.delete_pending = False
            if not self.kernel.CloseHandle(self.keeper):
                raise BuildBlocked("CUSTODY_KEEPER_CLOSE_FAILED")
            self.keeper = None

    def close(self):
        try:
            if hasattr(self, "stream"):
                self.stream.close()
        finally:
            self.close_keeper()


def base_receipt(packet):
    return {"schemaVersion": SCHEMA, "sourceHead": packet["sourceHead"],
        "requestId": packet["requestId"], "stage": STAGE,
        "sourceClosureSha256": packet["sourceClosureSha256"],
        "recipeSha256": packet["files"][RECIPE]["sha256"],
        "finalVerdict": "STARFIELD_VR_NATIVE_BUILD_BLOCKED", "reason": "BUILD_NOT_STARTED",
        "originalSourceVerified": False, "originalSourceUnchanged": False,
        "sourceClosureVerified": True, "isolatedBuildCreated": False,
        "toolchainObserved": False, "buildPassed": False, "testsPassed": False,
        "allJobsEmpty": True, "executionCustodyReleased": True,
        "terminalFinalized": False,
        "outputComplete": True, "stagesCompleted": 0, "artifacts": [],
        "workerGoal": 1595, "missionGoal": 1769, **FALSE_CLAIMS}


def fixed_roots():
    user = Path(r"C:\Users\Stephan Callear")
    if Path(os.environ.get("USERPROFILE", "")).as_posix().casefold() != user.as_posix().casefold():
        raise BuildBlocked("FIXED_USER_PROFILE_REQUIRED")
    workbench = user / "Documents" / "Codex" / "2026-11-05" / "starfield-vr-did-not-start-and"
    return (workbench / "work" / "stephanos-openxr",
            workbench / "work" / "native-paired-observer-builds-v1",
            user / "Documents" / "Stephanos-openclaw-workspace")


def continuing_cpu_probe_admitted(state, now, observe_owner):
    """Consume only the governor's bounded grant for an already-running CPU Job.

    A persisted PID/boolean is not live ownership. The production caller supplies
    the existing exact-birth Win32 observer; initial admission never calls this.
    Model permissions and unknown/abandoned native custody remain restrictive.
    """
    import datetime
    if not callable(observe_owner):
        return False
    grant = state.get("cpuProbeContinuity")
    keys = {"schemaVersion", "cycleId", "phase", "allowed", "observedAtUtc", "expiresAtUtc",
            "priorObservationAtUtc", "ownerProcessId", "ownerCreationFileTime", "machineHash", "bootIdentifier"}
    if (not isinstance(grant, dict) or set(grant) != keys
            or grant["schemaVersion"] != "stephanos.governor-cpu-probe-continuity.v1"
            or grant["phase"] != "IDLE_READ_ONLY_RECONCILE" or grant["allowed"] is not True
            or not isinstance(grant["cycleId"], str) or not re.fullmatch(r"[a-f0-9]{32}", grant["cycleId"])
            or type(grant["ownerProcessId"]) is not int or not 0 < grant["ownerProcessId"] <= 0xffffffff
            or not isinstance(grant["ownerCreationFileTime"], str)
            or not re.fullmatch(r"[1-9][0-9]{0,19}", grant["ownerCreationFileTime"])
            or int(grant["ownerCreationFileTime"]) > 0xffffffffffffffff
            or not isinstance(grant["machineHash"], str) or not SHA256.fullmatch(grant["machineHash"])
            or not isinstance(grant["bootIdentifier"], str)
            or not re.fullmatch(r"[a-f0-9]{32}", grant["bootIdentifier"])
            or grant["bootIdentifier"] == "0" * 32):
        return False
    try:
        dates = []
        for key in ("observedAtUtc", "expiresAtUtc", "priorObservationAtUtc"):
            value = grant[key]
            if not isinstance(value, str) or not re.search(r"(?:Z|[+-][0-9]{2}:[0-9]{2})\Z", value):
                return False
            dates.append(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")))
        observed, expires, prior = dates
        if (not observed <= now < expires or not 0 < (expires - observed).total_seconds() <= 5
                or not 0 <= (observed - prior).total_seconds() <= 10
                or not 0 <= (now - prior).total_seconds() <= 15
                or grant["priorObservationAtUtc"] != state["updatedAtUtc"]):
            return False
        if (type(state.get("nativeProbeCustodyHeld")) is not bool
                or state.get("localModelAllowed") is not False or state.get("heavyModelAllowed") is not False
                or state.get("dependencyObservationKnown") is not False or state.get("evictionHealthy") is not False
                or state.get("ollamaLoadMode") != "unknown"):
            return False
        attempt = state.get("nativeProbeAttempt")
        attempt_keys = {"schemaVersion", "attemptId", "operation", "commandSha256", "phase", "ownerProcessId",
                        "ownerCreationFileTime", "machineHash", "bootIdentifier", "preparedAtUtc"}
        if (not isinstance(attempt, dict) or set(attempt) != attempt_keys
                or attempt.get("schemaVersion") != "stephanos.governor-probe-attempt.v1"
                or not isinstance(attempt.get("attemptId"), str)
                or not re.fullmatch(r"[a-f0-9]{32}", attempt["attemptId"])
                or attempt.get("operation") not in ("GpuSnapshot", "OllamaInventory")
                or type(attempt.get("ownerProcessId")) is not int or attempt["ownerProcessId"] != grant["ownerProcessId"]
                or not isinstance(attempt.get("commandSha256"), str) or not SHA256.fullmatch(attempt["commandSha256"])
                or not isinstance(attempt.get("preparedAtUtc"), str)
                or not re.search(r"(?:Z|[+-][0-9]{2}:[0-9]{2})\Z", attempt["preparedAtUtc"])):
            return False
        prepared = datetime.datetime.fromisoformat(attempt["preparedAtUtc"].replace("Z", "+00:00"))
        if not observed <= prepared <= now:
            return False
        if attempt.get("phase") == "PREPARING":
            if (state["nativeProbeCustodyHeld"] is not True or type(attempt.get("ownerCreationFileTime")) is not int
                    or attempt["ownerCreationFileTime"] != 0 or attempt.get("machineHash") != "UNOBSERVED"
                    or attempt.get("bootIdentifier") != "UNOBSERVED"):
                return False
        elif attempt.get("phase") == "BOUND":
            if (type(attempt.get("ownerCreationFileTime")) is not int
                    or str(attempt["ownerCreationFileTime"]) != grant["ownerCreationFileTime"]
                    or attempt.get("machineHash") != grant["machineHash"]
                    or attempt.get("bootIdentifier") != grant["bootIdentifier"]):
                return False
        else:
            return False
        owner = observe_owner(grant["ownerProcessId"], grant["ownerCreationFileTime"])
        return (observed <= datetime.datetime.now(datetime.timezone.utc) < expires
                and isinstance(owner, dict) and owner.get("ok") is True and owner.get("alive") is True
                and type(owner.get("pid")) is int and owner["pid"] == grant["ownerProcessId"]
                and owner.get("created_filetime") == grant["ownerCreationFileTime"])
    except (ValueError, KeyError, TypeError, OSError):
        return False


def _gaming_admitted_once(workspace, *, probe_owner_observer=None):
    directory = workspace / "vr"
    require_plain(directory, directory=True)
    if entry_present(directory / "gaming-resource-prepare.json"):
        raise BuildBlocked("GAMING_PREPARATION_ACTIVE")
    state_path = directory / "vr-resource-governor-current.json"
    state = bounded_json_file(state_path)
    import datetime
    try:
        if not isinstance(state.get("updatedAtUtc"), str) or not re.search(r"(?:Z|[+-][0-9]{2}:[0-9]{2})\Z", state["updatedAtUtc"]):
            raise BuildBlocked("GAMING_CLOCK_UNPROVEN")
        observed = datetime.datetime.fromisoformat(state["updatedAtUtc"].replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        age = (now - observed).total_seconds()
    except (ValueError, KeyError, TypeError) as error:
        raise BuildBlocked("GAMING_CLOCK_UNPROVEN") from error
    flags = ("active", "flatGameActive", "airLinkActive", "realAirLinkActive", "virtualAirLinkTestActive", "prepareLeaseActive")
    if (state.get("schemaVersion") != "stephanos.vr-resource-governor.v1"
            or type(state.get("governorVersion")) is not int or state["governorVersion"] != 3 or not 0 <= age <= 30
            or any(state.get(key) is not False for key in flags)
            or state.get("phase") != "NORMAL" or state.get("overrideMode") != "AUTO"
            or state.get("cooldownUntilUtc") != ""):
        raise BuildBlocked("GAMING_PERMISSION_HELD")
    if (state.get("ollamaLoadMode") != "balanced" or state.get("localModelAllowed") is not True
            or state.get("heavyModelAllowed") is not True or state.get("nativeProbeCustodyHeld") is not False
            or state.get("dependencyObservationKnown") is not True or state.get("evictionHealthy") is not True):
        if not continuing_cpu_probe_admitted(state, now, probe_owner_observer):
            raise BuildBlocked("GAMING_PERMISSION_HELD")
        # The native observation must bind the same complete canonical record.
        if bounded_json_file(state_path) != state:
            raise BuildBlocked("GAMING_STATE_CHANGED")
    override = directory / "gaming-resource-override.json"
    if entry_present(override):
        data = bounded_json_file(override)
        if data.get("schemaVersion") != "stephanos.gaming-resource-override.v1" or data.get("mode") != "AUTO":
            raise BuildBlocked("GAMING_OVERRIDE_UNPROVEN")
    if entry_present(directory / "gaming-resource-prepare.json"):
        raise BuildBlocked("GAMING_PREPARATION_ACTIVE")
    return True


def gaming_admitted(workspace, *, probe_owner_observer=None):
    # Atomic publisher replacement and a probe's PREPARING -> BOUND transition
    # can race the read. Discard that observation and validate a complete fresh
    # one; never retry an observed policy denial or reuse a prior grant.
    started = time.monotonic()
    for _ in range(3):
        if time.monotonic() - started >= 0.1:
            raise BuildBlocked("GAMING_STATE_CHANGED")
        try:
            admitted = _gaming_admitted_once(workspace, probe_owner_observer=probe_owner_observer)
        except BuildBlocked as error:
            if str(error) != "GAMING_STATE_CHANGED":
                raise
            continue
        if time.monotonic() - started >= 0.1:
            raise BuildBlocked("GAMING_STATE_CHANGED")
        return admitted
    raise BuildBlocked("GAMING_STATE_CHANGED")


def wait_for_ordinary_gaming_admission(workspace):
    # Only before native execution. A periodic probe is not initial permission:
    # wait at most one second for the unchanged ordinary predicate to pass.
    started = time.monotonic()
    for attempt in range(11):
        if time.monotonic() - started >= 1:
            raise BuildBlocked("GAMING_PERMISSION_HELD")
        try:
            admitted = gaming_admitted(workspace)
        except BuildBlocked as error:
            if str(error) != "GAMING_PERMISSION_HELD":
                raise
            if attempt < 10:
                time.sleep(0.1)
            continue
        if time.monotonic() - started >= 1:
            raise BuildBlocked("GAMING_PERMISSION_HELD")
        return admitted
    raise BuildBlocked("GAMING_PERMISSION_HELD")


def entry_present(path):
    try:
        path.lstat()
        return True
    except FileNotFoundError:
        return False


def bounded_json_file(path):
    before = require_plain(path)
    if not 2 <= before.st_size <= 32768:
        raise BuildBlocked("GAMING_STATE_BOUND")
    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_ino, opened.st_dev) != (before.st_ino, before.st_dev) or not stat.S_ISREG(opened.st_mode):
            raise BuildBlocked("GAMING_STATE_CHANGED")
        raw = stream.read(32769)
        if not 2 <= len(raw) <= 32768 or os.fstat(stream.fileno()).st_size != len(raw):
            raise BuildBlocked("GAMING_STATE_BOUND")
        after = require_plain(path)
        if (after.st_ino, after.st_dev) != (opened.st_ino, opened.st_dev):
            raise BuildBlocked("GAMING_STATE_CHANGED")
    value = strict_json(raw)
    if not isinstance(value, dict):
        raise BuildBlocked("GAMING_STATE_INVALID")
    return value


def source_records(builder):
    records = getattr(builder, "ORIGINAL_FILES", None)
    if not isinstance(records, dict) or not 5 <= len(records) <= 160:
        raise BuildBlocked("ORIGINAL_MANIFEST_INVALID")
    seen = set()
    for path, row in records.items():
        safe_relative(path)
        if (path.casefold() in seen or not isinstance(row, dict) or set(row) != {"sha256", "bytes"}
                or not isinstance(row["sha256"], str) or not SHA256.fullmatch(row["sha256"]) or type(row["bytes"]) is not int
                or not 0 < row["bytes"] <= 8 * 1024 * 1024):
            raise BuildBlocked("ORIGINAL_MANIFEST_MEMBER_INVALID")
        seen.add(path.casefold())
    if sum(row["bytes"] for row in records.values()) > 32 * 1024 * 1024:
        raise BuildBlocked("ORIGINAL_SOURCE_BOUND")
    return records


def verify_originals(root, records, pins=None):
    for name, row in records.items():
        path = root / name
        if pins:
            raw = pins.read(path, row["bytes"])
        else:
            info = require_plain(path)
            if info.st_size != row["bytes"]:
                raise BuildBlocked("ORIGINAL_SOURCE_CHANGED")
            with path.open("rb") as stream:
                raw = stream.read(row["bytes"] + 1)
        if len(raw) != row["bytes"] or digest(raw) != row["sha256"]:
            raise BuildBlocked("ORIGINAL_SOURCE_CHANGED")


def toolchain(pins):
    root = Path(r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC")
    version_file = root / "Auxiliary" / "Build" / "Microsoft.VCToolsVersion.default.txt"
    version = pins.read(version_file, 128).decode("utf-8-sig").strip()
    if not re.fullmatch(r"14\.[0-9]{1,3}\.[0-9]{1,8}", version):
        raise BuildBlocked("TOOLCHAIN_VERSION_INVALID")
    compiler = root / "Tools" / "MSVC" / version / "bin" / "Hostx64" / "x64" / "cl.exe"
    paths = [version_file, root / "Auxiliary" / "Build" / "vcvars64.bat",
             root / "Auxiliary" / "Build" / "vcvarsall.bat", compiler, compiler.with_name("link.exe")]
    observed = {path.name: digest(pins.read(path, 16 * 1024 * 1024)) for path in paths}
    return compiler, observed


def fixed_environment(compiler, staging):
    # Start from a small OS/user environment. Compiler flags, Python hooks,
    # provider credentials, Node hooks and build caches are not inherited.
    allowed = ("APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
               "SYSTEMDRIVE", "SYSTEMROOT", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR")
    env = {}
    for name in allowed:
        value = next((v for k, v in os.environ.items() if k.upper() == name), None)
        if value is not None:
            if len(value) > 4096 or any(char in value for char in "\0\r\n"):
                raise BuildBlocked("ENVIRONMENT_INVALID")
            env[name] = value
    temporary = staging / "compiler-temp"
    temporary.mkdir()
    env.update({"PATH": r"C:\Windows\System32;C:\Windows", "PATHEXT": ".COM;.EXE;.BAT;.CMD",
                "COMSPEC": r"C:\Windows\System32\cmd.exe", "TEMP": str(temporary), "TMP": str(temporary),
                "STEPH_OBSERVER_EXPECTED_CL": str(compiler)})
    return env


def verify_staged(staging, result):
    if (not isinstance(result, dict) or result.get("buildCommand") != "build-paired-source-observe.cmd"
            or not isinstance(result.get("files"), dict) or not 5 <= len(result["files"]) <= 180
            or not isinstance(result.get("artifacts"), list) or not 2 <= len(result["artifacts"]) <= 8):
        raise BuildBlocked("RECONSTRUCTION_RECEIPT_INVALID")
    seen = set()
    for name, row in result["files"].items():
        safe_relative(name)
        if name.casefold() in seen or not isinstance(row, dict) or set(row) != {"sha256", "bytes"}:
            raise BuildBlocked("RECONSTRUCTION_MEMBER_INVALID")
        seen.add(name.casefold())
        info = require_plain(staging / name)
        if (type(row["bytes"]) is not int or not 0 < row["bytes"] <= 8 * 1024 * 1024
                or info.st_size != row["bytes"] or digest((staging / name).read_bytes()) != row["sha256"]):
            raise BuildBlocked("RECONSTRUCTION_BYTES_CHANGED")
    actual = {path.relative_to(staging).as_posix() for path in staging.rglob("*") if path.is_file()}
    if actual != set(result["files"]):
        raise BuildBlocked("RECONSTRUCTION_UNDECLARED_FILE")
    if tuple(result["artifacts"]) != EXPECTED_ARTIFACTS:
        raise BuildBlocked("RECONSTRUCTION_ARTIFACT_INVALID")
    return result["artifacts"]


def run_build(packet, verified):
    receipt = base_receipt(packet)
    pins = None
    active = None
    original = None
    records = None
    stage_result = None
    terminal_directory = None
    terminal_stream = None
    try:
        if (os.name != "nt" or struct.calcsize("P") != 8 or sys.version_info < (3, 10)
                or sys.flags.isolated != 1 or sys.flags.no_site != 1
                or not sys.dont_write_bytecode or sys.flags.optimize != 0):
            raise BuildBlocked("ISOLATED_WINDOWS_PYTHON_REQUIRED")
        if os.getppid() != packet["launcherPid"]:
            raise BuildBlocked("MAILBOX_PARENT_MISMATCH")
        job = load_verified("_starfield_owned_job", JOB, verified[JOB])
        parent = job.observe_parent_identity(packet["parentPid"], packet["parentBirthFileTime"])
        if parent.get("ok") is not True or parent.get("alive") is not True:
            raise BuildBlocked("MAILBOX_PARENT_UNPROVEN")
        launcher = job.observe_parent_identity(packet["launcherPid"], packet["launcherBirthFileTime"])
        if launcher.get("ok") is not True or launcher.get("alive") is not True:
            raise BuildBlocked("BUILD_LAUNCHER_UNPROVEN")
        original, builds, workspace = fixed_roots()
        wait_for_ordinary_gaming_admission(workspace)
        require_plain(original, directory=True)
        require_plain(builds.parent, directory=True)
        pins = NativePins()
        pins.pin_parents(builds)
        if not builds.exists():
            builds.mkdir()
        require_plain(builds, directory=True)
        pins.pin_parents(builds / "active.json")
        active = ActiveBuild(builds, packet)
        selected_directory = builds / packet["requestId"]
        selected_directory.mkdir()
        require_plain(selected_directory, directory=True)
        pins.pin_parents(selected_directory / "build-terminal-proposal.json")
        # Only a newly created and pinned directory may receive a terminal.
        terminal_directory = selected_directory
        pins.pin_parents(original / "native-boundary-trace.cpp")
        pins.pin_parents(terminal_directory / "source")
        builder = load_verified("_starfield_observer_reconstruction", BUILDER, verified[BUILDER])
        records = source_records(builder)
        verify_originals(original, records, pins)
        receipt["originalSourceVerified"] = True
        compiler, observed_tools = toolchain(pins)
        receipt["toolchainObserved"] = True
        overlay = {path[len(PACKAGE):]: raw for path, raw in verified.items()
                   if path.startswith(PACKAGE) and path != RECIPE}
        staged = terminal_directory / "source"
        materialized = builder.reconstruct(original, staged, overlay)
        artifacts = verify_staged(staged, materialized)
        # The compiler consumes the same opened input identities that were
        # checked after reconstruction, including the fixed command file.
        for name, row in materialized["files"].items():
            raw = pins.read(staged / name, row["bytes"])
            if len(raw) != row["bytes"] or digest(raw) != row["sha256"]:
                raise BuildBlocked("STAGED_SOURCE_PIN_CHANGED")
        receipt["isolatedBuildCreated"] = True
        environment = fixed_environment(compiler, staged)
        wait_for_ordinary_gaming_admission(workspace)
        deadline = time.monotonic() + 600
        # Continued gaming permission is checked during the owned job. Any
        # hold cancels only this build's process tree; it never kills a game.
        admission_last = [0.0, ""]

        def cancelled(*, allow_continuation=False):
            if admission_last[1]:
                return True
            now = time.monotonic()
            # Every prelaunch/pre-resume observation is fresh and ordinary.
            # Only monitoring an actually resumed Job uses the polling cache.
            if not allow_continuation or now - admission_last[0] >= 1:
                admission_last[0] = now
                try:
                    if allow_continuation:
                        gaming_admitted(workspace, probe_owner_observer=job.observe_parent_identity)
                    else:
                        wait_for_ordinary_gaming_admission(workspace)
                    launcher = job.observe_parent_identity(packet["launcherPid"], packet["launcherBirthFileTime"])
                    if launcher.get("ok") is not True or launcher.get("alive") is not True:
                        raise BuildBlocked("BUILD_LAUNCHER_ENDED")
                except BuildBlocked as error:
                    reason = str(error)
                    admission_last[1] = (reason if re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}", reason)
                                         else "BUILD_ADMISSION_OBSERVATION_UNPROVEN")
                except Exception:
                    admission_last[1] = "BUILD_ADMISSION_OBSERVATION_UNPROVEN"
            return bool(admission_last[1])

        receipt["allJobsEmpty"] = False
        receipt["executionCustodyReleased"] = False
        receipt["outputComplete"] = False
        stage_result = job.run_owned_stage(executable=r"C:\Windows\System32\cmd.exe",
            args=["/d", "/s", "/c", "build-paired-source-observe.cmd"],
            cwd=str(staged), env=environment, deadline_monotonic=deadline, output_limit=256 * 1024,
            parent_pid=packet["parentPid"], parent_birth_filetime=packet["parentBirthFileTime"],
            cancel_requested=cancelled, running_cancel_requested=lambda: cancelled(allow_continuation=True),
            on_suspended=active.bind)
        receipt["allJobsEmpty"] = stage_result.get("zero_active_processes_observed") is True
        receipt["executionCustodyReleased"] = stage_result.get("custody_released") is True and receipt["allJobsEmpty"]
        receipt["outputComplete"] = stage_result.get("output_complete") is True
        receipt["stagesCompleted"] = int(stage_result.get("root_exited") is True and receipt["allJobsEmpty"])
        private = {"nativeStage": stage_result, "toolchainHashes": observed_tools, "materialized": materialized,
                   "admissionCancellationReason": admission_last[1]}
        private_raw = json.dumps(private, sort_keys=True, indent=2).encode()
        if len(private_raw) > 2 * 1024 * 1024:
            raise BuildBlocked("PRIVATE_PROOF_BOUND")
        with (terminal_directory / "private-build-proof.json").open("xb") as stream:
            stream.write(private_raw)
            stream.flush()
            os.fsync(stream.fileno())
        if not receipt["executionCustodyReleased"]:
            raise BuildBlocked("NATIVE_JOB_TERMINAL_UNPROVEN")
        # Admission withdrawal is a hold, even if the child races cancellation
        # and exits successfully. Never relabel it as a compiler diagnostic.
        if admission_last[1]:
            raise BuildBlocked(admission_last[1])
        if stage_result.get("timed_out") is True:
            raise BuildBlocked("NATIVE_BUILD_DEADLINE_EXCEEDED")
        if stage_result.get("cancelled") is True:
            raise BuildBlocked("NATIVE_BUILD_CANCELLED")
        if (stage_result.get("operation_ok") is not True
                or type(stage_result.get("root_exit_code")) is not int or stage_result["root_exit_code"] != 0
                or stage_result.get("root_exited") is not True or not receipt["outputComplete"]
                or "STEPHANOS_PAIRED_OBSERVER_BUILD_PASSED" not in stage_result.get("output_text", "").splitlines()):
            receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_FAILED"
            raise BuildBlocked("COMPILER_OR_SELF_TEST_FAILED")
        for name in artifacts:
            raw = pins.read(staged / name, 16 * 1024 * 1024)
            if not raw or raw[:2] != b"MZ":
                raise BuildBlocked("BUILD_ARTIFACT_INVALID")
            receipt["artifacts"].append({"name": name, "sha256": digest(raw), "bytes": len(raw)})
        receipt["buildPassed"] = True
        receipt["testsPassed"] = True
        receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_PASSED"
        receipt["reason"] = "FIXED_BUILD_AND_SELF_TESTS_PASSED"
    except Exception as error:
        reason = str(error) if isinstance(error, BuildBlocked) else "BUILD_EXCEPTION"
        receipt["reason"] = reason if re.fullmatch(r"[A-Z][A-Z0-9_]{0,95}", reason) else "BUILD_EXCEPTION"
        if not receipt["executionCustodyReleased"]:
            receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD"
    finally:
        if original is not None and records is not None and receipt["originalSourceVerified"]:
            try:
                verify_originals(original, records)
                receipt["originalSourceUnchanged"] = True
            except Exception:
                receipt["originalSourceUnchanged"] = False
                receipt["finalVerdict"] = ("STARFIELD_VR_NATIVE_BUILD_BLOCKED" if receipt["executionCustodyReleased"]
                                           else "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD")
                receipt["reason"] = "ORIGINAL_SOURCE_RECHECK_FAILED"
        if receipt["finalVerdict"] == "STARFIELD_VR_NATIVE_BUILD_PASSED" and not receipt["originalSourceUnchanged"]:
            receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_BLOCKED"
            receipt["reason"] = "ORIGINAL_SOURCE_RECHECK_FAILED"
        # A private proposal is deliberately a different schema from an
        # authenticated public result. Its complete durable write and close
        # precede owner release; it can never be consumed as a final receipt.
        if terminal_directory is not None:
            try:
                terminal_stream = (terminal_directory / "build-terminal-proposal.json").open("xb+")
                proposal = {"schemaVersion": "stephanos.starfield-native-build-terminal-proposal.v1",
                            "requestId": packet["requestId"], "sourceHead": packet["sourceHead"],
                            "candidate": {**receipt, "terminalFinalized": True}}
                terminal_stream.write(json.dumps(proposal, sort_keys=True, indent=2).encode())
                terminal_stream.flush()
                os.fsync(terminal_stream.fileno())
                terminal_stream.close()
                terminal_stream = None
                receipt["terminalFinalized"] = True
            except Exception:
                receipt["executionCustodyReleased"] = False
                receipt["terminalFinalized"] = False
                receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD"
                receipt["reason"] = "TERMINAL_RECEIPT_WRITE_FAILED"
            finally:
                if terminal_stream is not None:
                    try:
                        terminal_stream.close()
                    except Exception:
                        pass  # The owner remains held; a proposal is not authority.
        if active is not None:
            if not receipt["terminalFinalized"] or not receipt["originalSourceUnchanged"]:
                receipt["executionCustodyReleased"] = False
                receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD"
            try:
                released = active.finish(receipt)
                if not released:
                    receipt["executionCustodyReleased"] = False
                    receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD"
            except Exception:
                receipt["executionCustodyReleased"] = False
                receipt["finalVerdict"] = "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD"
                receipt["reason"] = "CUSTODY_TERMINAL_WRITE_FAILED"
                try:
                    active.record.update(state=receipt["finalVerdict"], executionCustodyReleased=False)
                    active.write()
                except Exception:
                    pass  # The preserved owner file still refuses a new build.
                try:
                    active.close()
                except Exception:
                    pass  # No completed PASS is returned after release failure.
        # There are no terminal writes or custody mutations after successful
        # release. Read-only input-handle disposal is advisory at this point.
        if pins is not None:
            try:
                pins.close()
            except Exception:
                pass
    return receipt


def main_packet(packet):
    try:
        verified, _recipe = validate_packet(packet)
        receipt = run_build(packet, verified)
    except Exception:
        # Malformed/bootstrap input cannot echo untrusted paths or raw payloads.
        print(json.dumps({"schemaVersion": SCHEMA, "finalVerdict": "STARFIELD_VR_NATIVE_BUILD_BLOCKED",
                          "reason": "INPUT_PROOF_INVALID", **FALSE_CLAIMS}, separators=(",", ":")))
        return 2
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
    return 0 if receipt["finalVerdict"] == "STARFIELD_VR_NATIVE_BUILD_PASSED" else (3 if not receipt["executionCustodyReleased"] else 2)
