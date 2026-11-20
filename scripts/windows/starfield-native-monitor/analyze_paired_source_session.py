"""Read-only evidence adapter for the existing Hybrid owner's paired attempt.

Consumes immutable snapshots supplied by the owner. This module cannot admit a
launch, create a session, load native code, retire resources or prove provenance
of caller-supplied process observations. All headset/rendering claims stay false.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import stat
import types

DLL_SHA256 = "9a4c08bc6b8ce26280b56b551880f799ecab3df3df97cdc0375391dad37a4185"
LOADER_SHA256 = "694a704d2a00f18892bd24e53e0df49862275113323d1f7f662a085d2fdfee04"
GAME_SHA256 = "7e9adb1414a8e1b325e5e1f097b9b17b78deb7eebeda37a333351a43a60f9d28"
DRAW_MANIFEST_SHA256 = "690a7708a11f2b7e6a83e3bd56c93b5bdf5f88003847ff2c8338dabe436167d0"
DIAGNOSTIC_SHA256 = "12fa494b96802e85564aa673680ba4850da7677b0f643167393b2a4b2c630364"
BASE_HOOKS = (39057584, 43076496, 45579072, 44407744, 0x2B16E90, 0x2B177C0)
MAX_BYTES = 64 * 1024 * 1024
MAX_LINES = 20000
MAX_LINE_BYTES = 64 * 1024
FALSE_CLAIMS = ("pixelAuthority", "submissionAuthority", "pixelsCaptured", "imagesRecorded",
                "gpuCopyCommandsIssued", "gpuCompletionProven", "openxrSubmitted",
                "sameSimulationUpdateProven", "persistentPerEyeHistoriesProven",
                "headsetReadinessProven", "playableVRProven")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def integer(value, minimum=0, maximum=0xFFFFFFFFFFFFFFFF):
    return type(value) is int and minimum <= value <= maximum


def filetime(value):
    return (isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{16,19}", value) is not None
            and int(value) <= 0xFFFFFFFFFFFFFFFF)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON member")
            result[key] = value
        return result

    def constant(_value):
        raise ValueError("Non-finite JSON number")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def diagnostic_module():
    """Execute the checked public analyzer bytes, with no import-path lookup."""
    path = (Path(__file__).absolute().parents[3] / "VR-Research-Lab" / "native"
            / "starfield-paired-observer-v1" / "analyze-paired-source-observation.py")
    for member in (path,) + tuple(path.parents):
        info = member.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Diagnostic analyzer path is a link/reparse point")
    with path.open("rb") as stream:
        raw = stream.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024 or digest(raw) != DIAGNOSTIC_SHA256:
        raise ValueError("Diagnostic analyzer identity changed")
    module = types.ModuleType("_paired_diagnostic_snapshot")
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def expected_hooks(draw_manifest):
    # Private addresses are derived from authenticated bytes, never published
    # here or selected by a caller-supplied list of supposedly valid hooks.
    if type(draw_manifest) is not bytes or len(draw_manifest) != 207 or digest(draw_manifest) != DRAW_MANIFEST_SHA256:
        raise ValueError("Reviewed draw manifest identity differs")
    document = strict_json(draw_manifest)
    if document.get("exeSha256") != GAME_SHA256 or len(document.get("hooks", {})) != 1:
        raise ValueError("Reviewed draw manifest shape differs")
    hook = next(iter(document["hooks"].values()))
    rva = hook.get("rva")
    if not integer(rva, 1, 0xFFFFFFFF) or rva in BASE_HOOKS:
        raise ValueError("Draw hook identity is invalid or aliases another hook")
    return BASE_HOOKS + (rva,)


def parse_capture(raw):
    errors, rows = [], []
    if type(raw) is not bytes or len(raw) > MAX_BYTES:
        return rows, ["Capture is absent or exceeds its byte bound"]
    if not raw or not raw.endswith(b"\n"):
        errors.append("Capture is empty or lacks its terminal newline")
    lines = raw.splitlines()
    if len(lines) > MAX_LINES:
        return rows, errors + ["Capture exceeds its record bound"]
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            if len(line) > MAX_LINE_BYTES:
                raise ValueError("Record exceeds its byte bound")
            row = strict_json(line.decode("utf-8"))
            if not isinstance(row, dict):
                raise ValueError("Record is not an object")
            rows.append(row)
        except (ValueError, UnicodeError, RecursionError):
            errors.append("Malformed capture record " + str(number))
    return rows, errors


def typed_paired_records(rows, errors):
    """Do not let Python's bool/int equality validate native numeric fields."""
    for row in rows:
        for field in FALSE_CLAIMS:
            if field in row and row[field] is not False:
                errors.append("Contradictory diagnostic claim: " + field)
        if "pairedSourceObservation" in row:
            if row["pairedSourceObservation"] is not True or row.get("schema") != 1 or type(row.get("schema")) is not int:
                errors.append("Invalid paired observation schema")
            for field in ("records", "attempted", "dropped", "windowReason", "failure", "modelFailure", "openApi"):
                if not integer(row.get(field), 0, 0xFFFFFFFF):
                    errors.append("Invalid paired count: " + field)
        if "pairedEvent" not in row:
            continue
        if not integer(row["pairedEvent"], 1, 13):
            errors.append("Unknown paired event")
        for field in ("sequence", "serial", "list", "typedObject", "generation", "caller",
                      "sourceCanonical", "typedResource", "queueCanonical"):
            if not integer(row.get(field)):
                errors.append("Invalid paired identity: " + field)
        for field in ("role", "counterCandidate", "thread", "before", "afterState", "nativeDepth", "count"):
            if not integer(row.get(field), 0, 0xFFFFFFFF):
                errors.append("Invalid paired numeric field: " + field)
        for field in ("success", "coveredResetGeneration", "wholeUnsplit", "nativeDirectBatch"):
            if type(row.get(field)) is not bool:
                errors.append("Invalid paired boolean: " + field)
        entries = row.get("lists")
        if (not isinstance(entries, list) or len(entries) > 64 or type(row.get("count")) is not int
                or row["count"] != len(entries)
                or any(not isinstance(pair, list) or len(pair) != 2
                       or not all(integer(value) for value in pair) for pair in entries)):
            errors.append("Invalid paired execution-list identities")


def reconcile_paired_events(rows, errors):
    """Reconcile the emitted recorder model, including its post-cut tail.

    A watched reset and completed execute bracket have exact journal counts.
    Opaque callbacks may also be suppressed while unrelated, so their total is
    only a lower bound on emitted opaque events. This is CPU diagnostic evidence;
    even a matched ExecuteEnd never supplies GPU completion or copy authority.
    """
    receipts = [row for row in rows if "pairedSourceObservation" in row]
    if len(receipts) != 1:
        errors.append("Exactly one paired recorder summary is required")
        return
    receipt = receipts[0]
    events = [row for row in rows if "pairedEvent" in row]
    for field in ("sourceChecks", "scopeRejected", "resets", "executePairs",
                  "suppressedUnrelatedOrOutsideWindow", "opaqueCallbacks", "startCounter", "cutCounter"):
        if not integer(receipt.get(field), 0, 0xFFFFFFFF):
            errors.append("Missing or invalid recorder summary: " + field)
    for field in ("draws", "transitions"):
        value = receipt.get(field)
        if not isinstance(value, list) or len(value) != 2 or not all(integer(v, 0, 0xFFFFFFFF) for v in value):
            errors.append("Missing or invalid per-eye recorder summary: " + field)
    if errors:
        return
    pending, completed = {}, set()
    draws, transitions = [0, 0], [0, 0]
    resets = opaque = 0
    cut = None
    bindings = []
    for index, event in enumerate(events, 1):
        kind, role = event["pairedEvent"], event["role"]
        if event["sequence"] != index:
            errors.append("Recorder sequence is missing or repeated")
        if cut is not None and kind not in (2, 3, 10, 11):
            errors.append("Unexpected event after the observation window closed")
        if kind == 1:
            bindings.append(event)
            if index > 2 or role not in (0, 1) or event["success"] is not True:
                errors.append("Paired source bindings must open the observation")
        elif kind == 2 and event["success"]:
            resets += 1
        elif kind == 6 and event["coveredResetGeneration"]:
            if role in (0, 1):
                transitions[role] += 1
            else:
                errors.append("Transition role is outside the paired sources")
        elif kind == 8:
            opaque += 1
        elif kind == 9 and event["coveredResetGeneration"] and event["success"]:
            if role in (0, 1):
                draws[role] += 1
            else:
                errors.append("Draw role is outside the paired sources")
        elif kind in (10, 11):
            serial = event["serial"]
            if (not serial or not event["queueCanonical"] or not event["thread"] or not event["count"]
                    or any(pair[0] == 0 for pair in event["lists"])
                    or len({pair[0] for pair in event["lists"]}) != event["count"]):
                errors.append("Execution bracket identity is incomplete or aliased")
            if kind == 10:
                if serial in pending or serial in completed or len(pending) >= 64:
                    errors.append("Execution bracket was repeated or exceeded its bound")
                pending[serial] = event
            else:
                begin = pending.pop(serial, None)
                fields = ("queueCanonical", "typedObject", "caller", "thread", "count", "lists", "nativeDirectBatch")
                if begin is None or event["success"] is not True or any(begin[field] != event[field] for field in fields):
                    errors.append("Execution end has no exact successful begin/end pair")
                completed.add(serial)
        elif kind == 13:
            if cut is not None:
                errors.append("Observation window closed more than once")
            cut = event["counterCandidate"]
    if pending:
        errors.append("Execution brackets remain open at diagnostic completion")
    if (len(bindings) != 2 or {event["role"] for event in bindings} != {0, 1}
            or any(event["counterCandidate"] != receipt["startCounter"] for event in bindings)):
        errors.append("Paired source bindings disagree with the start counter")
    start, end, reason = receipt["startCounter"], receipt["cutCounter"], receipt["windowReason"]
    if (cut is None or cut != end or end < start or reason not in (1, 2)
            or (reason == 1 and end - start < 6) or (reason == 2 and end - start >= 6)):
        errors.append("Observation window termination/counters are inconsistent")
    if (receipt["draws"] != draws or receipt["transitions"] != transitions
            or receipt["resets"] != resets or receipt["executePairs"] != len(completed)
            or receipt["opaqueCallbacks"] < opaque):
        errors.append("Recorder summaries disagree with the complete event journal")


def validate_view_withdrawal(rows, errors):
    lifecycles = [row for row in rows if "nativeViewResult" in row]
    allocations = [row for row in rows if "eyeOutputAllocation" in row]
    if len(lifecycles) != 1 or len(allocations) != 1:
        errors.append("One native view lifecycle and allocation receipt are required")
        return
    lifecycle, allocation = lifecycles[0], allocations[0]
    if (type(lifecycle.get("nativeViewResult")) is not int or lifecycle["nativeViewResult"] != 7
            or not integer(lifecycle.get("view"), 1, 0xFFFFFFFF)
            or type(allocation.get("view")) is not int or allocation["view"] != lifecycle["view"]
            or allocation.get("eyeOutputAllocation") is not True or allocation.get("recordReady") is not True
            or type(allocation.get("failures")) is not int or allocation["failures"] != 0):
        errors.append("Native view lifecycle is not bound to its successful allocation")
    limits = {"appendCallbacks": (1, 120), "extraViewActivations": (1, 0xFFFFFFFF),
              "withdrawalPublications": (3, 0xFFFFFFFF), "primaryOnlyActivationsAfterWithdrawal": (3, 0xFFFFFFFF),
              "pendingAppendedPublications": (0, 0), "guardFailures": (0, 0)}
    for field, (minimum, maximum) in limits.items():
        if not integer(lifecycle.get(field), minimum, maximum):
            errors.append("Native view withdrawal is incomplete: " + field)


def analyze_capture(raw, name, *, loader_receipt, expected_pid,
                    expected_process_created_filetime, observed_process_created_filetime,
                    draw_manifest, timed_out=False):
    """Bind diagnostic evidence to supplied owner observations, without mutation.

    Capture absence before dispatch, file pinning, Save loaded and invocation
    consumption remain the existing session owner's responsibilities. This
    result cannot prove process exit, even if the input claims otherwise.
    """
    rows, errors = parse_capture(raw)
    identity_errors = []
    loader = loader_receipt if isinstance(loader_receipt, dict) else {}
    if (not integer(expected_pid, 1, 0xFFFFFFFF) or type(loader.get("pid")) is not int
            or loader.get("pid") != expected_pid
            or name != "native-paired-source-observe-%s.jsonl" % expected_pid):
        identity_errors.append("Loader/capture PID differs from the exact expected process")
    if (not filetime(expected_process_created_filetime)
            or observed_process_created_filetime != expected_process_created_filetime
            or not filetime(observed_process_created_filetime)):
        identity_errors.append("Exact process creation FileTime binding is absent or changed")
    if (loader.get("dllSha256") != DLL_SHA256 or loader.get("moduleLoaded") is not True
            or loader.get("recordingConfirmed") is not False
            or loader.get("moduleRetainedUntilProcessExit") is not True):
        identity_errors.append("Reviewed paired loader receipt is incomplete or contradictory")
    if type(timed_out) is not bool or timed_out:
        errors.append("Capture timed out or watchdog evidence is invalid")
    try:
        expected = expected_hooks(draw_manifest)
        hooks = [row for row in rows if "hookRva" in row]
        if (len(hooks) != 7 or any(not integer(row["hookRva"], 1, 0xFFFFFFFF)
                                 or row.get("prepared") is not True for row in hooks)
                or Counter(row["hookRva"] for row in hooks) != Counter(expected)):
            errors.append("Seven exact reviewed hooks were not uniquely prepared")
    except (ValueError, TypeError, AttributeError):
        errors.append("Exact reviewed hook manifest is unavailable")
    recording = [row for row in rows if row.get("status") == "recording"]
    if len(recording) != 1 or recording[0].get("exeSha256") != GAME_SHA256:
        errors.append("Exact game recording admission is unproven")
    if any(isinstance(row.get("status"), str) and row["status"].startswith("rejected-") for row in rows):
        errors.append("Native admission was rejected")
    terminals = [row for row in rows if "originalBytesAndProtectionRestored" in row]
    terminal = terminals[0] if len(terminals) == 1 else {}
    if not terminal or not rows or terminal is not rows[-1]:
        errors.append("One restoration receipt must be the final record")
    events = sum("kind" in row for row in rows)
    if (terminal.get("installed") is not True or not integer(terminal.get("written"), 0, 32768)
            or terminal.get("written") != events or type(terminal.get("dropped")) is not int
            or terminal.get("dropped") != 0 or type(terminal.get("attempted")) is not int
            or terminal.get("attempted") != terminal.get("written")):
        errors.append("Native boundary accounting/restoration evidence is incomplete")
    typed_paired_records(rows, errors)
    validate_view_withdrawal(rows, errors)
    if not errors:
        reconcile_paired_events(rows, errors)
    diagnostic = None
    # Malformed identities must never reach the diagnostic model's dictionary
    # keys or comparisons. Retain the parse errors as an incomplete result.
    if not errors:
        try:
            diagnostic = diagnostic_module().analyze(rows)
            errors.extend(diagnostic.get("errors", ["Missing diagnostic verdict"]))
            if diagnostic.get("outcome") != "OBSERVATION_COMPLETE_NO_PIXEL_AUTHORITY":
                errors.append("Paired native observation is incomplete")
        except (ValueError, TypeError, KeyError, OSError):
            errors.append("Paired diagnostic analysis could not be completed")
    accepted = not errors and not identity_errors
    return {"schemaVersion": "stephanos.paired-source-session-analysis.v1",
            "outcome": "PAIRED_DIAGNOSTIC_ACCEPTED_NO_PIXEL_AUTHORITY" if accepted else "PAIRED_DIAGNOSTIC_INCOMPLETE",
            "monitorCaptureAccepted": accepted, "captureEvidencePassed": not errors,
            "sessionIdentityPassed": not identity_errors,
            "reasons": (identity_errors + errors)[:128],
            "reasonCount": len(identity_errors) + len(errors), "diagnostic": diagnostic,
            "captureFile": {"name": name, "bytes": len(raw) if type(raw) is bytes else None,
                            "sha256": digest(raw) if type(raw) is bytes else None},
            "normalProcessExitRequired": True, "processExitProven": False,
            "freshHumanConfirmationValidatedByThisAnalyzer": False,
            **{claim: False for claim in FALSE_CLAIMS}}
