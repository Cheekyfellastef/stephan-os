"""Start, inspect, or normally close ONE reviewed Starfield monitor session.

This wrapper never loads a DLL, captures a frame, rebuilds source, or starts VR.
Run with an isolated Python interpreter: python -I -S -B THIS_FILE start
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import time
import uuid


WORKSPACE = Path.home() / "Documents" / "Codex" / "2026-11-05" / "starfield-vr-did-not-start-and"
SOURCE = WORKSPACE / "work" / "stephanos-openxr"
OUTPUTS = WORKSPACE / "outputs"
GAME = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Starfield\Starfield.exe")
STEAM = Path(r"C:\Program Files (x86)\Steam\steam.exe")
POWERSHELL = Path(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
PROXY = GAME.with_name("dxgi.dll")
HELD = GAME.with_name("dxgi.stephanos-eye-capture-20261106-held")
SESSION_NAME = "native-eye-output-monitor-session-v1.json"
SCHEMA = "stephanos.native-eye-output.monitor-session.v1"
HANDOFF_HASH = "2c234970c5bcd7cf54544c496a7f74b398ee2ecaa9055ebcead4f64d5c42685f"
GAME_HASH = "7e9adb1414a8e1b325e5e1f097b9b17b78deb7eebeda37a333351a43a60f9d28"
PROXY_HASH = "63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41"
PROXY_HELPER_HASH = "893ab04f4142f4bbc687a1f583c3425a857ea4b5a49df28414fee7e6102a8133"
DLL_HASH = "43e6fd3b2a3e92abd11312e46d1f17ef427a220185fb4a3271b702b7efab8448"
ARCHIVE_HASH = "1ea602071f2452f0afc70de1b9a63e6e99ef765f9edccb160b1c8a8f9ffca951"
FINISHED_STAGES = {"GAME_EXIT_OBSERVED_PROXY_RESTORED", "PRELAUNCH_ABORT_PROXY_RESTORED"}
PRELAUNCH_STAGES = {"START_FAILED_PROXY_PRESERVED", "START_FAILED_BEFORE_LAUNCH_PROXY_RESTORED",
                    "PROXY_ISOLATED", "PRELAUNCH_ROLLBACK_INTENT"}


class Blocked(RuntimeError):
    pass


def utc():
    return datetime.now(timezone.utc).isoformat()


def plain_path(path):
    """Reject symlinks and Windows reparse points before reading or changing paths."""
    path = Path(path).absolute()
    for part in (path,) + tuple(path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise Blocked("Reparse/symlink path is not admitted: " + str(part))
    return path


def digest(path):
    plain_path(path)
    if not Path(path).is_file():
        raise Blocked("Required regular file missing: " + str(path))
    result = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def verify_files(directory, records, expected_count=262):
    if len(records) != expected_count:
        raise Blocked("Saved artifact count differs")
    for name, item in records.items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or ":" in name or "\\" in name:
            raise Blocked("Manifest path is not a relative artifact name")
        path = plain_path(Path(directory).joinpath(*relative.parts))
        if digest(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
            raise Blocked("Saved artifact differs: " + name)


def read_json(path):
    plain_path(path)
    if Path(path).stat().st_size > 128 * 1024:
        raise Blocked("State record exceeds its bound")
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_new(path, raw):
    plain_path(path)
    descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


class Store:
    def __init__(self, directory):
        self.path = Path(directory) / SESSION_NAME
        self.lock = self.path.with_suffix(".lock")
        self.version = None
        self.write_uncertain = False

    @contextmanager
    def operation(self):
        token = json.dumps({"operation": uuid.uuid4().hex, "pid": os.getpid(), "utc": utc()}).encode()
        try:
            write_new(self.lock, token)
        except FileExistsError as error:
            raise Blocked("Session operation lock exists. Inspect it; never delete/retry automatically.") from error
        interrupted = False
        try:
            yield
        except BaseException as error:
            interrupted = not isinstance(error, Exception)
            raise
        finally:
            # Observed denials are retryable through status/finish. An interruption
            # or uncertain durable write requires explicit reconciliation instead.
            if not interrupted and not self.write_uncertain:
                plain_path(self.lock)
                if self.lock.read_bytes() != token:
                    raise Blocked("Operation lock identity changed; preserving it")
                self.lock.unlink()

    def exists(self):
        plain_path(self.path)
        return self.path.exists()

    def load(self):
        state = read_json(self.path)
        if (state.get("schema") != SCHEMA or state.get("workspace") != str(WORKSPACE)
                or state.get("handoffSha256") != HANDOFF_HASH
                or state.get("reviewedDllSha256") != DLL_HASH
                or not re.fullmatch(r"[0-9a-f]{32}", state.get("sessionId", ""))):
            raise Blocked("Existing session identity differs")
        self.version = digest(self.path)
        return state

    def save(self, state, new=False):
        raw = (json.dumps(state, indent=2) + "\n").encode("utf-8")
        if new:
            self.write_uncertain = True
            try:
                write_new(self.path, raw)
            except FileExistsError:
                self.write_uncertain = False
                raise
        else:
            if self.version is None or digest(self.path) != self.version:
                raise Blocked("Session changed outside this invocation; preserving it")
            temporary = self.path.with_name(self.path.name + "." + uuid.uuid4().hex + ".tmp")
            self.write_uncertain = True
            write_new(temporary, raw)
            plain_path(self.path)
            if digest(self.path) != self.version:
                raise Blocked("Session changed before atomic write; preserving both records")
            os.replace(temporary, self.path)
        self.version = hashlib.sha256(raw).hexdigest()
        self.write_uncertain = False


def advance(store, state, stage, **fields):
    state.update(fields, stage=stage, updatedUtc=utc())
    state["events"].append({"stage": stage, "utc": state["updatedUtc"]})
    store.save(state)


def identity_valid(process, earliest="0"):
    return (type(process.get("pid")) is int and 0 < process["pid"] < 2**32
            and str(process.get("path", "")).casefold() == str(GAME).casefold()
            and isinstance(process.get("createdFileTime"), str)
            and re.fullmatch(r"[0-9]{17,20}", process["createdFileTime"]) is not None
            and int(process["createdFileTime"]) >= int(earliest))


def same_process(first, second):
    return (identity_valid(first) and identity_valid(second)
            and first["pid"] == second["pid"]
            and first["createdFileTime"] == second["createdFileTime"])


def start(store, host):
    if store.exists():
        raise Blocked("This one-attempt session already exists. Use status or finish; do not start again.")
    proof = host.preflight()
    with store.operation():
        if store.exists() or host.games():
            raise Blocked("Session or running game appeared during admission")
        state = {"schema": SCHEMA, "sessionId": uuid.uuid4().hex, "workspace": str(WORKSPACE),
                 "stage": "RESERVED_ONE_ATTEMPT", "createdUtc": utc(), "events": [],
                 "handoffSha256": HANDOFF_HASH, "reviewedDllSha256": DLL_HASH,
                 "sourceArchiveSha256": ARCHIVE_HASH, "verification": proof,
                 "launchRequested": False, "process": None, "injected": False,
                 "captureAttempted": False, "saveLoadedConfirmed": False,
                 "headsetNeeded": False, "priorProxyReceipt": host.previous_proxy_receipt()}
        store.save(state, new=True)
        try:
            advance(store, state, "PROXY_ISOLATION_INTENT")
            isolated = host.proxy("Isolate")
            advance(store, state, "PROXY_ISOLATED", isolationReceipt=isolated)
            if host.games():
                raise Blocked("Game appeared before Steam request; no new launch admitted")
            advance(store, state, "STEAM_LAUNCH_INTENT", launchRequested=True,
                    launchNotBeforeFileTime=host.now_filetime())
            host.launch()
            deadline = host.monotonic() + 90
            while host.monotonic() < deadline:
                games = host.games()
                if games:
                    if len(games) != 1 or not identity_valid(games[0], state["launchNotBeforeFileTime"]):
                        raise Blocked("A single exact fresh Starfield process was not found")
                    advance(store, state, "FRESH_MONITOR_GAME_WAITING_FOR_SAVE", process=games[0],
                            nextAction="Load your usual save, leave the character still, and provide this PID/FileTime with a fresh save-loaded confirmation. No probe has been loaded.")
                    return state
                host.sleep(1)
            raise Blocked("Steam launch has not produced a verified process within 90 seconds")
        except Exception as error:
            stage = "LAUNCH_UNRESOLVED_PROXY_PRESERVED" if state["launchRequested"] else "START_FAILED_PROXY_PRESERVED"
            cleanup = None
            if not state["launchRequested"]:
                try:
                    if host.games():
                        raise Blocked("A game is running; proxy paths are preserved")
                    if host.proxy_state() == "isolated":
                        advance(store, state, "PRELAUNCH_ROLLBACK_INTENT", error=str(error))
                        host.proxy("Restore")
                    if host.proxy_state() != "restored":
                        raise Blocked("Original proxy is not verified restored")
                    stage = "START_FAILED_BEFORE_LAUNCH_PROXY_RESTORED"
                except Exception as cleanup_error:
                    cleanup = str(cleanup_error)
            advance(store, state, stage, error=str(error), cleanupError=cleanup,
                    nextAction="Do not relaunch or retry the old helper. Return this receipt. If Steam launch is unresolved, normal game exit or explicit launch reconciliation is required before restoring the proxy.")
            return state


def finish(store, host):
    state = store.load()
    with store.operation():
        state = store.load()
        if state["stage"] in FINISHED_STAGES:
            if host.proxy_state() != "restored":
                raise Blocked("Completed session proxy state changed; no automatic mutation")
            return state
        process = state.get("process")
        if process is None and state.get("launchRequested") is False:
            if state["stage"] not in PRELAUNCH_STAGES:
                raise Blocked("Unknown prelaunch stage; proxy preserved for reconciliation")
            if host.games():
                raise Blocked("Unowned game is running; prelaunch cleanup preserves it and the proxy")
            if host.proxy_state() == "isolated":
                if not host.owns_isolation_receipt(state.get("isolationReceipt")):
                    raise Blocked("Prelaunch cleanup lacks the unchanged owned isolation receipt")
                advance(store, state, "PRELAUNCH_ROLLBACK_INTENT")
                host.proxy("Restore")
            if host.proxy_state() != "restored" or host.games():
                raise Blocked("Prelaunch cleanup could not prove an idle game and restored proxy")
            advance(store, state, "PRELAUNCH_ABORT_PROXY_RESTORED", proxyRestored=True,
                    nextAction="The prelaunch attempt remains consumed; no new launch or capture is authorized by this cleanup.")
            return state
        if not process or not identity_valid(process):
            raise Blocked("No recorded fresh process identity. A possibly delayed Steam launch requires reconciliation; proxy preserved.")
        games = host.games()
        if any(not same_process(game, process) for game in games):
            raise Blocked("Unowned or reused Starfield process present; no close or proxy restoration")
        close_result = None
        if games:
            advance(store, state, "NORMAL_CLOSE_REQUESTED")
            close_result = host.close(process)
        if host.games():
            advance(store, state, "NORMAL_EXIT_STILL_REQUIRED", closeResult=close_result,
                    nextAction="Close Starfield through its normal game menu, then run finish. Never force-kill it.")
            return state
        advance(store, state, "GAME_EXIT_OBSERVED_RESTORE_INTENT", gameExitObserved=True,
                closeResult=close_result, normalExitProven=bool(close_result and close_result.get("requested") and close_result.get("exited") and close_result.get("exitCode") == 0))
        if host.proxy_state() == "isolated":
            host.proxy("Restore")
        if host.proxy_state() != "restored" or host.games():
            raise Blocked("Cleanup could not prove idle game and original proxy; inspect status")
        advance(store, state, "GAME_EXIT_OBSERVED_PROXY_RESTORED", proxyRestored=True,
                nextAction="Session is consumed. No capture or playable-VR result is implied.")
        return state


class WindowsHost:
    def __init__(self):
        if os.name != "nt":
            raise Blocked("Live actions are only supported on the existing Windows Battle Bridge")
        plain_path(POWERSHELL)

    def ps(self, code=None, file_args=None, timeout=20):
        argv = [str(POWERSHELL), "-NoProfile", "-NonInteractive"]
        if code is not None:
            code = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + code
            argv += ["-Command", code]
        else:
            helper = SOURCE / "isolate-starfield-proxy.ps1"
            if (len(file_args) != 3 or file_args[:2] != [str(helper), "-Mode"]
                    or file_args[2] not in ("Isolate", "Restore") or digest(helper) != PROXY_HELPER_HASH):
                raise Blocked("Only the fixed reviewed proxy helper may execute as a script")
            # This flag affects only this child process, never the saved user or
            # machine policy, and admits only the exact hash-bound helper above.
            argv += ["-ExecutionPolicy", "Bypass", "-File"] + file_args
        result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                encoding="utf-8-sig", errors="strict", timeout=timeout,
                                creationflags=subprocess.CREATE_NO_WINDOW, check=False)
        if result.returncode:
            raise Blocked("PowerShell helper failed: " + result.stderr.strip()[:2000])
        return json.loads(result.stdout) if result.stdout.strip() else None

    def games(self):
        result = self.ps("""
$rows=@(); foreach($p in @(Get-Process -ErrorAction Stop | Where-Object {$_.ProcessName -ieq 'Starfield'})) {
  $created=$p.StartTime.ToUniversalTime(); if([string]::IsNullOrWhiteSpace($p.Path)){throw 'Game path unavailable'}
  $rows += [ordered]@{pid=$p.Id;path=$p.Path;createdUtc=$created.ToString('o');
    createdFileTime=$created.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)}
}; ConvertTo-Json -InputObject $rows -Depth 4 -Compress
""")
        if not isinstance(result, list):
            raise Blocked("Process enumeration did not return an array")
        return result

    def proxy_state(self):
        plain_path(PROXY); plain_path(HELD)
        source = digest(PROXY) if PROXY.exists() else None
        held = digest(HELD) if HELD.exists() else None
        if source == PROXY_HASH and held is None:
            return "restored"
        if source is None and held == PROXY_HASH:
            return "isolated"
        raise Blocked("Unknown/occupied proxy paths; preserving both without overwrite")

    def previous_proxy_receipt(self):
        path = plain_path(SOURCE / "proxy-isolation-receipt.json")
        if not path.exists():
            return None
        if path.stat().st_size > 32768:
            raise Blocked("Prior proxy receipt exceeds its bound")
        raw = path.read_bytes()
        return {"sha256": hashlib.sha256(raw).hexdigest(), "base64": base64.b64encode(raw).decode("ascii")}

    def proxy_receipt(self):
        path = SOURCE / "proxy-isolation-receipt.json"
        record = read_json(path)
        if (record.get("source") != str(PROXY) or record.get("held") != str(HELD)
                or record.get("expectedSha256") != PROXY_HASH):
            raise Blocked("Proxy receipt identity differs")
        return {"sha256": digest(path), "record": record}

    def owns_isolation_receipt(self, saved):
        return bool(saved and saved.get("record", {}).get("stage") == "isolated"
                    and self.proxy_receipt() == saved)

    def preflight(self):
        handoff_path = OUTPUTS / "Starfield-VR-HANDOFF.json"
        if digest(handoff_path) != HANDOFF_HASH:
            raise Blocked("Handoff JSON changed")
        handoff = read_json(handoff_path)
        if handoff["workspace"] != str(WORKSPACE) or handoff["activeSource"] != str(SOURCE):
            raise Blocked("Canonical workspace differs")
        verify_files(SOURCE, handoff["files"])
        archive = OUTPUTS / "Starfield-VR-reviewed-handoff.zip"
        if digest(archive) != ARCHIVE_HASH or archive.stat().st_size != 1399942:
            raise Blocked("Reviewed archive changed")
        checkpoint_path = SOURCE / "native-eye-output-v1-checkpoint.json"
        expected = {"state": handoff["state"], "captureExecuted": False, "liveGamePid": None,
                    "review": handoff["review"], "artifacts": handoff["artifactHashes"],
                    "handoff": str(handoff_path), "archive": handoff["archive"]}
        if json.dumps(read_json(checkpoint_path), sort_keys=True) != json.dumps(expected, sort_keys=True):
            raise Blocked("Current native-eye-output checkpoint is not the saved unrun experiment")
        for entry in SOURCE.iterdir():
            name = entry.name.lower()
            if (name.startswith("native-eye-output-") and name.endswith(".jsonl")) or ("eye-output" in name and "session" in name and entry.is_file()):
                raise Blocked("Existing native-eye-output attempt/session found: " + entry.name)
        if digest(GAME) != GAME_HASH or self.proxy_state() != "restored" or self.games():
            raise Blocked("Expected idle game and restored proxy were not verified")
        plain_path(STEAM)
        if not STEAM.is_file():
            raise Blocked("Installed Steam executable missing")
        version = self.ps("(Get-Item -LiteralPath 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Starfield\\Starfield.exe').VersionInfo.FileVersion | ConvertTo-Json -Compress")
        if version != "1.16.244.0":
            raise Blocked("Installed game version differs")
        return {"manifestFilesVerified": 262, "checkpointSha256": digest(checkpoint_path),
                "gameSha256": GAME_HASH, "gameVersion": version, "archiveSha256": ARCHIVE_HASH}

    def proxy(self, mode):
        helper = SOURCE / "isolate-starfield-proxy.ps1"
        if mode not in ("Isolate", "Restore") or digest(helper) != PROXY_HELPER_HASH:
            raise Blocked("Proxy helper or action differs")
        plain_path(SOURCE / "proxy-isolation-receipt.json")
        expected_before, expected_after = ("restored", "isolated") if mode == "Isolate" else ("isolated", "restored")
        if self.games() or self.proxy_state() != expected_before:
            raise Blocked("Proxy transaction preconditions changed")
        result = self.ps(file_args=[str(helper), "-Mode", mode])
        if self.proxy_state() != expected_after:
            raise Blocked("Proxy transaction result unverified")
        receipt = self.proxy_receipt()
        if receipt["record"] != result or result.get("stage") != expected_after:
            raise Blocked("Proxy helper output does not match its durable receipt")
        return receipt

    def launch(self):
        if self.games() or self.proxy_state() != "isolated":
            raise Blocked("Launch preconditions changed")
        self.ps("Start-Process -FilePath 'C:\\Program Files (x86)\\Steam\\steam.exe' -ArgumentList '-applaunch','1716740' -WindowStyle Hidden; '{\"requested\":true}'")

    def close(self, process):
        if not identity_valid(process):
            raise Blocked("Close target identity invalid")
        # Only validated integer/decimal values enter this fixed command; path is fixed.
        code = r"""
$p=Get-Process -Id PID_VALUE -ErrorAction Stop;
if($p.Path -ine 'C:\Program Files (x86)\Steam\steamapps\common\Starfield\Starfield.exe' -or
  $p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) -cne 'TIME_VALUE') {throw 'Close target identity changed'}
$requested=$p.CloseMainWindow();$exited=$p.WaitForExit(60000);$exitCode=$null;
if($exited){$exitCode=$p.ExitCode};[ordered]@{requested=$requested;exited=$exited;exitCode=$exitCode} | ConvertTo-Json -Compress
""".replace("PID_VALUE", str(process["pid"])).replace("TIME_VALUE", process["createdFileTime"])
        return self.ps(code, timeout=70)

    @staticmethod
    def now_filetime():
        return str(time.time_ns() // 100 + 116444736000000000)

    monotonic = staticmethod(time.monotonic)
    sleep = staticmethod(time.sleep)


def summary(state, store):
    keys = ("sessionId", "stage", "createdUtc", "updatedUtc", "launchRequested",
            "handoffSha256", "reviewedDllSha256", "sourceArchiveSha256", "verification",
            "injected", "captureAttempted", "saveLoadedConfirmed", "headsetNeeded",
            "gameExitObserved", "normalExitProven", "proxyRestored", "error", "cleanupError", "nextAction")
    result = {key: state[key] for key in keys if key in state}
    result["statePath"] = str(store.path)
    result["process"] = state.get("process")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "status", "finish"))
    args = parser.parse_args()
    if not (sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode):
        raise Blocked("Invoke with python -I -S -B so local/user Python startup code is excluded")
    host, store = WindowsHost(), Store(SOURCE)
    if args.action == "start":
        result = start(store, host)
    elif args.action == "finish":
        result = finish(store, host)
    else:
        result = {"session": summary(store.load(), store) if store.exists() else None,
                  "operationLockPresent": store.lock.exists(), "games": host.games(),
                  "proxyState": host.proxy_state()}
    print(json.dumps(result if args.action == "status" else summary(result, store), indent=2))
    if args.action == "start" and result["stage"] != "FRESH_MONITOR_GAME_WAITING_FOR_SAVE":
        return 2
    if args.action == "finish" and result["stage"] not in FINISHED_STAGES:
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"status": "BLOCKED", "error": str(error), "noAutomaticRetry": True}), file=sys.stderr)
        sys.exit(2)
