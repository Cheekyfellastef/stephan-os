"""Fixed paired-source profile of the existing attended monitor owner.

There is no standalone launcher, arbitrary path, DLL selector or replacement
controller here. Historical source qualification is necessary but never grants
runtime admission. The existing owner supplies fresh process and button proof.
"""
from pathlib import Path
import json
import os
import re
import runpy
import sys

PROFILE = "paired-source-v1"
DLL_NAME = "native-paired-source-observe.dll"
DLL_SHA256 = "9a4c08bc6b8ce26280b56b551880f799ecab3df3df97cdc0375391dad37a4185"
LOADER_NAME = "load-native-paired-source-observe.py"
LOADER_SHA256 = "694a704d2a00f18892bd24e53e0df49862275113323d1f7f662a085d2fdfee04"
QUALIFICATION_SHA256 = "528f0d87aba6127a29df9a19b53bca47af4b1831fca9972e6322034344b86bc5"
RECONSTRUCTOR_SHA256 = "e5ddc5d8e4a0e4c6aa95ac043a3f203771519e5dd6b2fb0ede7fe9683e22aa00"
ANALYZER_SHA256 = "6030c6dd6c7d01ace66df029368ab00add6055e77894daf008e6dd1db9282dbe"
BUILD_REQUEST = "starfield3542-paired-observer-build-d6363303-v3"
SESSION_NAME = "native-paired-source-monitor-session-v1.json"


def qualification(core, pins):
    path = core.RUN_DIRECTORY / "paired-owner-qualification.json"
    pins.add_namespaces([path.parent])
    pins.add([path])
    raw = core.bounded_bytes(path, 16384)
    if core.sha256(raw) != QUALIFICATION_SHA256:
        raise core.Blocked("The independently reviewed paired qualification binding is unavailable.")
    record = core.strict_json(raw)
    if (record.get("qualificationScope") != "EXACT_PAIR_FOR_OWNER_INTEGRATION_REVIEW"
            or record.get("runtimeAdmissionGranted") is not False or record.get("freshSession") is not None):
        raise core.Blocked("Source qualification cannot replace fresh runtime admission.")
    return record


def checked_package(core, pins, state, *, create=False):
    """Prepare only the authenticated fixed closure, retaining all path handles."""
    record = qualification(core, pins)
    directory = core.RUN_DIRECTORY / PROFILE / "package"
    public = Path(core.__file__).absolute().parents[3] / "VR-Research-Lab/native/starfield-paired-observer-v1"
    source = core.WORKSPACE / "work/native-paired-observer-builds-v1" / BUILD_REQUEST / "source"
    pins.add_namespaces([public, source, core.SOURCE])
    recipe = public / "reconstruct_paired_loader.py"
    pins.add([recipe, source / DLL_NAME])
    reconstructor = core.pinned_module(recipe, RECONSTRUCTOR_SHA256, "_paired_runtime_preparation")
    pins.add([core.SOURCE / name for name in reconstructor.ORIGINALS])
    originals = {name: core.bounded_bytes(core.SOURCE / name, identity[0])
                 for name, identity in reconstructor.ORIGINALS.items()}
    members, _non_executable_packet = reconstructor.prepare(originals,
        core.bounded_bytes(source / DLL_NAME, reconstructor.OBSERVER_BYTES))
    identities = {name: {"bytes": len(raw), "sha256": core.sha256(raw)} for name, raw in members.items()}
    if (identities != record["members"] or identities[LOADER_NAME]["sha256"] != LOADER_SHA256
            or identities[DLL_NAME]["sha256"] != DLL_SHA256):
        raise core.Blocked("The fixed runtime package differs from the independently reviewed exact pair.")
    identity = {"qualificationSha256": QUALIFICATION_SHA256,
                "membersSha256": core.sha256(core.json_bytes(identities)), "sessionProfile": PROFILE}
    if create:
        if state.get("packagePrepared") is not False or state.get("captureAttempted") is not False:
            raise core.Blocked("A partial or consumed package cannot be recreated.")
        core.plain_path(directory).mkdir()  # create-only; no repair or replacement
        pins.add_namespaces([directory])
        for name, raw in members.items():
            core.write_new(directory / name, raw)
            pins.add([directory / name])
    else:
        if state.get("packagePrepared") is not True or state.get("packageIdentity") != identity:
            raise core.Blocked("The existing paired package has no complete owner-bound preparation receipt.")
        pins.add_namespaces([directory])
        pins.add([directory / name for name in members])
    allowed = set(members)
    if core.process_valid(state.get("process")):
        pid = state["process"]["pid"]
        allowed |= {"stock-dxgi-%d.json" % pid, "native-paired-source-observe-%d.jsonl" % pid}
    observed = set()
    for item in directory.iterdir():
        core.plain_path(item)
        observed.add(item.name)
        if len(observed) > 13 or item.name not in allowed or not item.is_file():
            raise core.Blocked("Unexpected member in the fixed paired package.")
    if not set(members) <= observed:
        raise core.Blocked("A fixed paired package member is absent.")
    for name, raw in members.items():
        if core.bounded_bytes(directory / name, len(raw)) != raw:
            raise core.Blocked("The retained paired package bytes changed.")
    return directory, identity


def classes(core, helper, custody, runner_hashes):
    """Return adapters over the existing state machines, never a new controller."""
    class PairedStore(helper.Store):
        def __init__(self):
            super().__init__(core.SOURCE)
            # The historical operation lock remains common to both profiles.
            self.path = core.SOURCE / SESSION_NAME
            self.dll_hash = DLL_SHA256

        def new_fields(self):
            return {"sessionProfile": PROFILE}

        def load(self):
            state = super().load()
            if state.get("sessionProfile") != PROFILE:
                raise core.Blocked("The paired starter profile differs.")
            return state

    class PairedJournal(core.Journal):
        def __init__(self):
            super().__init__(core.RUN_DIRECTORY / PROFILE)
            self.lock = core.RUN_DIRECTORY / "operator.lock"
            self.dll_sha256 = DLL_SHA256
            self.admission = None
            self.predecessor = None

        def admit_new_state(self):
            if not self.path.exists():
                if self.admission is None:
                    raise core.Blocked("The fixed successor has no authenticated admission context.")
                self.predecessor = self.admission(self.token)

        def new_fields(self):
            return {"sessionProfile": PROFILE, "predecessor": self.predecessor,
                    "packagePrepared": False, "packageIdentity": None}

        def open_state(self):
            fresh = super().open_state()
            if self.state.get("sessionProfile") != PROFILE:
                raise core.Blocked("The existing paired owner profile differs.")
            if not fresh:
                # Preserve original capture consent and dispatch fields. This
                # token authorizes only status/normal cleanup of the same run.
                self.state["recoveryOwner"] = {"scope": "cleanup-only", "runId": self.state["runId"],
                    "owner": core.strict_json(self.token)["owner"], "pid": os.getpid()}
                self.save()
            return fresh

    class PairedActions(core.WindowsActions):
        loader_sha256 = LOADER_SHA256

        def __init__(self, journal):
            super().__init__(journal)
            self.capture_source = core.RUN_DIRECTORY / PROFILE / "package"
            self.capture_prefix = "native-paired-source-observe"
            journal.admission = self.admit
            self.pins.add_namespaces([self.package, core.SOURCE, core.RUN_DIRECTORY, core.GAME.parent])
            self.pins.add([Path(__file__), self.package / core.CUSTODY_NAME])
            path = self.package / "analyze_paired_source_session.py"
            self.pins.add([path])
            self.paired_analyzer = core.pinned_module(path, ANALYZER_SHA256, "_paired_session_analyzer")

        def admit(self, token):
            qualification(core, self.pins)
            paths = custody.custody_paths(core, helper)
            self.pins.add([paths[name] for name in ("outer", "starter", "stockMarker", "loadMarker")
                           if paths[name].exists()])
            proof = custody.admit_successor(core, helper, token, runner_hashes=runner_hashes)
            old = core.strict_json(core.bounded_bytes(paths["outer"], 1024 * 1024))
            if old.get("captureAttempted") is True:
                if not core.process_valid(old.get("process")):
                    raise core.Blocked("The consumed predecessor process is unproven.")
                name = "native-eye-output-%d.jsonl" % old["process"]["pid"]
                capture = core.SOURCE / name
                self.pins.add([capture])
                raw = core.bounded_bytes(capture, core.MAX_CAPTURE_BYTES)
                snapshot = old.get("captureSnapshot", {})
                if (snapshot.get("name") != name or snapshot.get("sha256") != core.sha256(raw)
                        or type(snapshot.get("bytes")) is not int or snapshot["bytes"] != len(raw)):
                    raise core.Blocked("The consumed predecessor capture cannot be authenticated.")
            return proof

        def verify_artifacts(self):
            super().verify_artifacts()
            for name, expected in ((core.PAIRED_ADAPTER_NAME, core.PAIRED_ADAPTER_SHA256),
                                   (core.CUSTODY_NAME, core.CUSTODY_SHA256),
                                   ("analyze_paired_source_session.py", ANALYZER_SHA256)):
                if core.sha256(core.bounded_bytes(self.package / name, 256 * 1024)) != expected:
                    raise core.Blocked("The fixed paired owner source changed: " + name)
            state = self.journal.state
            custody.validate_predecessor(core, helper, custody.custody_snapshot(core, helper),
                                          state.get("predecessor"), runner_hashes=runner_hashes)
            create = state.get("stage") == "RESERVED" and state.get("packagePrepared") is False
            directory, identity = checked_package(core, self.pins, state, create=create)
            if create:
                self.journal.event("PAIRED_PACKAGE_PREPARED", packagePrepared=True, packageIdentity=identity)
            self.capture_source = directory

        def assert_no_capture(self):
            for item in core.plain_path(self.capture_source).iterdir():
                if item.name.lower().startswith(self.capture_prefix + "-") and item.name.lower().endswith(".jsonl"):
                    raise core.Blocked("The fixed paired attempt already has a native capture.")

        def assert_stock_absent(self, process):
            if core.plain_path(self.capture_source / ("stock-dxgi-%d.json" % process["pid"])).exists():
                raise core.Blocked("The paired process already has a stock-DXGI receipt.")

        def helper(self, action):
            if action not in ("start", "status", "finish"):
                raise core.Blocked("Unregistered paired starter operation.")
            return self._run(action, [sys.executable, "-I", "-S", "-B", str(self.runner_path),
                "--paired-helper", action], {"start": 240, "status": 50, "finish": 100}[action])

        def original_check(self, action, process):
            if action not in ("modules", "scene", "stock") or not core.process_valid(process):
                raise core.Blocked("Unregistered paired process observation.")
            return self._run(action, [sys.executable, "-I", "-S", "-B", str(self.runner_path),
                "--paired-internal", action, "--pid", str(process["pid"]),
                "--filetime", process["createdFileTime"]], 45)

        def load_once(self, process, attempt, deadline):
            return self._run("load", [sys.executable, "-I", "-S", "-B", str(self.runner_path),
                "--paired-internal", "load", "--pid", str(process["pid"]), "--filetime",
                process["createdFileTime"], "--attempt", attempt], max(0, deadline - self.monotonic()))

        def analyze_capture(self, path, state, process):
            return self.paired_analyzer.analyze_capture(core.bounded_bytes(path, core.MAX_CAPTURE_BYTES),
                name=path.name, draw_manifest=core.bounded_bytes(self.capture_source / "native-eye-manifest.json", 207),
                **self.analysis_arguments(state, process))

        def analyze_missing(self, state, process):
            try:
                manifest = core.bounded_bytes(self.capture_source / "native-eye-manifest.json", 207)
            except (OSError, core.Blocked):
                manifest = b""
            return self.paired_analyzer.analyze_capture(b"", name=self.capture_prefix + "-%d.jsonl" % process["pid"],
                draw_manifest=manifest,
                **self.analysis_arguments(state, process))

    return PairedJournal, PairedActions, PairedStore


def child_owner(core, helper, custody, runner_hashes, action):
    state = core.strict_json(core.bounded_bytes(core.RUN_DIRECTORY / PROFILE / "session.json", 1024 * 1024))
    lock = core.strict_json(core.bounded_bytes(core.RUN_DIRECTORY / "operator.lock", 8192))
    if (not isinstance(state, dict) or state.get("schema") != core.SCHEMA
            or state.get("workspace") != str(core.WORKSPACE) or state.get("sessionProfile") != PROFILE
            or state.get("reviewedDllSha256") != DLL_SHA256 or state.get("handoffSha256") != core.HANDOFF_SHA256
            or not isinstance(state.get("runId"), str) or re.fullmatch(r"[0-9a-f]{32}", state["runId"]) is None
            or not isinstance(lock, dict) or not isinstance(lock.get("owner"), str)
            or re.fullmatch(r"[0-9a-f]{32}", lock["owner"]) is None or type(lock.get("pid")) is not int
            or lock["pid"] != os.getppid() or state.get("runnerSha256") != core.sha256(
                core.bounded_bytes(Path(core.__file__), 256 * 1024))):
        raise core.Blocked("The paired child lacks the exact current owner and source identity.")
    primary = (lock.get("owner") == state.get("operatorLockOwner")
               and type(state.get("windowProcessId")) is int and lock["pid"] == state["windowProcessId"])
    recovery = state.get("recoveryOwner")
    cleanup = (isinstance(recovery, dict) and recovery.get("scope") == "cleanup-only"
               and recovery.get("runId") == state.get("runId") and recovery.get("owner") == lock.get("owner")
               and type(recovery.get("pid")) is int and recovery["pid"] == lock["pid"])
    if not primary and not (cleanup and action in {"status", "finish"}):
        raise core.Blocked("A recovery owner cannot launch, confirm, capture or select another profile.")
    custody.validate_predecessor(core, helper, custody.custody_snapshot(core, helper),
                                  state.get("predecessor"), runner_hashes=runner_hashes)
    if action == "start" and (not primary or state.get("stage") != "STARTER_LAUNCH_INTENT"
            or state.get("captureAttempted") is not False or state.get("starterSessionId") is not None
            or state.get("process") is not None or state.get("saveLoadedConfirmed") is not False):
        raise core.Blocked("The paired starter has no fresh launch reservation.")
    return state, lock


def child_inputs(core, pins):
    package = Path(core.__file__).absolute().parent
    pins.add_namespaces([package, core.SOURCE, core.RUN_DIRECTORY / PROFILE])
    pins.add([Path(core.__file__), Path(__file__), package / core.HELPER_NAME,
              package / core.CUSTODY_NAME, core.RUN_DIRECTORY / "operator.lock",
              core.OUTPUTS / "Starfield-VR-HANDOFF.json", core.OUTPUTS / "Starfield-VR-reviewed-handoff.zip",
              core.SOURCE / "native-eye-output-v1-checkpoint.json", core.GAME])
    helper = core.pinned_module(package / core.HELPER_NAME, core.HELPER_SHA256, "_paired_child_starter")
    custody = core.pinned_module(package / core.CUSTODY_NAME, core.CUSTODY_SHA256, "_paired_child_custody")
    handoff = core.verify_originals(helper)
    pins.add([core.SOURCE / name for name in handoff["files"]])
    core.verify_originals(helper)
    old = custody.custody_paths(core, helper)
    pins.add([old[name] for name in ("outer", "starter", "stockMarker", "loadMarker") if old[name].exists()])
    return helper, custody


def helper_main(core, action):
    pins = core.ReadPins()
    try:
        helper, custody = child_inputs(core, pins)
        hashes = core.reviewed_runner_hashes()
        state, _lock = child_owner(core, helper, custody, hashes, action)
        _journal_type, _actions_type, store_type = classes(core, helper, custody, hashes)
        store = store_type()

        class Host(helper.WindowsHost):
            def verify_attempt_history(self):
                current, _ = child_owner(core, helper, custody, hashes, "start")
                checked_package(core, pins, current)
                if store.exists():
                    raise core.Blocked("The paired starter is already consumed.")

        host = Host()
        if action == "start":
            checked_package(core, pins, state)
            result = helper.start(store, host)
            print(json.dumps(helper.summary(result, store)))
            return 0 if result["stage"] == core.WAITING else 2
        if action == "finish":
            starter = store.load()
            if (state.get("starterSessionId") != starter.get("sessionId")
                    or (starter.get("process") is not None and not core.same_process(state.get("process"), starter["process"]))
                    or (starter.get("process") is None and state.get("process") is not None)):
                raise core.Blocked("Cleanup cannot consume another starter's process or isolation receipt.")
            result = helper.finish(store, host)
            print(json.dumps(helper.summary(result, store)))
            return 0 if result["stage"] in core.FINISHED else 2
        if action != "status":
            raise core.Blocked("Unregistered paired helper action.")
        print(json.dumps({"session": helper.summary(store.load(), store) if store.exists() else None,
            "operationLockPresent": core.plain_path(store.lock).exists(), "games": host.games(),
            "proxyState": host.proxy_state()}))
        return 0
    finally:
        pins.close()


def waiting_owner(core, helper, custody, hashes, args, store, host):
    action = args.paired_internal
    state, lock = child_owner(core, helper, custody, hashes, action)
    process = core.validate_internal_admission(state, lock, "load" if action == "load" else "stock",
        args.pid, args.filetime, args.attempt, os.getppid(), dll_sha256=DLL_SHA256)
    starter = store.load()
    status = {"session": helper.summary(starter, store), "operationLockPresent": core.plain_path(store.lock).exists(),
              "games": host.games(), "proxyState": host.proxy_state()}
    session = core.waiting_session(status, DLL_SHA256)
    if (session["sessionId"] != state["starterSessionId"] or not core.same_process(session["process"], process)
            or not host.owns_isolation_receipt(starter.get("isolationReceipt"))):
        raise core.Blocked("The current paired starter/process/isolation receipt binding changed.")
    return state, process


def internal_main(core, args):
    pins, guard = core.ReadPins(), None
    try:
        helper, custody = child_inputs(core, pins)
        hashes = core.reviewed_runner_hashes()
        _journal_type, _actions_type, store_type = classes(core, helper, custody, hashes)
        store, host = store_type(), helper.WindowsHost()
        state, process = waiting_owner(core, helper, custody, hashes, args, store, host)
        guard = core.ProcessGuard(process)
        directory, _identity = checked_package(core, pins, state)
        core.pinned_module(directory / "mapped_probe_identity.py", core.MAPPED_IDENTITY_SHA256, "mapped_probe_identity")
        api = runpy.run_path(str(directory / LOADER_NAME))
        old_api = runpy.run_path(str(core.SOURCE / "load-native-trace.py"))
        # Explicitly include the last eye-output probe as well as the older
        # trace probes. A different probe name cannot evade fresh-game checks.
        old_api["PROBES"] = {**old_api["PROBES"], "previous-eye-output": ("native-eye-output.dll", core.DLL_SHA256),
                             "paired-source": (DLL_NAME, DLL_SHA256)}
        observed = core._fixed_module_observation(process, api, old_api)
        if args.paired_internal == "modules":
            print(json.dumps(observed))
            return 0
        if args.paired_internal == "scene":
            script = core.SOURCE / "check-loaded-scene.py"
            sys.argv = [str(script), str(process["pid"])]
            runpy.run_path(str(script), run_name="__main__")
            return 0
        if args.paired_internal == "stock":
            target = core.plain_path(directory / ("stock-dxgi-%d.json" % process["pid"]))
            if target.exists():
                raise core.Blocked("The paired stock receipt is already consumed.")
            handle = api["check"](api["open_process"](0x410, False, process["pid"]))
            try:
                mapped = api["modules"](handle)
                dxgi = Path(r"C:\Windows\System32\dxgi.dll")
                if core.GAME not in mapped or dxgi not in mapped or helper.HELD in mapped:
                    raise core.Blocked("The current module table is not the admitted stock-DXGI game.")
                pins.add([dxgi])
                result = {"pid": process["pid"], "createdFileTime": process["createdFileTime"],
                    "gameBase": mapped[core.GAME], "systemDxgi": str(dxgi), "systemDxgiSha256": helper.digest(dxgi),
                    "proxyMapped": False, "rollbackReceipt": "proxy-isolation-receipt.json"}
            finally:
                api["close"](handle)
            waiting_owner(core, helper, custody, hashes, args, store, host)
            if not guard.alive():
                raise core.Blocked("The exact process exited before stock receipt publication.")
            core.write_new(core.RUN_DIRECTORY / PROFILE / "stock-child-consumed.json", core.json_bytes({
                "runId": state["runId"], "pid": process["pid"], "createdFileTime": process["createdFileTime"], "utc": core.utc()}))
            core.write_new(target, core.json_bytes(result))
            print(json.dumps(result))
            return 0
        if args.paired_internal != "load":
            raise core.Blocked("Unregistered paired native action.")
        capture = core.plain_path(directory / ("native-paired-source-observe-%d.jsonl" % process["pid"]))
        if capture.exists():
            raise core.Blocked("The paired native capture already exists.")
        stock = directory / ("stock-dxgi-%d.json" % process["pid"])
        pins.add([stock])
        if core.json_bytes(core.strict_json(core.bounded_bytes(stock, 32768))) != core.json_bytes(state.get("stockDxgi")):
            raise core.Blocked("The current stock receipt differs from the owner's authenticated observation.")
        waiting_owner(core, helper, custody, hashes, args, store, host)
        core.write_new(core.RUN_DIRECTORY / PROFILE / "loader-child-consumed.json", core.json_bytes({
            "runId": state["runId"], "starterSessionId": state["starterSessionId"], "attemptToken": args.attempt,
            "pid": process["pid"], "createdFileTime": process["createdFileTime"],
            "reviewedDllSha256": DLL_SHA256, "loaderSha256": LOADER_SHA256, "utc": core.utc()}))
        waiting_owner(core, helper, custody, hashes, args, store, host)
        if not guard.alive() or capture.exists():
            raise core.Blocked("The retained process/capture changed immediately before dispatch.")
        script = directory / LOADER_NAME
        sys.argv = [str(script), "--pid", str(process["pid"]), "--expected-process-created-filetime",
                    process["createdFileTime"], "--expected-dll-sha256", DLL_SHA256,
                    "--probe", "native-paired-source-observe"]
        runpy.run_path(str(script), run_name="__main__")
        return 0
    finally:
        if guard is not None:
            guard.close()
        pins.close()
