"""Synthetic evidence fixtures only; no private source, game or GPU execution."""
import copy
import importlib.util
import json
from pathlib import Path
import stat
import types
import unittest
from unittest.mock import patch

PATH = Path(__file__).with_name("analyze_paired_source_session.py")
spec = importlib.util.spec_from_file_location("paired_session_test", PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PID = 1234
BIRTH = "134384778410182996"
DRAW = 123456
MANIFEST = json.dumps({"exeSha256": m.GAME_SHA256, "hooks": {"fixture": {"rva": DRAW}}}).encode().ljust(207)


def rows():
    receipt = {"pairedSourceObservation": True, "schema": 1, "records": 3, "attempted": 3,
               "observationIsDiagnosticOnly": True, "windowReason": 1,
               "pagePolicyAccepted": True, "residualPrivateCowPages": 0,
               "normalProcessExitRequired": True, "sourceChecks": 2, "scopeRejected": 0,
               "draws": [0, 0], "transitions": [0, 0], "resets": 0, "executePairs": 0,
               "suppressedUnrelatedOrOutsideWindow": 0, "opaqueCallbacks": 0,
               "startCounter": 40, "cutCounter": 46}
    receipt.update({key: False for key in ("gpuCopyCommandsIssued", "imagesRecorded", "pixelsCaptured",
                   "gpuCompletionProven", "openxrSubmitted", "sameSimulationUpdateProven",
                   "invalid", "sinkFaulted", "fiberPoisoned")})
    receipt.update({key: True for key in ("bound", "nativeDrained", "comRestored", "coverageOwnedBeforeDisarm",
                   "slotsRestored", "calleeBytesUnchanged", "exactPageFlagsRestored")})
    receipt.update({key: 0 for key in ("failure", "modelFailure", "dropped", "openApi")})
    events = []
    for role in range(2):
        event = {key: 0 for key in ("serial", "list", "typedObject", "generation", "caller", "queueCanonical",
                 "counterCandidate", "thread", "before", "afterState", "nativeDepth", "count")}
        event.update(pairedEvent=1, sequence=role + 1, role=role, sourceCanonical=100 + role,
                     typedResource=200 + role, success=True, coveredResetGeneration=False,
                     wholeUnsplit=False, nativeDirectBatch=False, lists=[], counterCandidate=40)
        events.append(event)
    window = {key: 0 for key, value in events[0].items() if type(value) is int}
    window.update(pairedEvent=13, sequence=3, role=2, counterCandidate=46, success=False,
                  coveredResetGeneration=False, wholeUnsplit=False, nativeDirectBatch=False, lists=[])
    events.append(window)
    return ([{"hookRva": rva, "prepared": True} for rva in m.BASE_HOOKS + (DRAW,)]
            + [{"status": "recording", "exeSha256": m.GAME_SHA256}, receipt] + events
            + [{"eyeOutputAllocation": True, "view": 71, "recordReady": True, "failures": 0},
               {"nativeViewResult": 7, "view": 71, "appendCallbacks": 6, "extraViewActivations": 6,
                "withdrawalPublications": 3, "primaryOnlyActivationsAfterWithdrawal": 3,
                "pendingAppendedPublications": 0, "guardFailures": 0}]
            + [{"status": "finished", "installed": True, "originalBytesAndProtectionRestored": True,
                "written": 0, "attempted": 0, "dropped": 0}])


def encoded(records):
    return ("\n".join(json.dumps(row) for row in records) + "\n").encode()


def arguments():
    return {"name": "native-paired-source-observe-1234.jsonl", "expected_pid": PID,
            "expected_process_created_filetime": BIRTH, "observed_process_created_filetime": BIRTH,
            "draw_manifest": MANIFEST,
            "loader_receipt": {"pid": PID, "dllSha256": m.DLL_SHA256, "moduleLoaded": True,
                               "recordingConfirmed": False, "moduleRetainedUntilProcessExit": True}}


class PairedSessionEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.pin = patch.object(m, "DRAW_MANIFEST_SHA256", m.digest(MANIFEST))
        self.pin.start()
        self.addCleanup(self.pin.stop)

    def analyze(self, records=None, raw=None, **changes):
        args = arguments()
        args.update(changes)
        return m.analyze_capture(encoded(rows() if records is None else records) if raw is None else raw, **args)

    def incomplete(self, result):
        self.assertFalse(result["monitorCaptureAccepted"])
        self.assertTrue(result["reasons"])
        self.assertTrue(result["normalProcessExitRequired"])
        self.assertFalse(result["processExitProven"])
        for claim in m.FALSE_CLAIMS:
            self.assertIs(result[claim], False, claim)

    def test_complete_diagnostic_never_proves_exit_images_or_headset(self):
        result = self.analyze()
        self.assertTrue(result["monitorCaptureAccepted"], result["reasons"])
        self.assertTrue(result["sessionIdentityPassed"])
        self.assertFalse(result["processExitProven"])
        self.assertTrue(result["normalProcessExitRequired"])
        self.assertFalse(result["freshHumanConfirmationValidatedByThisAnalyzer"])
        for claim in m.FALSE_CLAIMS:
            self.assertIs(result[claim], False)

    def test_unknown_exit_remains_explicit_for_missing_duplicate_or_invalid_receipt(self):
        for records in ([], rows()[:8] + rows()[9:], rows()[:-1] + [rows()[8]] + rows()[-1:]):
            self.incomplete(self.analyze(records))

    def test_strict_parse_bounds_and_truncation(self):
        malformed = [b"", encoded(rows())[:-1], b'{"a":1,"a":2}\n', b'{"a":NaN}\n',
                     b'[]\n', b'\xff\n', b'{' + b' ' * m.MAX_LINE_BYTES + b'}\n',
                     b'{}\n' * (m.MAX_LINES + 1)]
        for raw in malformed:
            with self.subTest(size=len(raw)):
                self.incomplete(self.analyze(raw=raw))
        with patch.object(m, "MAX_BYTES", 10):
            self.incomplete(self.analyze())

    def test_current_process_binding_rejects_pid_reuse_and_legacy_capture(self):
        for changes in ({"expected_pid": True}, {"expected_pid": 2**32}, {"expected_pid": 4321},
                        {"observed_process_created_filetime": str(int(BIRTH) + 1)},
                        {"expected_process_created_filetime": float(BIRTH)},
                        {"expected_process_created_filetime": int(BIRTH)},
                        {"name": "native-eye-output-1234.jsonl"}, {"name": "native-paired-source-observe-4321.jsonl"},
                        {"timed_out": True}, {"timed_out": 0}):
            with self.subTest(changes=changes):
                self.incomplete(self.analyze(**changes))

    def test_wrong_old_or_contradictory_loader_is_rejected(self):
        for field, values in {"pid": (True, None, 4321), "dllSha256": ("0" * 64, None),
                              "moduleLoaded": (1, False), "recordingConfirmed": (0, True),
                              "moduleRetainedUntilProcessExit": (1, False)}.items():
            for value in values:
                loader = arguments()["loader_receipt"]
                loader[field] = value
                self.incomplete(self.analyze(loader_receipt=loader))

    def test_hook_manifest_and_exact_seven_hooks_are_required(self):
        self.incomplete(self.analyze(draw_manifest=MANIFEST + b" "))
        changed = bytearray(MANIFEST); changed[10] ^= 1
        self.incomplete(self.analyze(draw_manifest=bytes(changed)))
        for mutate in (lambda r: r.pop(0), lambda r: r.insert(0, r[0].copy()),
                       lambda r: r[0].update(hookRva=True), lambda r: r[0].update(prepared=1),
                       lambda r: r[0].update(hookRva=DRAW)):
            records = rows(); mutate(records)
            self.incomplete(self.analyze(records))

    def test_terminal_must_be_last_unique_typed_and_complete(self):
        for change in ({"installed": 1}, {"written": False}, {"attempted": False}, {"dropped": False},
                       {"attempted": 1}, {"written": 1}, {"dropped": 1}, {"status": "failed"},
                       {"originalBytesAndProtectionRestored": 1}):
            records = rows(); records[-1].update(change)
            self.incomplete(self.analyze(records))
        for records in (rows() + [{}], rows() + [rows()[-1]], rows()[:-1]):
            self.incomplete(self.analyze(records))

    def test_native_types_cannot_use_bool_equality_or_unhashable_ids(self):
        for change in ({"pairedEvent": True}, {"role": False}, {"sequence": True}, {"list": []},
                       {"generation": {}}, {"sourceCanonical": -1}, {"typedResource": 2**64},
                       {"count": False}, {"lists": [[1, True]]}, {"success": 1},
                       {"pairedEvent": 99}, {"coveredResetGeneration": 0}):
            records = rows(); records[9].update(change)
            self.incomplete(self.analyze(records))
        for change in ({"records": 2.0}, {"schema": True}, {"windowReason": True},
                       {"attempted": 4}, {"dropped": False}, {"failure": False}):
            records = rows(); records[8].update(change)
            self.incomplete(self.analyze(records))

    def test_page_policy_and_false_claims_are_preserved(self):
        records = rows()
        records[8].update(exactPageFlagsRestored=False, residualPrivateCowPages=1)
        result = self.analyze(records)
        self.assertTrue(result["monitorCaptureAccepted"], result["reasons"])
        self.assertEqual(result["diagnostic"]["pageProtectionOutcome"], "ACCEPTED_PRIVATE_COW_REQUIRES_PROCESS_EXIT")
        self.assertFalse(result["processExitProven"])
        for change in ({"pagePolicyAccepted": False}, {"residualPrivateCowPages": True},
                       {"normalProcessExitRequired": False}, {"pixelsCaptured": True}):
            bad = copy.deepcopy(records); bad[8].update(change)
            self.incomplete(self.analyze(bad))

    def test_changed_public_analyzer_fails_closed(self):
        with patch.object(m, "DIAGNOSTIC_SHA256", "0" * 64):
            self.incomplete(self.analyze())

    def test_reparse_or_symlink_analyzer_is_never_executed(self):
        for info in (types.SimpleNamespace(st_mode=stat.S_IFLNK, st_file_attributes=0),
                     types.SimpleNamespace(st_mode=stat.S_IFREG, st_file_attributes=0x400)):
            with patch.object(Path, "lstat", return_value=info):
                self.incomplete(self.analyze())

    def test_many_errors_have_bounded_output_without_hiding_failure(self):
        records = rows()[:-1] + [{"pairedEvent": True}] * 100 + rows()[-1:]
        result = self.analyze(records)
        self.incomplete(result)
        self.assertEqual(len(result["reasons"]), 128)
        self.assertGreater(result["reasonCount"], 128)

    def execution_rows(self):
        records = rows()
        begin = copy.deepcopy(records[9])
        begin.update(pairedEvent=10, sequence=3, serial=17, queueCanonical=81, typedObject=82,
                     caller=83, thread=84, count=1, lists=[[91, 2]], role=2, sourceCanonical=0,
                     typedResource=0, nativeDirectBatch=True, success=False)
        end = copy.deepcopy(begin); end.update(pairedEvent=11, sequence=4, success=True)
        records[11]["sequence"] = 5
        records[11:11] = [begin, end]
        records[8].update(records=5, attempted=5, executePairs=1)
        return records

    def test_execution_pair_must_match_and_close_before_completion(self):
        complete = self.execution_rows()
        self.assertTrue(self.analyze(complete)["monitorCaptureAccepted"])
        for field, value in {"queueCanonical": 90, "typedObject": 90, "caller": 90, "thread": 90,
                             "lists": [[91, 3]], "nativeDirectBatch": False, "success": False,
                             "serial": 18}.items():
            broken = copy.deepcopy(complete); broken[12][field] = value
            self.incomplete(self.analyze(broken))
        # Reviewer reproduction: a typed Begin, truthful row counts, invented
        # completed-pair total, but no End. Never accept this as complete.
        broken = copy.deepcopy(complete); broken.pop(12)
        broken[12]["sequence"] = 4
        broken[8].update(records=4, attempted=4)
        self.incomplete(self.analyze(broken))
        for changes in ({"serial": 0}, {"thread": 0}, {"queueCanonical": 0},
                        {"count": 2, "lists": [[91, 2], [91, 2]]}):
            broken = copy.deepcopy(complete)
            broken[11].update(changes); broken[12].update(changes)
            self.incomplete(self.analyze(broken))

    def test_window_and_native_summaries_cannot_be_invented(self):
        for change in ({"draws": [99, 99]}, {"transitions": [99, 99]}, {"resets": 99},
                       {"executePairs": 99}, {"cutCounter": 39}, {"startCounter": 47},
                       {"windowReason": 2}, {"draws": [False, 0]}, {"opaqueCallbacks": -1}):
            records = rows(); records[8].update(change)
            self.incomplete(self.analyze(records))
        records = rows(); records[8].update(windowReason=2, cutCounter=42); records[11]["counterCandidate"] = 42
        self.assertTrue(self.analyze(records)["monitorCaptureAccepted"])
        records = rows(); records.pop(11); records[8].update(records=2, attempted=2)
        self.incomplete(self.analyze(records))
        records = rows(); records[11]["counterCandidate"] = 45
        self.incomplete(self.analyze(records))
        records = rows(); records[10]["counterCandidate"] = 41
        self.incomplete(self.analyze(records))
        records = rows(); records[11]["pairedEvent"] = 12
        self.incomplete(self.analyze(records))

    def test_lifecycle_withdrawal_and_allocation_must_be_complete_and_bound(self):
        for change in ({"guardFailures": 99}, {"pendingAppendedPublications": 1},
                       {"withdrawalPublications": 0}, {"primaryOnlyActivationsAfterWithdrawal": 0},
                       {"appendCallbacks": 0}, {"appendCallbacks": 121}, {"extraViewActivations": 0},
                       {"nativeViewResult": True}, {"view": 72}, {"guardFailures": False}):
            records = rows(); records[-2].update(change)
            self.incomplete(self.analyze(records))
        for index in (-2, -3):
            records = rows(); records.pop(index)
            self.incomplete(self.analyze(records))
        for change in ({"view": True}, {"recordReady": False}, {"failures": True}, {"failures": 1}):
            records = rows(); records[-3].update(change)
            self.incomplete(self.analyze(records))


if __name__ == "__main__":
    unittest.main()
