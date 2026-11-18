"""Bounded diagnostic analyzer. Local witness summaries confer no copy authority."""
import argparse
import json
from pathlib import Path

FALSE_PROOFS = ("gpuCopyCommandsIssued", "imagesRecorded", "pixelsCaptured", "gpuCompletionProven", "openxrSubmitted", "sameSimulationUpdateProven")

def analyze(rows):
    receipts = [r for r in rows if r.get("pairedSourceObservation") is True]
    events = [r for r in rows if "pairedEvent" in r]
    errors = []
    if len(receipts) != 1:
        return {"outcome": "INCOMPLETE_OBSERVATION_NO_PIXEL_AUTHORITY", "errors": ["Expected one observation receipt"], "pixelAuthority": False}
    receipt = receipts[0]
    terminal = [r for r in rows if "originalBytesAndProtectionRestored" in r]
    if len(terminal) != 1 or terminal[0].get("status") != "finished" or terminal[0].get("originalBytesAndProtectionRestored") is not True or terminal[0].get("dropped") != 0:
        errors.append("Native hook restoration or terminal journal evidence incomplete")
    for field in FALSE_PROOFS:
        if receipt.get(field) is not False:
            errors.append("Unproven or missing field: " + field)
    for field in ("bound", "nativeDrained", "comRestored", "coverageOwnedBeforeDisarm", "slotsRestored", "calleeBytesUnchanged", "exactPageFlagsRestored"):
        if receipt.get(field) is not True:
            errors.append("Incomplete observation: " + field)
    for field in ("failure", "modelFailure", "dropped", "openApi"):
        if type(receipt.get(field)) is not int or receipt[field] != 0:
            errors.append("Nonzero or missing failure count: " + field)
    for field in ("invalid", "sinkFaulted", "fiberPoisoned"):
        if receipt.get(field) is not False:
            errors.append("Invalid observation: " + field)
    if receipt.get("observationIsDiagnosticOnly") is not True:
        errors.append("Diagnostic-only receipt required")
    if receipt.get("records") != len(events) or receipt.get("attempted") != len(events):
        errors.append("Journal count mismatch")
    if receipt.get("windowReason") not in (1, 2):
        errors.append("Observation window ended by capacity, failure, or outer bound")
    sources = {}; states = {}; witnesses = [0, 0]
    for index, event in enumerate(events, 1):
        if event.get("sequence") != index:
            errors.append("Journal sequence mismatch");break
        kind = event.get("pairedEvent");role = event.get("role", 2)
        key = (event.get("list"), event.get("generation"))
        if kind == 1:
            if role not in (0, 1) or role in sources or not event.get("sourceCanonical") or not event.get("typedResource"):
                errors.append("Invalid source registration")
            else:sources[role] = (event["sourceCanonical"], event["typedResource"])
        if kind in (4, 6, 9) and (role not in sources or sources[role] != (event.get("sourceCanonical"), event.get("typedResource"))):
            errors.append("Source identity mismatch");continue
        if kind == 2 and event.get("success") is True and event.get("coveredResetGeneration") is True:
            states[key] = {"source": {}, "target": 2, "opaque": False, "predicate": False, "open": True}
        state = states.get(key)
        if not state:continue
        if kind == 3:state["open"] = False
        elif kind == 4:state["target"] = role
        elif kind == 5:state["target"] = 2
        elif kind == 6:
            before, after = event.get("before"), event.get("afterState")
            previous = state["source"].get(role)
            if event.get("wholeUnsplit") is not True or before == after or (previous is not None and previous != before):
                state["opaque"] = True
            else:state["source"][role] = after
        elif kind == 7:state["predicate"] = event.get("success") is True
        elif kind == 8:state["opaque"] = True
        elif kind == 9 and event.get("success") is True and event.get("coveredResetGeneration") is True:
            if state["open"] and not state["opaque"] and not state["predicate"] and state["target"] == role and state["source"].get(role) == 4:
                witnesses[role] += 1
    if set(sources) != {0, 1} or (len(sources) == 2 and (sources[0][0] == sources[1][0] or sources[0][1] == sources[1][1])):
        errors.append("Distinct paired registrations absent")
    return {"outcome": "INCOMPLETE_OBSERVATION_NO_PIXEL_AUTHORITY" if errors else "OBSERVATION_COMPLETE_NO_PIXEL_AUTHORITY",
            "errors": errors, "events": len(events), "diagnosticLocalWitnessCounts": witnesses,
            "pixelAuthority": False, "submissionAuthority": False, "gpuCompletionProven": False,
            "openxrSubmitted": False, "sameSimulationUpdateProven": False}

def main():
    parser = argparse.ArgumentParser();parser.add_argument("journal", type=Path);args = parser.parse_args()
    data = args.journal.read_bytes()
    if len(data) > 64 * 1024 * 1024:raise ValueError("journal exceeds diagnostic bound")
    lines = data.decode("utf-8").splitlines()
    if len(lines) > 20000:raise ValueError("too many journal records")
    rows = [json.loads(line) for line in lines if line.strip()]
    if any(not isinstance(row, dict) for row in rows):raise ValueError("non-object journal record")
    print(json.dumps(analyze(rows), indent=2))

if __name__ == "__main__":main()
