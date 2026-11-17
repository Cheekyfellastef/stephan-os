"""Synthetic receipt-analysis tests only; no Windows API, loader or game execution."""

import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest

import analyze_native_eye_output_session as analyzer


PID = 70000
FILETIME = "134384678410182997"
PRIMARY = 0x01000001
EXTRA = 0x01000002
PRIMARY_KEY = [25, 0, 1138340658]
EYE_KEY = [25, 0, 3111819282]
PRIMARY_RESOURCE = 0x10000000001
EXTRA_RESOURCE = 0x10000000101


def fixture():
    rows = [{"hookRva": rva, "prepared": True} for rva in analyzer.EXPECTED_HOOK_RVAS]
    rows += [
        {"status": "waiting-for-verified-camera-context", "maximumWaitMs": 60000,
         "cameraMutationArmed": False, "gpuCaptureArmed": False},
        {"status": "recording", "exeSha256": analyzer.GAME_SHA256,
         "sameSimulationUpdateProven": False},
        {"captureStaging": True, "outcome": "capture-armed", "captureArmed": True,
         "firstEligibleSampleValid": True},
    ]
    for index in range(12):
        rows.append({"resourceAuditSample": index, "eye": index // 6,
                     "view": PRIMARY if index < 6 else EXTRA,
                     "valid": True, "workerStable": True, "viewStable": True,
                     "counterBefore": 10 + index % 6, "counterAfter": 10 + index % 6})
    rows.append({"resourceAuditFinished": True, "samplesWritten": 12, "stableSamples": 12, "sampleLimit": 12,
                 "samplesPerEye": [6, 6], "stableSamplesPerEye": [6, 6],
                 "sameSimulationUpdateProven": False, "independentAllocationsProven": False})
    binding = struct.pack("<IIIIIII4B", *EYE_KEY, 0x09581900, 0x20, 0x20, 2, 0, 0, 0, 0).hex()
    rows += [
        {"bindingAuditSample": 4, "eye": 1, "valid": True, "viewStable": True},
        {"bindingPhase": 1, "sample": 4, "view": EXTRA, "valid": True},
        {"bindingItem": 0, "sample": 4, "phase": 1, "table": 1, "bytes": binding},
        {"bindingItem": 0, "sample": 4, "phase": 1, "table": 2, "bytes": binding},
        {"bindingAuditFinished": True, "samples": 1, "validSamples": 1, "sampleLimit": 8},
    ]
    allocation = {"eyeOutputAllocation": True, "attempts": 1, "extraCompiles": 1,
                  "failures": 0, "planState": 9, "childCopied": True, "viewStable": True,
                  "view": EXTRA, "primaryKey": PRIMARY_KEY.copy(), "eyeKey": EYE_KEY.copy(),
                  "primaryResourceCandidate": PRIMARY_RESOURCE, "pixelsCaptured": False,
                  "sameSimulationUpdateProven": False}
    allocation.update({name: True for name in analyzer.ALLOCATION_FLAGS})
    rows.append(allocation)
    for view, resource, key in ((PRIMARY, PRIMARY_RESOURCE, PRIMARY_KEY), (EXTRA, EXTRA_RESOURCE, EYE_KEY)):
        for ordinal in range(6):
            # Repeated counters are deliberately legal: attempts are not unique updates.
            counter = 100 + ordinal // 2
            rows += [
                {"nativeEyeOutputDescription": True, "view": view, "counterCandidate": counter,
                 "expectedBindingAndDimensions": True, "independentPhysicalAllocationProven": False},
                {"outputMapState": 5, "view": view, "counterCandidate": counter,
                 "resourceCandidate": resource, "key": key.copy(), "matchingRows": 1,
                 "row": resource + 256, "wrapper": resource + 512,
                 "gpuCommandsIssued": False, "pixelsCaptured": False},
                {"textureDescription": True, "view": view, "counterCandidate": counter,
                 "resource": resource, "valid": True, "dimension": 3, "width": 3359,
                 "height": 2102, "arraySize": 1, "mipLevels": 1, "format": 28,
                 "sampleCount": 1, "flags": 1, "pixelsCaptured": False},
            ]
    rows += [
        {"outputMapCallbacks": 12, "outputCallbacksStillActive": 0, "maximumOutputRecords": 32},
        {"nativeViewResult": 7, "view": EXTRA, "appendCallbacks": 12, "extraViewActivations": 12,
         "withdrawalPublications": 3, "primaryOnlyActivationsAfterWithdrawal": 3,
         "pendingAppendedPublications": 0, "guardFailures": 0,
         "eyeTexturesCaptured": False, "gpuRetirementProven": False},
        {"status": "finished", "installed": True, "originalBytesAndProtectionRestored": True,
         "written": 0, "attempted": 0, "dropped": 0},
    ]
    return rows


def identity():
    return {"loader_receipt": {"pid": PID, "dllSha256": analyzer.REVIEWED_DLL_SHA256,
                               "moduleLoaded": True, "recordingConfirmed": False,
                               "moduleRetainedUntilProcessExit": True},
            "expected_pid": PID, "expected_process_created_filetime": FILETIME,
            "observed_process_created_filetime": FILETIME, "capture_pid": PID}


def single(rows, key):
    return next(r for r in rows if key in r)


class ReceiptAnalysisTests(unittest.TestCase):
    def test_complete_exact_capture_accepts_without_eight_binding_samples(self):
        result = analyzer.analyze_records(fixture(), **identity())
        self.assertTrue(result["monitorCaptureAccepted"], result["reasons"])
        self.assertEqual(result["stages"]["bindingAudit"]["actualSamples"], 1)
        self.assertEqual(result["stages"]["materialization"]["totalAttempts"], 12)
        self.assertEqual(result["stages"]["materialization"]["matchedCounterCandidates"], [100, 101, 102])
        self.assertFalse(any(result["claims"].values()))

    def test_generic_finished_and_module_loaded_do_not_prove_capture(self):
        result = analyzer.analyze_records([fixture()[-1]], **identity())
        self.assertFalse(result["captureEvidencePassed"])
        self.assertFalse(result["monitorCaptureAccepted"])

    def test_one_failed_attempt_preserves_eleven_positive_typed_observations(self):
        rows = fixture()
        single(rows, "textureDescription")["valid"] = False
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["monitorCaptureAccepted"])
        self.assertTrue(result["observedFacts"]["nativeDescriptorCompilationPassed"])
        self.assertTrue(result["observedFacts"]["typedResourcesObservedInBothViews"])
        self.assertEqual(result["observedFacts"]["successfulTypedObservationCount"], 11)

    def test_partial_three_attempts_each_are_observations_not_full_completion(self):
        rows = fixture()
        starts = [i for i, r in enumerate(rows) if r.get("nativeEyeOutputDescription") is True]
        remove = {i + j for ordinal, i in enumerate(starts) if ordinal % 6 >= 3 for j in range(3)}
        rows = [r for i, r in enumerate(rows) if i not in remove]
        single(rows, "outputMapCallbacks")["outputMapCallbacks"] = 6
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["monitorCaptureAccepted"])
        self.assertTrue(result["observedFacts"]["typedResourcesObservedInBothViews"])
        self.assertEqual(result["observedFacts"]["successfulTypedObservationCount"], 6)

    def test_second_compile_is_rejected_even_if_first_allocation_was_valid(self):
        rows = fixture()
        single(rows, "eyeOutputAllocation")["extraCompiles"] = 2
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["stages"]["allocation"]["passed"])
        self.assertFalse(result["monitorCaptureAccepted"])

    def test_attempts_are_not_converted_from_booleans(self):
        rows = fixture()
        single(rows, "eyeOutputAllocation")["attempts"] = True
        self.assertFalse(analyzer.analyze_records(rows, **identity())["monitorCaptureAccepted"])

    def test_child_binding_flag_requires_exact_child_bytes(self):
        rows = fixture()
        child = next(r for r in rows if r.get("bindingItem") == 0 and r.get("table") == 2)
        child["bytes"] = "00" * 32
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["stages"]["childBinding"]["passed"])
        self.assertFalse(result["monitorCaptureAccepted"])

    def test_matching_counter_does_not_mask_texture_resource_mismatch(self):
        rows = fixture()
        single(rows, "textureDescription")["resource"] = EXTRA_RESOURCE
        self.assertFalse(analyzer.analyze_records(rows, **identity())["monitorCaptureAccepted"])

    def test_physical_allocation_claim_is_always_false_and_contradiction_rejected(self):
        rows = fixture()
        single(rows, "nativeEyeOutputDescription")["independentPhysicalAllocationProven"] = True
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["monitorCaptureAccepted"])
        self.assertFalse(result["claims"]["independentPhysicalAllocationProven"])

    def test_extra_resource_aliasing_primary_is_not_materialization_success(self):
        rows = fixture()
        for r in rows:
            if r.get("view") == EXTRA and "resourceCandidate" in r:
                r["resourceCandidate"] = PRIMARY_RESOURCE
            if r.get("view") == EXTRA and "textureDescription" in r:
                r["resource"] = PRIMARY_RESOURCE
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["stages"]["materialization"]["passed"])
        self.assertFalse(result["observedFacts"]["distinctResourceObjectCandidatesObserved"])

    def test_actual_format_mismatch_is_reported_not_hidden_by_native_flag(self):
        rows = fixture()
        for r in rows:
            if r.get("textureDescription") is True and r.get("view") == EXTRA:
                r["format"] = 10
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["monitorCaptureAccepted"])
        self.assertEqual(len(result["stages"]["materialization"]["actualTextureSignatures"]), 2)

    def test_matching_but_unsupported_descriptors_cannot_override_the_admitted_shape(self):
        for replacement in ({"arraySize": 2}, {"mipLevels": 2}, {"sampleCount": 2},
                            {"width": 8192, "height": 8192}):
            with self.subTest(replacement=replacement):
                rows = fixture()
                for record in rows:
                    if record.get("textureDescription") is True:
                        record.update(replacement)
                result = analyzer.analyze_records(rows, **identity())
                self.assertFalse(result["monitorCaptureAccepted"])
                self.assertTrue(result["observedFacts"]["nativeDescriptorCompilationPassed"])
                self.assertEqual(result["stages"]["materialization"]["totalAttempts"], 12)
                self.assertEqual(result["stages"]["materialization"]["successfulAttempts"], 0)

    def test_exact_reviewed_area_bound_is_allowed(self):
        rows = fixture()
        for record in rows:
            if record.get("textureDescription") is True:
                record.update(width=8192, height=2048)
        result = analyzer.analyze_records(rows, **identity())
        self.assertTrue(result["monitorCaptureAccepted"], result["reasons"])

    def test_resource_audit_indices_bind_to_the_correct_eye_and_view(self):
        for mutation in ("duplicate", "swap_indices", "wrong_view", "boolean_eye", "float_count"):
            with self.subTest(mutation=mutation):
                rows = fixture()
                samples = [r for r in rows if "resourceAuditSample" in r]
                if mutation == "duplicate":
                    samples[7]["resourceAuditSample"] = 6
                elif mutation == "swap_indices":
                    samples[0]["resourceAuditSample"], samples[6]["resourceAuditSample"] = 6, 0
                elif mutation == "wrong_view":
                    samples[0]["view"] = EXTRA
                elif mutation == "boolean_eye":
                    samples[6]["eye"] = True
                elif mutation == "float_count":
                    single(rows, "resourceAuditFinished")["samplesWritten"] = 12.0
                result = analyzer.analyze_records(rows, **identity())
                self.assertFalse(result["monitorCaptureAccepted"])
                self.assertFalse(result["stages"]["resourceAudit"]["passed"])
                self.assertTrue(result["stages"]["materialization"]["passed"])

    def test_missing_withdrawal_cannot_pass_with_finished(self):
        rows = fixture()
        single(rows, "nativeViewResult")["primaryOnlyActivationsAfterWithdrawal"] = 2
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["stages"]["withdrawal"]["passed"])
        self.assertTrue(result["stages"]["restoration"]["passed"])
        self.assertFalse(result["monitorCaptureAccepted"])

    def test_restoration_and_drain_failure_preserves_materialization_facts(self):
        rows = fixture()
        rows[-1]["status"] = "restore-failed-game-exit-required"
        rows[-1]["originalBytesAndProtectionRestored"] = False
        result = analyzer.analyze_records(rows, **identity())
        self.assertFalse(result["monitorCaptureAccepted"])
        self.assertTrue(result["stages"]["materialization"]["passed"])
        self.assertTrue(result["normalGameExitRequiredBeforeProxyRestore"])

    def test_native_rejection_and_no_terminal_are_explicit(self):
        result = analyzer.analyze_records([{"status": "rejected-eye-output-code-identity"}], **identity())
        self.assertEqual(result["outcome"], "NATIVE_ADMISSION_REJECTED")
        self.assertFalse(result["monitorCaptureAccepted"])

    def test_watchdog_expiry_is_not_late_success(self):
        result = analyzer.analyze_records(fixture(), timed_out=True, **identity())
        self.assertTrue(result["captureEvidencePassed"])
        self.assertEqual(result["outcome"], "MONITOR_TIMEOUT_INCOMPLETE")
        self.assertFalse(result["monitorCaptureAccepted"])

    def test_pid_filetime_hash_mismatch_and_float_fail_binding(self):
        for field, value in (("expected_pid", PID + 1), ("observed_process_created_filetime", str(int(FILETIME) + 1)),
                             ("observed_process_created_filetime", float(FILETIME)), ("capture_pid", PID + 1)):
            with self.subTest(field=field):
                supplied = identity()
                supplied[field] = value
                result = analyzer.analyze_records(fixture(), **supplied)
                self.assertTrue(result["captureEvidencePassed"])
                self.assertFalse(result["sessionIdentityPassed"])
                self.assertFalse(result["monitorCaptureAccepted"])
        supplied = identity()
        supplied["loader_receipt"]["dllSha256"] = "0" * 64
        self.assertFalse(analyzer.analyze_records(fixture(), **supplied)["monitorCaptureAccepted"])

    def test_no_identity_is_honestly_unbound(self):
        result = analyzer.analyze_records(fixture())
        self.assertTrue(result["captureEvidencePassed"])
        self.assertEqual(result["outcome"], "CAPTURE_EVIDENCE_UNBOUND_TO_FRESH_PROCESS")

    def test_duplicate_terminal_and_post_terminal_data_fail_integrity(self):
        for rows in (fixture() + [copy.deepcopy(fixture()[-1])], fixture() + [{"unexpected": True}]):
            self.assertFalse(analyzer.analyze_records(rows, **identity())["monitorCaptureAccepted"])

    def test_duplicate_json_keys_nonfinite_and_partial_line_fail_closed(self):
        for text in ('{"status":"recording","status":"finished"}\n', '{"a":NaN}\n', '{"status":'):
            records, errors = analyzer.parse_jsonl(text)
            self.assertTrue(errors)
            result = analyzer.analyze_records(records, parse_errors=errors, **identity())
            self.assertFalse(result["monitorCaptureAccepted"])

    def test_wrong_record_field_types_fail_closed_without_hiding_partial_evidence(self):
        for key, field in (("hookRva", "hookRva"), ("eyeOutputAllocation", "view")):
            with self.subTest(field=field):
                rows = fixture()
                single(rows, key)[field] = []
                result = analyzer.analyze_records(rows, **identity())
                self.assertFalse(result["monitorCaptureAccepted"])

    def test_file_reader_binds_filename_and_preserves_capture_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / f"native-eye-output-{PID}.jsonl"
            path.write_text("".join(json.dumps(row) + "\n" for row in fixture()), encoding="utf-8")
            supplied = identity()
            supplied.pop("capture_pid")
            result = analyzer.analyze_file(path, **supplied)
            self.assertTrue(result["monitorCaptureAccepted"], result["reasons"])
            self.assertEqual(len(result["captureFile"]["sha256"]), 64)
            supplied["expected_pid"] = PID + 1
            self.assertFalse(analyzer.analyze_file(path, **supplied)["monitorCaptureAccepted"])


if __name__ == "__main__":
    unittest.main()
