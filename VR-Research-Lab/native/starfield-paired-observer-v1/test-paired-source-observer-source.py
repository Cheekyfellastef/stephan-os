import importlib.util
from pathlib import Path, PureWindowsPath
import re
import tempfile
import hashlib
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("analyzer", ROOT / "analyze-paired-source-observation.py")
analyzer = importlib.util.module_from_spec(spec);spec.loader.exec_module(analyzer)

def load_builder():
    spec = importlib.util.spec_from_file_location("builder", ROOT / "reconstruct_paired_observer.py")
    builder = importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    return builder

def complete_receipt():
    receipt = {"pairedSourceObservation": True, "records": 2, "attempted": 2,
               "observationIsDiagnosticOnly": True, "windowReason": 1,
               "pagePolicyAccepted": True, "residualPrivateCowPages": 0,
               "normalProcessExitRequired": True}
    receipt.update({field: False for field in analyzer.FALSE_PROOFS})
    receipt.update({field: True for field in ("bound", "nativeDrained", "comRestored", "coverageOwnedBeforeDisarm", "slotsRestored", "calleeBytesUnchanged", "exactPageFlagsRestored")})
    receipt.update({field: 0 for field in ("failure", "modelFailure", "dropped", "openApi")})
    receipt.update({field: False for field in ("invalid", "sinkFaulted", "fiberPoisoned")})
    return receipt

def diagnostic_rows(receipt):
    events = [{"pairedEvent": 1, "sequence": eye + 1, "role": eye,
               "sourceCanonical": 10 + eye, "typedResource": 20 + eye} for eye in range(2)]
    terminal = {"status": "finished", "originalBytesAndProtectionRestored": True, "dropped": 0}
    return [receipt, terminal] + events

class SourceTests(unittest.TestCase):
    def test_no_native_copy_authority(self):
        text = (ROOT / "native-paired-source-observer.h").read_text()
        self.assertNotRegex(text, r"(?:->|\.)\s*(?:Record|Recorded|BeginDraw|CanCopy|BeginSubmission|Submitted|Signal|ExecuteCommandLists|CopyResource|CopyTextureRegion)\s*\(")
        self.assertNotIn('eye-image-pair.h', text)

    def test_no_portable_copy_authority(self):
        text = (ROOT / "paired-source-observation.h").read_text()
        self.assertNotRegex(text, r"ledger_\.(?:Recorded|BeginDraw|CanCopy|BeginSubmission|Submitted|ReadyForFence)\s*\(")

    def test_only_symbolic_owner_access(self):
        text = (ROOT / "native-paired-source-observer.h").read_text()
        self.assertNotRegex(text, r"0x[0-9a-fA-F]{6,}")
        self.assertNotRegex(text, r"g_base\s*\+\s*\d")

    def test_build_terminal_marker(self):
        text = (ROOT / "build-paired-source-observe.cmd").read_text()
        self.assertEqual(text.count("echo STEPHANOS_PAIRED_OBSERVER_BUILD_PASSED"), 1)
        self.assertIn('if /I not "%VCToolsInstallDir%bin\\Hostx64\\x64\\cl.exe"=="%STEPH_OBSERVER_EXPECTED_CL%"', text)
        self.assertNotRegex(text, r"(?im)^cl\s")
        self.assertGreater(text.index("echo STEPHANOS_PAIRED_OBSERVER_BUILD_PASSED"), text.index("/Fenative-paired-source-observe.dll"))

    def test_missing_receipt(self):
        self.assertFalse(analyzer.analyze([])["pixelAuthority"])
        self.assertTrue(analyzer.analyze([])["errors"])

    def test_false_proofs_mandatory(self):
        result = analyzer.analyze([{"pairedSourceObservation": True, "pixelsCaptured": True}])
        self.assertIn("Unproven or missing field: pixelsCaptured", result["errors"])
        self.assertFalse(result["pixelAuthority"])

    def test_journal_count_and_source_alias(self):
        receipt = complete_receipt()
        events = [{"pairedEvent": 1, "sequence": eye + 1, "role": eye, "sourceCanonical": 10 + eye, "typedResource": 20 + eye} for eye in range(2)]
        terminal = {"status": "finished", "originalBytesAndProtectionRestored": True, "dropped": 0}
        result = analyzer.analyze([receipt, terminal] + events);self.assertFalse(result["errors"]);self.assertFalse(result["submissionAuthority"])
        events[1]["sourceCanonical"] = 10
        self.assertIn("Distinct paired registrations absent", analyzer.analyze([receipt] + events)["errors"])
        receipt["records"] = 3
        self.assertIn("Journal count mismatch", analyzer.analyze([receipt] + events)["errors"])

    def test_two_resource_state_isolation(self):
        receipt = complete_receipt()
        events = [{"pairedEvent": 1, "role": eye, "sourceCanonical": 10 + eye, "typedResource": 20 + eye} for eye in range(2)]
        events += [{"pairedEvent": 2, "list": 30, "generation": 1, "success": True, "coveredResetGeneration": True},
                   {"pairedEvent": 6, "list": 30, "generation": 1, "role": 1, "sourceCanonical": 11, "typedResource": 21, "wholeUnsplit": True, "before": 1024, "afterState": 4},
                   {"pairedEvent": 4, "list": 30, "generation": 1, "role": 0, "sourceCanonical": 10, "typedResource": 20},
                   {"pairedEvent": 9, "list": 30, "generation": 1, "role": 0, "sourceCanonical": 10, "typedResource": 20, "success": True, "coveredResetGeneration": True}]
        for index, event in enumerate(events, 1):event["sequence"] = index
        receipt["records"] = receipt["attempted"] = len(events)
        terminal = {"status": "finished", "originalBytesAndProtectionRestored": True, "dropped": 0}
        result = analyzer.analyze([receipt, terminal] + events)
        self.assertFalse(result["errors"]);self.assertEqual(result["diagnosticLocalWitnessCounts"], [0, 0]);self.assertFalse(result["pixelAuthority"])

    def test_native_receipt_discloses_the_original_page_policy_and_residual_count(self):
        text = (ROOT / "native-paired-source-observer.h").read_text()
        self.assertIn(r'\"pagePolicyAccepted\":%s', text)
        self.assertIn(r'\"residualPrivateCowPages\":%u', text)
        self.assertIn(r'\"normalProcessExitRequired\":true', text)
        self.assertIn('receipt.pagePolicyAccepted?"true":"false",receipt.residualPrivateCowPages', text)

    def test_exact_and_accepted_cow_are_distinct_and_neither_proves_process_exit(self):
        for residual in (0, 1, 64):
            receipt = complete_receipt()
            receipt.update(exactPageFlagsRestored=(residual == 0), residualPrivateCowPages=residual,
                           processExitProven=True)  # Journal input cannot prove process exit.
            result = analyzer.analyze(diagnostic_rows(receipt))
            self.assertEqual(result["errors"], [])
            self.assertEqual(result["outcome"], "OBSERVATION_COMPLETE_NO_PIXEL_AUTHORITY")
            self.assertEqual(result["pageProtectionOutcome"], "EXACT_FLAGS_RESTORED" if residual == 0
                             else "ACCEPTED_PRIVATE_COW_REQUIRES_PROCESS_EXIT")
            self.assertEqual(result["residualPrivateCowPages"], residual)
            self.assertTrue(result["normalProcessExitRequired"])
            for field in ("processExitProven", "pixelAuthority", "submissionAuthority", "gpuCompletionProven",
                          "openxrSubmitted", "sameSimulationUpdateProven"):
                self.assertIs(result[field], False)

    def test_missing_rejected_and_contradictory_page_policies_fail_closed(self):
        changes = [{"pagePolicyAccepted": value} for value in (False, None, 1)]
        changes += [{"exactPageFlagsRestored": value} for value in (False, None, 1)]
        changes += [{"residualPrivateCowPages": value} for value in (True, -1, 65, 1.0, "0", None, 1)]
        changes += [{"normalProcessExitRequired": value} for value in (False, None, 1)]
        changes += [{"exactPageFlagsRestored": False, "residualPrivateCowPages": 1,
                     "slotsRestored": False},
                    {"exactPageFlagsRestored": False, "residualPrivateCowPages": 1,
                     "calleeBytesUnchanged": False}]
        for change in changes:
            receipt = complete_receipt(); receipt.update(change)
            with self.subTest(change=change):
                result = analyzer.analyze(diagnostic_rows(receipt))
                self.assertTrue(result["errors"])
                self.assertEqual(result["outcome"], "INCOMPLETE_OBSERVATION_NO_PIXEL_AUTHORITY")
                self.assertFalse(result["processExitProven"])
        for missing in ("pagePolicyAccepted", "exactPageFlagsRestored", "residualPrivateCowPages",
                        "normalProcessExitRequired"):
            receipt = complete_receipt(); receipt.pop(missing)
            self.assertTrue(analyzer.analyze(diagnostic_rows(receipt))["errors"])

    def test_build_overlay_member_contract(self):
        builder = load_builder()
        self.assertEqual(len(builder.ORIGINAL_FILES), 95)
        self.assertEqual(len(builder.ARTIFACTS), 5)
        self.assertEqual(hashlib.sha256((ROOT / "scoped-eye-ledger.h").read_bytes()).hexdigest(), builder.PAIRED_LEDGER)
        self.assertEqual(set(builder.MEMBERS), {p.name for p in ROOT.iterdir() if p.name in builder.MEMBERS})

    def test_windows_nested_member_keys_use_manifest_identity(self):
        builder = load_builder()
        root = PureWindowsPath(r"C:\owned-fixture\original")
        name = "vendor/minhook/src/hde/fixture.c"
        path = root / name
        contents = {name: b"synthetic nested source; no private payload\n"}
        # PureWindowsPath reproduces the original failure even on Linux:
        # str(relative_to(...)) has backslashes and is not the manifest key.
        self.assertNotIn(str(path.relative_to(root)), contents)
        self.assertEqual(contents[builder.relative_member(path, root)], contents[name])
        self.assertEqual(builder.relative_member(path, root), name)

    def test_synthetic_nested_reconstruction_preserves_bytes_and_posix_receipt(self):
        # Run the real filesystem copying/receipt code on every host, including
        # Windows CI. Only the proprietary source transformations are replaced.
        # This is a reconstruction fixture, not native compilation proof.
        builder = load_builder()
        originals = {
            "test-scoped-eye-ledger.cpp": (ROOT / "test-scoped-eye-ledger.cpp").read_bytes(),
            "vendor/minhook/include/fixture.h": b"// public synthetic fixture header\n",
            "vendor/minhook/src/hde/fixture.c": b"// public synthetic nested fixture source\n",
        }
        records = {name: {"sha256": builder.sha(raw), "bytes": len(raw)} for name, raw in originals.items()}
        overlay = {name: (ROOT / name).read_bytes() for name in builder.MEMBERS}
        generated = {"native-boundary-trace.cpp": b"// synthetic transform result; no engine data\n"}
        with tempfile.TemporaryDirectory(prefix="paired-observer-nested-fixture-") as temporary:
            original = Path(temporary) / "original";original.mkdir()
            for name, raw in originals.items():
                path = original / name;path.parent.mkdir(parents=True, exist_ok=True);path.write_bytes(raw)
            destination = Path(temporary) / "staged"
            with patch.object(builder, "ORIGINAL_FILES", records), patch.object(builder, "transformed", return_value=generated):
                result = builder.reconstruct(original, destination, overlay)
            self.assertEqual(set(result["files"]), set(originals) | set(overlay) | set(generated))
            self.assertTrue(all("\\" not in name for name in result["files"]))
            for name, raw in originals.items():
                self.assertEqual((original / name).read_bytes(), raw)
                self.assertEqual((destination / name).read_bytes(), raw)
                self.assertEqual(result["files"][name], records[name])
            self.assertEqual(result["originalCompileClosureMembers"], len(originals))
            self.assertTrue(result["originalUnchanged"])
            self.assertFalse(result["nativeBuildPerformed"])

if __name__ == "__main__":unittest.main()
