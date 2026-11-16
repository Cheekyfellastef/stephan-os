import importlib.util
from pathlib import Path
import re
import tempfile
import hashlib
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("analyzer", ROOT / "analyze-paired-source-observation.py")
analyzer = importlib.util.module_from_spec(spec);spec.loader.exec_module(analyzer)

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
        receipt = {"pairedSourceObservation": True, "records": 2, "attempted": 2, "observationIsDiagnosticOnly": True, "windowReason": 1}
        receipt.update({field: False for field in analyzer.FALSE_PROOFS})
        receipt.update({field: True for field in ("bound", "nativeDrained", "comRestored", "coverageOwnedBeforeDisarm", "slotsRestored", "calleeBytesUnchanged", "exactPageFlagsRestored")})
        receipt.update({field: 0 for field in ("failure", "modelFailure", "dropped", "openApi")})
        receipt.update({field: False for field in ("invalid", "sinkFaulted", "fiberPoisoned")})
        events = [{"pairedEvent": 1, "sequence": eye + 1, "role": eye, "sourceCanonical": 10 + eye, "typedResource": 20 + eye} for eye in range(2)]
        terminal = {"status": "finished", "originalBytesAndProtectionRestored": True, "dropped": 0}
        result = analyzer.analyze([receipt, terminal] + events);self.assertFalse(result["errors"]);self.assertFalse(result["submissionAuthority"])
        events[1]["sourceCanonical"] = 10
        self.assertIn("Distinct paired registrations absent", analyzer.analyze([receipt] + events)["errors"])
        receipt["records"] = 3
        self.assertIn("Journal count mismatch", analyzer.analyze([receipt] + events)["errors"])

    def test_two_resource_state_isolation(self):
        receipt = {"pairedSourceObservation": True, "observationIsDiagnosticOnly": True, "windowReason": 1}
        receipt.update({field: False for field in analyzer.FALSE_PROOFS})
        receipt.update({field: True for field in ("bound", "nativeDrained", "comRestored", "coverageOwnedBeforeDisarm", "slotsRestored", "calleeBytesUnchanged", "exactPageFlagsRestored")})
        receipt.update({field: 0 for field in ("failure", "modelFailure", "dropped", "openApi")})
        receipt.update({field: False for field in ("invalid", "sinkFaulted", "fiberPoisoned")})
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

    def test_build_overlay_member_contract(self):
        spec = importlib.util.spec_from_file_location("builder", ROOT / "reconstruct_paired_observer.py")
        builder = importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        self.assertEqual(len(builder.ORIGINAL_FILES), 95)
        self.assertEqual(len(builder.ARTIFACTS), 5)
        self.assertEqual(hashlib.sha256((ROOT / "scoped-eye-ledger.h").read_bytes()).hexdigest(), builder.PAIRED_LEDGER)
        self.assertEqual(set(builder.MEMBERS), {p.name for p in ROOT.iterdir() if p.name in builder.MEMBERS})

if __name__ == "__main__":unittest.main()
