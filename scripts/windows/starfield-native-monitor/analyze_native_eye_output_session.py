"""Read-only analysis for the exact reviewed native-eye-output monitor probe.

This module does not import the Windows loader, load a DLL, operate a process,
or write files. A passing result is evidence about this bounded monitor probe;
it is neither authorization to run another probe nor proof of playable stereo.
The native JSONL has no PID or creation FileTime: those are supplied separately
by the session wrapper, which must bind the fresh file and process before use.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct
from typing import Any


GAME_SHA256 = "7e9adb1414a8e1b325e5e1f097b9b17b78deb7eebeda37a333351a43a60f9d28"
REVIEWED_DLL_SHA256 = "43e6fd3b2a3e92abd11312e46d1f17ef427a220185fb4a3271b702b7efab8448"
EXPECTED_HOOK_RVAS = (39057584, 43076496, 45579072, 44407744, 0x2B16E90, 0x2B177C0)
PLAN_STATES = (
    "Empty", "InvalidSnapshot", "InvalidCall", "InvalidDescriptor", "InvalidMap",
    "InvalidOwner", "TupleCollision", "UnsupportedTexture", "Changed", "Ready",
)
ALLOCATION_FLAGS = (
    "recordReady", "nativeCompilerInvoked", "nativeCompilerReturned",
    "compiledResultValid", "parentUnchanged", "privateMapExpected",
    "bindingExpected", "sourceUnchanged", "newRowExpected", "lifetimeExpected",
)
UNPROVEN_FIELDS = (
    "pixelsCaptured", "eyeTexturesCaptured", "gpuCommandsIssued",
    "sameSimulationUpdateProven", "independentPhysicalAllocationProven",
    "independentAllocationsProven", "gpuRetirementProven",
    "pairedPublicationProven", "collectionEpochProven",
    "auditIssuesGpuCommands", "auditWritesResources", "gpuCaptureArmed",
)
TEXTURE_SIGNATURE = ("dimension", "width", "height", "arraySize", "mipLevels", "format", "sampleCount")
TIMING = {
    "loaderThreadWaitSeconds": 30,
    "nativeReadinessSeconds": 60,
    "nativeCaptureSeconds": 60,
    "nativeViewWithdrawalDrainSeconds": 10,
    "nativeCompilerDrainSeconds": 10,
    "nativeReportDrainSeconds": 1,
    "nativePostRestoreDelaySeconds": 0.25,
    "suggestedWatchdogAfterLoaderReturnSeconds": 180,
    "suggestedWatchdogFromLoaderStartSeconds": 210,
    "note": "Startup hashing/calibration, scheduling and final file I/O are additional; timeout is incomplete evidence, never permission to kill the game or reuse this attempt.",
}


def _integer(value: Any, minimum: int = 0, maximum: int | None = None) -> bool:
    return type(value) is int and value >= minimum and (maximum is None or value <= maximum)


def _decimal_identity(value: Any) -> str | None:
    if type(value) is int and value > 0:
        return str(value)
    if isinstance(value, str) and re.fullmatch(r"[1-9][0-9]*", value):
        return value
    return None


def _tuple(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(_integer(x, 0, 0xFFFFFFFF) for x in value)


def _one(records: list[dict], key: str, errors: list[str], *, marker: bool = False) -> dict:
    found = [r for r in records if (r.get(key) is True if marker else key in r)]
    if len(found) != 1:
        errors.append(f"{key}: expected one receipt, found {len(found)}")
        return {}
    return found[0]


def _require(condition: bool, reasons: list[str], text: str) -> None:
    if not condition:
        reasons.append(text)


def _strict_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def strict_json(text: str) -> Any:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite JSON constant: {value}")
    return json.loads(text, object_pairs_hook=_strict_object, parse_constant=reject_constant)


def parse_jsonl(text: str) -> tuple[list[dict], list[str]]:
    """Keep partial valid evidence, but make every malformed/truncated line explicit."""
    records: list[dict] = []
    errors: list[str] = []
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = strict_json(line)
            if not isinstance(record, dict):
                raise ValueError("record is not an object")
            records.append(record)
        except (ValueError, TypeError) as exc:
            errors.append(f"line {number}: {exc}")
    if text and not text.endswith("\n"):
        errors.append("file does not end with the newline written by the native worker")
    return records, errors


def _binding_copy_evidence(records: list[dict], allocation: dict, reasons: list[str]) -> list[int]:
    """Corroborate childCopied using exact 32-byte records already in the journal."""
    candidates = [r for r in records if "bindingAuditSample" in r and r.get("eye") == 1]
    corroborated = []
    for sample in candidates:
        index = sample.get("bindingAuditSample")
        if not _integer(index, 4, 7) or sample.get("valid") is not True or sample.get("viewStable") is not True:
            continue
        phases = [r for r in records if r.get("sample") == index and r.get("bindingPhase") == 1]
        if len(phases) != 1 or phases[0].get("valid") is not True or phases[0].get("view") != allocation.get("view"):
            continue
        copied = []
        for table in (1, 2):
            items = [r for r in records if r.get("sample") == index and r.get("phase") == 1
                     and r.get("table") == table and r.get("bindingItem") == 0]
            if len(items) != 1:
                copied.append(None)
                continue
            try:
                raw = bytes.fromhex(items[0]["bytes"])
            except (KeyError, ValueError, TypeError):
                raw = b""
            copied.append(raw if len(raw) == 32 else None)
        if copied[0] is not None and copied[0] == copied[1]:
            key = list(struct.unpack_from("<III", copied[0]))
            if key == allocation.get("eyeKey"):
                corroborated.append(index)
    _require(bool(corroborated), reasons, "no unique post-compile extra-view container/child pair has identical 32-byte binding and the expected eye key")
    return corroborated


def analyze_records(
    records: list[dict], *, loader_receipt: dict | None = None,
    expected_pid: int | None = None,
    expected_process_created_filetime: str | int | None = None,
    observed_process_created_filetime: str | int | None = None,
    capture_pid: int | None = None,
    timed_out: bool = False,
    parse_errors: list[str] | None = None,
) -> dict:
    """Analyze supplied records without any process, filesystem, or Windows access.

    FileTime accepts exact Python integers or decimal strings, never floats.
    sessionIdentityPassed checks the supplied wrapper observations; it cannot
    independently establish their provenance or a fresh human confirmation.
    The wrapper remains responsible for those and for normal game/proxy cleanup.
    """
    integrity_reasons = list(parse_errors or [])
    raw_count = len(records)
    if any(not isinstance(r, dict) for r in records):
        integrity_reasons.append("non-object record supplied")
    records = [r for r in records if isinstance(r, dict)]
    for index, record in enumerate(records):
        for field in UNPROVEN_FIELDS:
            if field in record and record[field] is not False:
                integrity_reasons.append(f"record {index}: {field} contradicts the reviewed probe's false-only claim")

    statuses = [r["status"] for r in records if isinstance(r.get("status"), str)]
    rejections = [s for s in statuses if s.startswith("rejected-")]
    if rejections:
        integrity_reasons.append("native worker rejected admission: " + ", ".join(rejections))
    terminal = records[-1] if records and "originalBytesAndProtectionRestored" in records[-1] else {}
    terminals = [r for r in records if "originalBytesAndProtectionRestored" in r]
    _require(len(terminals) == 1 and bool(terminal), integrity_reasons, "exactly one complete terminal receipt must be the final record")
    event_count = sum("kind" in r for r in records)
    if terminal:
        _require(_integer(terminal.get("written"), 0, 32768) and terminal.get("written") == event_count,
                 integrity_reasons, "terminal written count does not match the event records")
        _require(_integer(terminal.get("attempted")) and _integer(terminal.get("dropped"))
                 and terminal.get("attempted") == terminal.get("written", -1) + terminal.get("dropped", -1),
                 integrity_reasons, "terminal attempted/written/dropped accounting is inconsistent")

    # This is a wrapper identity check, separate from native recording and results.
    identity_reasons: list[str] = []
    loader = loader_receipt if isinstance(loader_receipt, dict) else {}
    _require(_integer(expected_pid, 1), identity_reasons, "expected fresh PID was not supplied")
    _require(_integer(loader.get("pid"), 1) and loader.get("pid") == expected_pid,
             identity_reasons, "loader PID differs from expected fresh PID or is missing")
    _require(loader.get("dllSha256") == REVIEWED_DLL_SHA256, identity_reasons, "loader DLL hash is missing or differs from the reviewed DLL")
    _require(loader.get("moduleLoaded") is True, identity_reasons, "loader did not report moduleLoaded=true")
    _require(loader.get("recordingConfirmed") is False, identity_reasons, "loader recordingConfirmed must remain false; only the journal can prove recording")
    _require(loader.get("moduleRetainedUntilProcessExit") is True, identity_reasons, "loader process-exit retention receipt is missing")
    expected_time = _decimal_identity(expected_process_created_filetime)
    observed_time = _decimal_identity(observed_process_created_filetime)
    _require(expected_time is not None and observed_time == expected_time, identity_reasons,
             "exact expected/observed creation FileTime binding is missing or differs (floats are refused)")
    if capture_pid is not None:
        _require(_integer(capture_pid, 1) and capture_pid == expected_pid, identity_reasons,
                 "capture filename PID differs from the expected fresh PID")

    admission_reasons: list[str] = []
    hooks = [r for r in records if "hookRva" in r]
    _require(len(hooks) == 6 and all(_integer(r.get("hookRva"), 1) for r in hooks)
             and Counter(r.get("hookRva") for r in hooks) == Counter(EXPECTED_HOOK_RVAS)
             and all(r.get("prepared") is True for r in hooks), admission_reasons,
             "all six exact reviewed hooks were not uniquely prepared")
    recording = [r for r in records if r.get("status") == "recording"]
    _require(len(recording) == 1 and recording[0].get("exeSha256") == GAME_SHA256,
             admission_reasons, "one recording receipt for the exact inspected game is required")
    staging = _one(records, "captureStaging", admission_reasons, marker=True)
    _require(staging.get("outcome") == "capture-armed" and staging.get("captureArmed") is True
             and staging.get("firstEligibleSampleValid") is True, admission_reasons,
             "verified camera context was not reacquired and capture armed")

    allocation_reasons: list[str] = []
    allocation = _one(records, "eyeOutputAllocation", allocation_reasons, marker=True)
    for field in ALLOCATION_FLAGS:
        _require(allocation.get(field) is True, allocation_reasons, f"{field} is not true")
    for field, value in (("attempts", 1), ("extraCompiles", 1), ("failures", 0), ("planState", 9)):
        _require(type(allocation.get(field)) is int and allocation[field] == value,
                 allocation_reasons, f"{field} must be {value}, observed {allocation.get(field)!r}")
    primary_key, eye_key = allocation.get("primaryKey"), allocation.get("eyeKey")
    _require(_tuple(primary_key) and _tuple(eye_key) and primary_key[:2] == [25, 0]
             and eye_key[:2] == [25, 0] and primary_key[2] > 0 and eye_key[2] > 0 and primary_key != eye_key,
             allocation_reasons, "primary and extra output semantic tuples are missing, invalid, or collide")
    _require(_integer(allocation.get("primaryResourceCandidate"), 0x10000), allocation_reasons,
             "original source resource candidate is missing")
    _require(_integer(allocation.get("view"), 1, 0xFFFFFFFF), allocation_reasons, "extra view identity is missing")

    child_reasons: list[str] = []
    _require(allocation.get("childCopied") is True, child_reasons, "childCopied is not true")
    _require(allocation.get("viewStable") is True, child_reasons, "viewStable is not true")
    child_samples = _binding_copy_evidence(records, allocation, child_reasons)

    material_reasons: list[str] = []
    observations: list[dict] = []
    consumed_maps: set[int] = set()
    consumed_textures: set[int] = set()
    extra_view = allocation.get("view")
    for index, header in enumerate(records):
        if header.get("nativeEyeOutputDescription") is not True:
            continue
        failures: list[str] = []
        mapped = records[index + 1] if index + 1 < len(records) else {}
        texture = records[index + 2] if index + 2 < len(records) else {}
        adjacent = "outputMapState" in mapped and texture.get("textureDescription") is True
        _require(adjacent, failures, "typed attempt lacks the adjacent output-map/texture pair")
        if adjacent:
            consumed_maps.add(index + 1)
            consumed_textures.add(index + 2)
        view, counter = header.get("view"), header.get("counterCandidate")
        _require(_integer(view, 1, 0xFFFFFFFF) and mapped.get("view") == view and texture.get("view") == view,
                 failures, "attempt view identity differs or is invalid")
        _require(_integer(counter, 0, 0xFFFFFFFF) and mapped.get("counterCandidate") == counter
                 and texture.get("counterCandidate") == counter, failures, "attempt counter identities differ or are invalid")
        _require(header.get("expectedBindingAndDimensions") is True, failures, "expectedBindingAndDimensions is not true")
        _require(type(mapped.get("outputMapState")) is int and mapped.get("outputMapState") == 5,
                 failures, "output mapping did not reach stable state 5")
        _require(texture.get("valid") is True, failures, "typed GetDesc result is not valid")
        resource = mapped.get("resourceCandidate")
        _require(_integer(resource, 0x10000) and texture.get("resource") == resource,
                 failures, "map and typed resource identities differ or are invalid")
        _require(_integer(mapped.get("matchingRows")) and mapped.get("matchingRows") == 1,
                 failures, "output tuple does not resolve to exactly one row")
        expected_key = eye_key if view == extra_view else primary_key
        _require(_tuple(mapped.get("key")) and mapped.get("key") == expected_key,
                 failures, "typed attempt does not use the expected primary/extra key")
        source_resource = allocation.get("primaryResourceCandidate")
        _require(_integer(source_resource, 0x10000)
                 and (resource != source_resource if view == extra_view else resource == source_resource),
                 failures, "typed attempt does not preserve original/source-versus-extra resource identity")
        # The reviewed plan copies four literal extent fields unchanged, keeps
        # the fifth unit field, and rejects dimensions whose width*height*4
        # exceeds 64 MiB. This is its admission-area proxy, not a measurement
        # of actual physical GPU allocation. A generic positive GetDesc is
        # weaker than the admitted non-array, single-mip, single-sample case.
        # The native format byte 0x24 is NOT a DXGI enum: compare actual typed
        # formats across views below, without inventing a numeric conversion.
        admitted_dimensions = (_integer(texture.get("width"), 1, 8192)
                               and _integer(texture.get("height"), 1, 8192)
                               and texture["width"] * texture["height"] * 4 <= 64 * 1024 * 1024)
        _require(texture.get("dimension") == 3 and type(texture.get("dimension")) is int
                 and admitted_dimensions
                 and _integer(texture.get("arraySize"), 1, 1) and _integer(texture.get("mipLevels"), 1, 1)
                 and _integer(texture.get("format"), 1) and _integer(texture.get("sampleCount"), 1, 1),
                 failures, "typed texture does not match the admitted 2D unit-array/unit-mip/unit-sample shape and 64MiB area bound")
        observations.append({
            "recordIndex": index, "view": view, "counterCandidate": counter,
            "resourceCandidate": resource, "row": mapped.get("row"),
            "wrapper": mapped.get("wrapper"), "key": mapped.get("key"),
            "description": {field: texture.get(field) for field in TEXTURE_SIGNATURE + ("flags",)},
            "passed": not failures, "reasons": failures,
        })
    actual_maps = {i for i, r in enumerate(records) if "outputMapState" in r}
    actual_textures = {i for i, r in enumerate(records) if r.get("textureDescription") is True}
    _require(actual_maps == consumed_maps and actual_textures == consumed_textures,
             material_reasons, "orphan output-map/texture records exist outside the native typed-attempt triplets")
    _require(len(observations) == 12, material_reasons, f"expected twelve bounded typed attempts, observed {len(observations)}")
    by_view: dict[int, list[dict]] = {}
    for observation in observations:
        if _integer(observation["view"], 1, 0xFFFFFFFF):
            by_view.setdefault(observation["view"], []).append(observation)
    _require(len(by_view) == 2 and _integer(extra_view, 1, 0xFFFFFFFF) and extra_view in by_view,
             material_reasons, "typed observations do not identify the original and extra views")
    per_view = []
    signatures = set()
    resources_by_view: dict[int, set[int]] = {}
    counters_by_view: dict[int, set[int]] = {}
    for view, attempts in sorted(by_view.items()):
        successful = [o for o in attempts if o["passed"]]
        _require(len(attempts) == 6 and len(successful) == 6, material_reasons,
                 f"view {view}: {len(attempts)} attempts, {len(successful)} successful typed observations; six of each required for full completion")
        resources_by_view[view] = {o["resourceCandidate"] for o in successful}
        counters_by_view[view] = {o["counterCandidate"] for o in successful}
        signatures.update(tuple(o["description"][field] for field in TEXTURE_SIGNATURE) for o in successful)
        per_view.append({"view": view, "eye": "extra" if view == extra_view else "primary",
                         "attempts": len(attempts), "successfulAttempts": len(successful),
                         "resourceCandidates": sorted(resources_by_view[view]),
                         "counterCandidates": sorted(counters_by_view[view])})
    _require(len(signatures) == 1, material_reasons, "successful typed observations do not share one matching actual texture format/dimension signature")
    both_observed = (len(resources_by_view) == 2 and _integer(extra_view, 1, 0xFFFFFFFF)
                     and extra_view in resources_by_view and all(resources_by_view.values()))
    distinct_resources = bool(both_observed and not set.intersection(*resources_by_view.values()))
    _require(distinct_resources, material_reasons, "both views do not have disjoint observed resource-object candidates")
    output_reasons: list[str] = []
    output = _one(records, "outputMapCallbacks", output_reasons)
    _require(type(output.get("outputMapCallbacks")) is int and output.get("outputMapCallbacks") == len(observations),
             output_reasons, "output callback receipt does not match the observed attempt count")
    _require(type(output.get("outputCallbacksStillActive")) is int and output.get("outputCallbacksStillActive") == 0,
             output_reasons, "output callbacks remain active or their final state is missing")
    material_reasons.extend(output_reasons)

    resource_reasons: list[str] = []
    resource_summary = _one(records, "resourceAuditFinished", resource_reasons, marker=True)
    resource_samples = [r for r in records if "resourceAuditSample" in r]
    indexes = [r.get("resourceAuditSample") for r in resource_samples]
    _require(len(indexes) == 12 and all(type(i) is int for i in indexes)
             and sorted(indexes) == list(range(12)), resource_reasons, "resource audit does not contain all twelve unique samples")
    primary_candidates = [view for view in by_view if view != extra_view]
    primary_view = primary_candidates[0] if len(primary_candidates) == 1 else None
    _require(_integer(primary_view, 1, 0xFFFFFFFF) and _integer(extra_view, 1, 0xFFFFFFFF)
             and primary_view != extra_view, resource_reasons,
             "resource samples cannot be bound to the observed primary and extra view identities")
    for sample in resource_samples:
        index = sample.get("resourceAuditSample")
        index_valid = _integer(index, 0, 11)
        expected_eye = index // 6 if index_valid else None
        expected_view = primary_view if expected_eye == 0 else extra_view if expected_eye == 1 else None
        _require(index_valid and type(sample.get("eye")) is int and sample.get("eye") == expected_eye
                 and _integer(sample.get("view"), 1, 0xFFFFFFFF) and sample.get("view") == expected_view,
                 resource_reasons, f"resource sample {index!r} does not bind index to its expected eye and view")
    per_eye = [sum(type(r.get("eye")) is int and r.get("eye") == eye for r in resource_samples) for eye in (0, 1)]
    stable_per_eye = [sum(type(r.get("eye")) is int and r.get("eye") == eye
                          and r.get("valid") is True and r.get("workerStable") is True
                          and r.get("viewStable") is True and _integer(r.get("counterBefore"), 0, 0xFFFFFFFF)
                          and _integer(r.get("counterAfter"), 0, 0xFFFFFFFF)
                          and r.get("counterBefore") == r.get("counterAfter") for r in resource_samples)
                      for eye in (0, 1)]
    _require(per_eye == [6, 6] and stable_per_eye == [6, 6], resource_reasons,
             f"resource audit stable samples per eye are {stable_per_eye}, not [6, 6]")
    summary_per_eye = resource_summary.get("samplesPerEye")
    summary_stable_per_eye = resource_summary.get("stableSamplesPerEye")
    _require(_integer(resource_summary.get("samplesWritten"), 0, 12)
             and resource_summary.get("samplesWritten") == len(resource_samples)
             and _integer(resource_summary.get("stableSamples"), 0, 12)
             and resource_summary.get("stableSamples") == sum(stable_per_eye)
             and _integer(resource_summary.get("sampleLimit"), 12, 12)
             and isinstance(summary_per_eye, list) and len(summary_per_eye) == 2
             and all(_integer(value, 0, 6) for value in summary_per_eye) and summary_per_eye == per_eye
             and isinstance(summary_stable_per_eye, list) and len(summary_stable_per_eye) == 2
             and all(_integer(value, 0, 6) for value in summary_stable_per_eye) and summary_stable_per_eye == stable_per_eye,
             resource_reasons, "resource audit summary disagrees with the individual samples")

    binding_reasons: list[str] = []
    binding_summary = _one(records, "bindingAuditFinished", binding_reasons, marker=True)
    binding_samples = [r for r in records if "bindingAuditSample" in r]
    binding_indexes = [r.get("bindingAuditSample") for r in binding_samples]
    _require(all(_integer(i, 0, 7) for i in binding_indexes)
             and len(set(binding_indexes)) == len(binding_indexes), binding_reasons,
             "binding audit sample identifiers are invalid or repeated")
    _require(binding_summary.get("samples") == len(binding_samples)
             and binding_summary.get("validSamples") == sum(r.get("valid") is True for r in binding_samples),
             binding_reasons, "binding audit summary disagrees with individual samples")
    _require(bool(child_samples), binding_reasons, "the single extra descriptor compile lacks a corroborating binding sample")

    withdrawal_reasons: list[str] = []
    lifecycle = _one(records, "nativeViewResult", withdrawal_reasons)
    _require(type(lifecycle.get("nativeViewResult")) is int and lifecycle.get("nativeViewResult") == 7,
             withdrawal_reasons, "extra view did not reach Initialized state 7")
    _require(lifecycle.get("view") == extra_view and _integer(extra_view, 1, 0xFFFFFFFF),
             withdrawal_reasons, "native lifecycle and allocation refer to different extra views")
    _require(_integer(lifecycle.get("appendCallbacks"), 1, 120), withdrawal_reasons,
             "native append count is missing or outside 1..120")
    _require(_integer(lifecycle.get("extraViewActivations"), 1), withdrawal_reasons, "no extra-view activation was recorded")
    _require(_integer(lifecycle.get("withdrawalPublications"), 3)
             and _integer(lifecycle.get("primaryOnlyActivationsAfterWithdrawal"), 3),
             withdrawal_reasons, "three withdrawal publications and later primary-only observations were not proven")
    for field in ("pendingAppendedPublications", "guardFailures"):
        _require(type(lifecycle.get(field)) is int and lifecycle.get(field) == 0,
                 withdrawal_reasons, f"{field} is not zero")

    restoration_reasons: list[str] = []
    _require(terminal.get("status") == "finished", restoration_reasons,
             f"native terminal status is {terminal.get('status')!r}, not finished")
    _require(terminal.get("installed") is True, restoration_reasons, "native hooks were not recorded as installed")
    _require(terminal.get("originalBytesAndProtectionRestored") is True, restoration_reasons,
             "original hook bytes and protection were not proven restored")
    _require(type(terminal.get("dropped")) is int and terminal.get("dropped") == 0,
             restoration_reasons, "native event records were dropped or the drop count is missing")

    def stage(reasons: list[str], **fields: Any) -> dict:
        return {"passed": not reasons, "reasons": reasons, **fields}

    plan_state = allocation.get("planState")
    plan_name = PLAN_STATES[plan_state] if _integer(plan_state, 0, len(PLAN_STATES) - 1) else "Unknown"
    stages = {
        "sessionIdentity": stage(identity_reasons, expectedPid=expected_pid, loaderPid=loader.get("pid"),
                                 expectedProcessCreatedFileTime=expected_time, observedProcessCreatedFileTime=observed_time,
                                 capturePid=capture_pid, nativeJournalIncludesProcessIdentity=False),
        "admission": stage(admission_reasons, hookPreparationCount=len(hooks), recordingReceipts=len(recording), staging=staging),
        "allocation": stage(allocation_reasons, planStateName=plan_name, receipt=allocation),
        "childBinding": stage(child_reasons, corroboratingSamples=child_samples),
        "materialization": stage(material_reasons, totalAttempts=len(observations),
                                 successfulAttempts=sum(o["passed"] for o in observations), views=per_view,
                                 bothViewsHaveTypedObservations=bool(both_observed),
                                 distinctResourceObjectCandidatesObserved=distinct_resources,
                                 actualTextureSignatures=[dict(zip(TEXTURE_SIGNATURE, s)) for s in sorted(signatures)],
                                 matchedCounterCandidates=sorted(set.intersection(*counters_by_view.values())) if both_observed else [],
                                 observations=observations, outputSummary=output),
        "resourceAudit": stage(resource_reasons, stableSamplesPerEye=stable_per_eye, receipt=resource_summary),
        "bindingAudit": stage(binding_reasons, actualSamples=len(binding_samples), receipt=binding_summary,
                              requiresEightSamples=False, note="One descriptor compilation is intentional; cached graphs need not produce the older eight-sample binding quota."),
        "withdrawal": stage(withdrawal_reasons, receipt=lifecycle),
        "restoration": stage(restoration_reasons, receipt=terminal),
        "journalIntegrity": stage(integrity_reasons, recordCount=raw_count, eventCount=event_count, statuses=statuses),
    }
    native_passed = all(value["passed"] for name, value in stages.items() if name != "sessionIdentity")
    identity_passed = stages["sessionIdentity"]["passed"]
    accepted = native_passed and identity_passed and not timed_out
    if timed_out:
        outcome = "MONITOR_TIMEOUT_INCOMPLETE"
    elif rejections:
        outcome = "NATIVE_ADMISSION_REJECTED"
    elif accepted:
        outcome = "BOUNDED_NATIVE_OUTPUT_MONITOR_PASSED"
    elif native_passed:
        outcome = "CAPTURE_EVIDENCE_UNBOUND_TO_FRESH_PROCESS"
    elif not terminal:
        outcome = "NATIVE_CAPTURE_INCOMPLETE"
    else:
        outcome = "NATIVE_CAPTURE_REJECTED_OR_INCOMPLETE"
    reasons = [f"{name}: {reason}" for name, value in stages.items() for reason in value["reasons"]]
    if timed_out:
        reasons.insert(0, "monitor watchdog expired; preserve this consumed attempt and close the game normally")
    return {
        "schemaVersion": "stephanos.native-eye-output-analysis.v1",
        "outcome": outcome, "captureEvidencePassed": native_passed,
        "sessionIdentityPassed": identity_passed, "monitorCaptureAccepted": accepted,
        "timedOut": bool(timed_out), "stages": stages, "reasons": reasons,
        "observedFacts": {
            "nativeDescriptorCompilationPassed": stages["allocation"]["passed"],
            "childBindingPassed": stages["childBinding"]["passed"],
            "typedResourcesObservedInBothViews": bool(both_observed),
            "distinctResourceObjectCandidatesObserved": distinct_resources,
            "successfulTypedObservationCount": sum(o["passed"] for o in observations),
            "cpuWithdrawalPassed": stages["withdrawal"]["passed"],
            "nativeCodeRestorationPassed": stages["restoration"]["passed"],
        },
        "claims": {"pixelsCaptured": False, "independentPhysicalAllocationProven": False,
                   "sameSimulationUpdateProven": False, "persistentPerEyeHistoriesProven": False,
                   "gpuRetirementProven": False, "playableHeadsetStereoProven": False},
        "timing": TIMING.copy(),
        "normalGameExitRequiredBeforeProxyRestore": True,
        "freshHumanConfirmationValidatedByThisAnalyzer": False,
        "limitations": [
            "Distinct typed ID3D12Resource object candidates do not prove disjoint physical GPU allocation.",
            "Matching counter candidates do not prove an immutable same-update world snapshot.",
            "Native code restoration is separate from normal process exit and restoring the original game-folder proxy.",
            "The session wrapper must bind the fresh process, capture-file provenance and actual new save-loaded confirmation.",
            "No game, DLL, loader, or reviewed source is executed by this analysis.",
        ],
    }


def analyze_file(path: Path, **kwargs: Any) -> dict:
    raw = path.read_bytes()
    errors = []
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        text = raw.decode("utf-8-sig", errors="replace")
        errors.append(f"invalid UTF-8: {exc}")
    records, parse_errors = parse_jsonl(text)
    match = re.fullmatch(r"native-eye-output-([1-9][0-9]*)\.jsonl", path.name)
    if match is None:
        errors.append("capture filename does not match native-eye-output-<PID>.jsonl")
    kwargs["capture_pid"] = int(match.group(1)) if match else None
    kwargs["parse_errors"] = list(kwargs.pop("parse_errors", []) or []) + errors + parse_errors
    result = analyze_records(records, **kwargs)
    result["captureFile"] = {"name": path.name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--loader-receipt", type=Path)
    parser.add_argument("--expected-pid", type=int)
    parser.add_argument("--expected-process-created-filetime")
    parser.add_argument("--observed-process-created-filetime")
    parser.add_argument("--timed-out", action="store_true")
    args = parser.parse_args(argv)
    loader = strict_json(args.loader_receipt.read_text(encoding="utf-8-sig")) if args.loader_receipt else None
    result = analyze_file(args.capture, loader_receipt=loader, expected_pid=args.expected_pid,
                          expected_process_created_filetime=args.expected_process_created_filetime,
                          observed_process_created_filetime=args.observed_process_created_filetime,
                          timed_out=args.timed_out)
    print(json.dumps(result, indent=2))
    return 0 if result["monitorCaptureAccepted"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
