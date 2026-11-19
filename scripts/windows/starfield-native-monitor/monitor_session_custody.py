"""Shared read-only custody evidence for the existing Starfield monitor owner.

This module cannot create a session, acquire a lease, launch a process, load a
DLL, or change provider state. Both the splash and successor admission consume
this one validator. Its caller must authenticate the core and reviewed hashes.
"""
import hashlib
import os
import re

HEX32 = re.compile(r"[0-9a-f]{32}\Z")
PAIRED_PROFILE = "paired-source-v1"
PAIRED_DLL_SHA256 = "9a4c08bc6b8ce26280b56b551880f799ecab3df3df97cdc0375391dad37a4185"
PAIRED_LOADER_SHA256 = "694a704d2a00f18892bd24e53e0df49862275113323d1f7f662a085d2fdfee04"
PAIRED_SESSION_NAME = "native-paired-source-monitor-session-v1.json"
PREDECESSOR_SCHEMA = "stephanos.starfield-monitor-predecessor.v1"


class CustodyError(RuntimeError):
    pass


def custody_paths(core, helper):
    """Exactly the paths used by the splash's absence-only fast check."""
    return {"outer": core.RUN_DIRECTORY / "session.json",
            "outerLock": core.RUN_DIRECTORY / "operator.lock",
            "stockMarker": core.RUN_DIRECTORY / "stock-child-consumed.json",
            "loadMarker": core.RUN_DIRECTORY / "loader-child-consumed.json",
            "starter": core.SOURCE / helper.SESSION_NAME,
            "starterLock": (core.SOURCE / helper.SESSION_NAME).with_suffix(".lock"),
            "heldProxy": helper.HELD,
            "pairedDirectory": core.RUN_DIRECTORY / PAIRED_PROFILE,
            "pairedOuter": core.RUN_DIRECTORY / PAIRED_PROFILE / "session.json",
            "pairedStockMarker": core.RUN_DIRECTORY / PAIRED_PROFILE / "stock-child-consumed.json",
            "pairedLoadMarker": core.RUN_DIRECTORY / PAIRED_PROFILE / "loader-child-consumed.json",
            "pairedStarter": core.SOURCE / PAIRED_SESSION_NAME}


def custody_snapshot(core, helper):
    values = {}
    for name, path in custody_paths(core, helper).items():
        path = core.plain_path(path)
        if not path.exists():
            values[name] = None
        elif name in {"heldProxy", "pairedDirectory"}:
            # Any held-path presence is a hold; never inspect arbitrary bytes.
            info = path.stat()
            if name == "pairedDirectory" and not path.is_dir():
                raise CustodyError("MONITOR_PAIRED_NAMESPACE_INVALID")
            values[name] = (info.st_size, info.st_mtime_ns)
        else:
            values[name] = core.bounded_bytes(path, 1024 * 1024 if name in {"outer", "starter", "pairedOuter", "pairedStarter"} else 8192)
    if any(values[key] is not None for key in ("outer", "starter", "pairedOuter", "pairedStarter")):
        receipt = core.plain_path(core.SOURCE / "proxy-isolation-receipt.json")
        values["restoreReceipt"] = core.bounded_bytes(receipt, 32768) if receipt.exists() else None
    return values


def validate_released_custody(core, helper, outer, starter, restore, *, runner_hashes, paired=False):
    """Consume typed terminal evidence, never a loose completed/true label."""
    if type(paired) is not bool:
        raise CustodyError("MONITOR_PROFILE_INVALID")
    dll = PAIRED_DLL_SHA256 if paired else core.DLL_SHA256
    if paired and any(record is not None and (not isinstance(record, dict)
                     or record.get("sessionProfile") != PAIRED_PROFILE) for record in (outer, starter)):
        raise CustodyError("MONITOR_PAIRED_PROFILE_MISMATCH")
    if outer is None and starter is None:
        raise CustodyError("MONITOR_CUSTODY_ORPHANED")
    if outer is not None:
        if (not isinstance(outer, dict) or outer.get("schema") != core.SCHEMA
                or outer.get("workspace") != str(core.WORKSPACE)
                or outer.get("handoffSha256") != core.HANDOFF_SHA256
                or outer.get("reviewedDllSha256") != dll
                or not isinstance(outer.get("runId"), str) or HEX32.fullmatch(outer["runId"]) is None
                or outer.get("runnerSha256") not in runner_hashes
                or outer.get("stage") != "CLEANUP_COMPLETE"
                or outer.get("cleanupComplete") is not True
                or "activeChild" not in outer or outer["activeChild"] is not None
                or type(outer.get("captureAttempted")) is not bool
                or type(outer.get("saveLoadedConfirmed")) is not bool
                or not isinstance(outer.get("childCalls"), list) or len(outer["childCalls"]) > 2048):
            raise CustodyError("MONITOR_OUTER_CLEANUP_UNPROVEN")
        child_ids = set()
        for child in outer["childCalls"]:
            if (not isinstance(child, dict) or not isinstance(child.get("id"), str)
                    or HEX32.fullmatch(child["id"]) is None or child["id"] in child_ids
                    or child.get("role") not in {"start", "status", "finish", "modules", "scene", "stock", "load"}
                    or child.get("state") not in {"RETURNED", "NOT_STARTED"}):
                raise CustodyError("MONITOR_CHILD_CUSTODY_UNRESOLVED")
            child_ids.add(child["id"])
        cleanup = outer.get("cleanupReceipt")
        if not isinstance(cleanup, dict) or cleanup.get("proxyRestored") is not True:
            raise CustodyError("MONITOR_CLEANUP_RECEIPT_UNPROVEN")
    else:
        cleanup = None
    if starter is None:
        if (outer.get("starterSessionId") is not None or outer.get("process") is not None
                or outer["captureAttempted"] is not False or outer["saveLoadedConfirmed"] is not False
                or cleanup.get("stage") != "NO_STARTER_SESSION_NO_GAME_PROXY_RESTORED"
                or any(child["role"] != "status" for child in outer["childCalls"])):
            raise CustodyError("MONITOR_STARTER_CUSTODY_MISSING")
    else:
        if (not isinstance(starter, dict) or starter.get("schema") != helper.SCHEMA
                or starter.get("workspace") != str(core.WORKSPACE)
                or starter.get("handoffSha256") != core.HANDOFF_SHA256
                or starter.get("reviewedDllSha256") != dll
                or starter.get("sourceArchiveSha256") != helper.ARCHIVE_HASH
                or not isinstance(starter.get("sessionId"), str) or HEX32.fullmatch(starter["sessionId"]) is None
                or starter.get("proxyRestored") is not True
                or type(starter.get("launchRequested")) is not bool
                or starter.get("injected") is not False or starter.get("captureAttempted") is not False
                or starter.get("saveLoadedConfirmed") is not False):
            raise CustodyError("MONITOR_STARTER_CLEANUP_UNPROVEN")
        if starter["launchRequested"]:
            if (starter.get("stage") != "GAME_EXIT_OBSERVED_PROXY_RESTORED"
                    or starter.get("gameExitObserved") is not True
                    or not core.process_valid(starter.get("process"))):
                raise CustodyError("MONITOR_GAME_EXIT_UNPROVEN")
        elif starter.get("stage") != "PRELAUNCH_ABORT_PROXY_RESTORED" or starter.get("process") is not None:
            raise CustodyError("MONITOR_PRELAUNCH_CLEANUP_UNPROVEN")
        if outer is not None:
            if (outer.get("starterSessionId") != starter["sessionId"]
                    or cleanup.get("sessionId") != starter["sessionId"]
                    or cleanup.get("stage") != starter["stage"]
                    or core.json_bytes(cleanup.get("process")) != core.json_bytes(starter.get("process"))
                    or core.json_bytes(outer.get("process")) != core.json_bytes(starter.get("process"))
                    or (starter["launchRequested"] and cleanup.get("gameExitObserved") is not True)):
                raise CustodyError("MONITOR_CLEANUP_IDENTITY_MISMATCH")
        if (not isinstance(restore, dict) or restore.get("stage") != "restored"
                or restore.get("source") != str(helper.PROXY) or restore.get("held") != str(helper.HELD)
                or restore.get("expectedSha256") != helper.PROXY_HASH
                or restore.get("sourceSha256") != helper.PROXY_HASH
                or "heldSha256" not in restore or restore["heldSha256"] is not None
                or not isinstance(restore.get("utc"), str) or not restore["utc"]):
            raise CustodyError("MONITOR_PROXY_RESTORE_RECEIPT_UNPROVEN")


def validate_attempt(core, helper, first, *, runner_hashes, paired=False):
    outer = core.strict_json(first["outer"]) if first["outer"] is not None else None
    starter = core.strict_json(first["starter"]) if first["starter"] is not None else None
    restore = core.strict_json(first["restoreReceipt"]) if first.get("restoreReceipt") is not None else None
    validate_released_custody(core, helper, outer, starter, restore, runner_hashes=runner_hashes, paired=paired)
    for name in ("stockMarker", "loadMarker"):
        if first[name] is None:
            if name == "loadMarker" and outer is not None and outer.get("probeLoadedProven") is True:
                raise CustodyError("MONITOR_LOAD_RECEIPT_UNPROVEN")
            continue
        marker = core.strict_json(first[name])
        process = outer.get("process") if isinstance(outer, dict) else None
        if (not isinstance(marker, dict) or not core.process_valid(process)
                or marker.get("runId") != outer["runId"] or type(marker.get("pid")) is not int
                or marker["pid"] != process["pid"] or marker.get("createdFileTime") != process["createdFileTime"]):
            raise CustodyError("MONITOR_INVOCATION_CUSTODY_MISMATCH")
        if name == "loadMarker" and (outer.get("captureAttempted") is not True
                or marker.get("attemptToken") != outer.get("captureAttemptToken")
                or marker.get("starterSessionId") != outer.get("starterSessionId")
                or marker.get("reviewedDllSha256") != (PAIRED_DLL_SHA256 if paired else core.DLL_SHA256)
                or marker.get("loaderSha256") != (PAIRED_LOADER_SHA256 if paired else core.LOADER_SHA256)):
            raise CustodyError("MONITOR_LOAD_CUSTODY_MISMATCH")
    return outer, starter, restore


def predecessor_identity(snapshot):
    """Exact immutable owner records; current proxy receipt is separately mutable."""
    return {key + "Sha256": hashlib.sha256(snapshot[key]).hexdigest()
            if snapshot[key] is not None else None
            for key in ("outer", "starter", "stockMarker", "loadMarker")}


def validate_predecessor(core, helper, snapshot, proof, *, runner_hashes):
    if (not isinstance(proof, dict) or proof.get("schema") != PREDECESSOR_SCHEMA
            or proof.get("identity") != predecessor_identity(snapshot)
            or snapshot["outer"] is None or snapshot["starter"] is None
            or not isinstance(proof.get("restoreReceipt"), dict)):
        raise CustodyError("MONITOR_PREDECESSOR_IDENTITY_CHANGED")
    historical = dict(snapshot, restoreReceipt=core.json_bytes(proof["restoreReceipt"]))
    validate_attempt(core, helper, historical, runner_hashes=runner_hashes)


def admit_successor(core, helper, owner_token, *, runner_hashes, host_factory=None):
    """Read-only prerequisite under the already-held common operator lock.

    This returns predecessor evidence, not permission to inject. The caller must
    retain the lock, reserve its attempt, pin inputs and require the fresh button.
    Unknown historical normal exit stays unknown; current absence is separate.
    """
    first = custody_snapshot(core, helper)
    owner = core.strict_json(owner_token)
    if (not isinstance(owner, dict) or type(owner.get("pid")) is not int
            or owner["pid"] != os.getpid() or not isinstance(owner.get("owner"), str)
            or HEX32.fullmatch(owner["owner"]) is None or first["outerLock"] != owner_token):
        raise CustodyError("MONITOR_SUCCESSOR_COMMON_LOCK_NOT_OWNED")
    if any(first[key] is not None for key in ("starterLock", "heldProxy", "pairedDirectory",
            "pairedOuter", "pairedStarter", "pairedStockMarker", "pairedLoadMarker")):
        raise CustodyError("MONITOR_SUCCESSOR_ALREADY_PRESENT_OR_CUSTODY_HELD")
    if first["outer"] is None or first["starter"] is None:
        raise CustodyError("MONITOR_SUCCESSOR_PREDECESSOR_REQUIRED")
    _outer, _starter, restore = validate_attempt(core, helper, first, runner_hashes=runner_hashes)
    host = (host_factory or helper.WindowsHost)()
    games = host.games()
    if not isinstance(games, list) or games or host.proxy_state() != "restored":
        raise CustodyError("MONITOR_SUCCESSOR_CURRENT_EXCLUSION_UNPROVEN")
    if custody_snapshot(core, helper) != first:
        raise CustodyError("MONITOR_CUSTODY_CHANGED_DURING_OBSERVATION")
    return {"schema": PREDECESSOR_SCHEMA, "identity": predecessor_identity(first),
            "restoreReceipt": restore, "historicalNormalExitUpgraded": False}


def provider_custody(core, helper, host_factory=None, *, runner_hashes):
    """Observe both fixed attempts under their common locks; never mutate."""
    first = custody_snapshot(core, helper)
    if all(value is None for value in first.values()):
        if custody_snapshot(core, helper) != first:
            raise CustodyError("MONITOR_CUSTODY_CHANGED_DURING_OBSERVATION")
        return {"allowed": True, "providerSlotReleased": True, "reason": "NO_MONITOR_CUSTODY",
                "observationsCurrent": True, "noMutationPerformed": True}
    if any(first[key] is not None for key in ("outerLock", "starterLock", "heldProxy")):
        return {"allowed": False, "providerSlotReleased": False, "reason": "MONITOR_CUSTODY_HELD",
                "observationsCurrent": True, "noMutationPerformed": True}
    validate_attempt(core, helper, first, runner_hashes=runner_hashes)
    if any(first[key] is not None for key in ("pairedDirectory", "pairedOuter", "pairedStarter",
                                            "pairedStockMarker", "pairedLoadMarker")):
        if first["pairedDirectory"] is None or first["pairedOuter"] is None:
            raise CustodyError("MONITOR_PAIRED_CUSTODY_ORPHANED")
        paired = {key: first[value] for key, value in {
            "outer": "pairedOuter", "starter": "pairedStarter", "stockMarker": "pairedStockMarker",
            "loadMarker": "pairedLoadMarker"}.items()}
        paired["restoreReceipt"] = first.get("restoreReceipt")
        outer, _starter, _restore = validate_attempt(core, helper, paired,
                                                    runner_hashes=runner_hashes, paired=True)
        validate_predecessor(core, helper, first, outer.get("predecessor"), runner_hashes=runner_hashes)
    host = (host_factory or helper.WindowsHost)()
    # A later legitimate VorpX/MutaR selection can change dxgi.dll. Completed
    # monitor custody is proved by its terminal owner/restore records, absent
    # locks and held path, and no live game; do not freeze the provider forever
    # to the monitor's original proxy hash. Existing slot validation still runs.
    games = host.games()
    if not isinstance(games, list) or games:
        raise CustodyError("MONITOR_GAME_STILL_PRESENT_OR_UNOBSERVED")
    if custody_snapshot(core, helper) != first:
        raise CustodyError("MONITOR_CUSTODY_CHANGED_DURING_OBSERVATION")
    return {"allowed": True, "providerSlotReleased": True, "reason": "MONITOR_CUSTODY_RELEASED",
            "observationsCurrent": True, "noMutationPerformed": True}
