"""Portable preparation/manifest tests. Never import or run a private loader."""
import ast
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("loader_preparation", Path(__file__).with_name("reconstruct_paired_loader.py"))
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
GAME = "7e9adb1414a8e1b325e5e1f097b9b17b78deb7eebeda37a333351a43a60f9d28"

SYNTHETIC_LOADER = '''"""Synthetic original loader; no native API."""
PROBES = {"native-eye-output": ("native-eye-output.dll", "43e6fd3b2a3e92abd11312e46d1f17ef427a220185fb4a3271b702b7efab8448")}
def main():
    parser.add_argument("--expected-process-created-filetime", type=int)
    parser.add_argument("--probe", choices=PROBES, default="native-eye-output")
    args = parser.parse_args()
    if True:
        if args.probe == 'native-eye-output':
            unchanged_manifest_name = 'native-eye-output-code.json'
            contents = Path(__file__).with_name("native-trace-manifest.json").read_text()
            raw = Path(__file__).with_name('native-eye-output-code.json').read_bytes()
        if manifest["exeSha256"] != GAME_HASH:
            raise ValueError("Manifest identity differs")
        allocate()
'''


def fixture():
    originals = {"load-native-eye-output.py": SYNTHETIC_LOADER.encode(),
                 "mapped_probe_identity.py": b"# synthetic dependency\n"}
    manifests = {
        name: {"exeSha256": GAME} for name in m.ORIGINALS if name.endswith(".json")
    }
    manifests["native-eye-manifest.json"]["hooks"] = {"draw": {"rva": 10, "bytes": "aa"}}
    manifests["native-allocation-manifest.json"]["codeProof"] = [
        {"rva": 20 + index, "size": 1, "bytes": "ab"} for index in range(14)
    ]
    for name, document in manifests.items():
        originals[name] = json.dumps(document).encode()
    return originals


def records(originals):
    return {name: (len(raw), hashlib.sha256(raw).hexdigest()) for name, raw in originals.items()}


class PreparationTests(unittest.TestCase):
    def test_production_acceptance_rejects_synthetic_or_changed_sources(self):
        with self.assertRaisesRegex(ValueError, "closure differs"):
            m.prepare(fixture(), b"fake")

    def test_missing_extra_and_non_bytes_closure_rejected(self):
        for change in (lambda value: value.pop("native-eye-manifest.json"),
                       lambda value: value.update({"extra.py": b"payload"}),
                       lambda value: value.update({"load-native-eye-output.py": "text"})):
            value = fixture()
            change(value)
            with self.assertRaises(ValueError):
                m.prepare(value, b"fake")

    def test_observer_must_match_both_size_and_hash(self):
        originals = fixture()
        with patch.object(m, "ORIGINALS", records(originals)):
            for observer in (b"fake", "text", b"x" * m.OBSERVER_BYTES):
                with self.assertRaisesRegex(ValueError, "Observer differs"):
                    m.prepare(originals, observer)

    def test_candidate_is_deterministic_preserves_inputs_and_grants_nothing(self):
        originals = fixture()
        before = copy.deepcopy(originals)
        observer = b"synthetic non-executable observer"
        with patch.object(m, "ORIGINALS", records(originals)), \
             patch.object(m, "OBSERVER_BYTES", len(observer)), \
             patch.object(m, "OBSERVER_SHA256", hashlib.sha256(observer).hexdigest()):
            first = m.prepare(originals, observer)
            self.assertEqual(first, m.prepare(originals, observer))
        members, packet = first
        self.assertEqual(before, originals)
        self.assertNotIn("load-native-eye-output.py", members)
        self.assertEqual(members[m.OBSERVER_NAME], observer)
        self.assertFalse(packet["liveExecutionAllowed"])
        self.assertFalse(packet["headsetReadinessProven"])
        self.assertIsNone(packet["privateOwnerReview"])
        self.assertIsNone(packet["freshSession"])
        self.assertNotIn("originalSessionConsumed", packet)
        self.assertTrue(packet["priorSessionMustRemainImmutable"])
        for name, raw in members.items():
            self.assertEqual(packet["members"][name], m.identity(raw))

    def test_exact_transform_has_one_probe_and_extra_checks_before_mutation(self):
        source = m._transform(SYNTHETIC_LOADER).decode()
        module = ast.parse(source)
        probes = next(n for n in module.body if isinstance(n, ast.Assign))
        self.assertEqual(ast.literal_eval(probes.value), {m.PROBE: (m.OBSERVER_NAME, m.OBSERVER_SHA256)})
        self.assertIn("type=int, required=True", source)
        self.assertIn("'native-eye-output-code.json'", source)
        self.assertLess(source.index("        verify_paired_owner_code("), source.index("        allocate()"))
        self.assertNotIn("'native-eye-output'", source)
        self.assertNotIn('"native-eye-output"', source)
        self.assertIn("paired_manifest_bytes['native-trace-manifest.json'].decode('utf-8')", source)
        self.assertIn("paired_manifest_bytes['native-eye-output-code.json']", source)

    def test_missing_or_duplicate_transform_anchors_refuse(self):
        for source in (SYNTHETIC_LOADER.replace("def main():", "def changed():"),
                       SYNTHETIC_LOADER + "\ndef main():\n    pass\n"):
            with self.assertRaisesRegex(ValueError, "Non-unique"):
                m._transform(source)

    def test_strict_manifest_shape_game_and_duplicate_keys(self):
        for raw in (b'[]', b'{"x":1,"x":2}', b'{"x":NaN}'):
            with self.assertRaises(ValueError):
                m.strict_document(raw)
        originals = fixture()
        originals["native-eye-manifest.json"] = b'{"exeSha256":"other"}'
        with self.assertRaisesRegex(ValueError, "game identity"):
            m.validate_manifest_inputs(originals)


class GeneratedCheckTests(unittest.TestCase):
    def run_check(self, change=None, read_changed=False, collision=False, disk_changed=False):
        originals = fixture()
        if change:
            document = json.loads(originals["native-allocation-manifest.json"])
            change(document)
            originals["native-allocation-manifest.json"] = json.dumps(document).encode()
        with patch.object(m, "ORIGINALS", records(originals)):
            source = m._additional_checks()
        # Only the PUBLIC generic checker is executed with synthetic files and
        # read callbacks. No generated private loader or Windows module runs.
        files = originals.copy()
        if disk_changed:
            files["native-eye-manifest.json"] += b" "
        calls = []
        class FakePath:
            def __init__(self, name): self.name = name
            def with_name(self, name): return FakePath(name)
            def open(self, _): return io.BytesIO(files[self.name])
        namespace = {"Path": FakePath, "hashlib": hashlib, "json": json,
                     "__file__": "synthetic.py", "GAME_HASH": GAME,
                     "image_identity": lambda *_: (0, 0, 4096),
                     "read": lambda *_: b"\x00" if read_changed else b"\xab",
                     "verify_rtv_binding": lambda *args: calls.append("rtv")}
        exec(compile(source, "public-generic-checker", "exec"), namespace)
        manifest = {"hooks": {"draw": {}} if collision else {"existing": {}}}
        snapshots = namespace["read_paired_manifest_bytes"]()
        # A post-validation disk change cannot alter the consumed manifests.
        files["native-eye-manifest.json"] = b"changed after snapshot"
        namespace["verify_paired_owner_code"]("synthetic-process", 0, manifest, snapshots)
        return manifest, calls

    def test_complete_live_code_requires_draw_allocation_and_rtv(self):
        manifest, calls = self.run_check()
        self.assertEqual(set(manifest["hooks"]), {"existing", "draw"})
        self.assertEqual(calls, ["rtv"])

    def test_changed_disk_live_code_and_hook_collision_refuse(self):
        for options in ({"disk_changed": True}, {"read_changed": True}, {"collision": True}):
            with self.assertRaises(ValueError):
                self.run_check(**options)

    def test_incomplete_and_unbounded_allocation_refuse(self):
        changes = [lambda d: d["codeProof"].pop(),
                   lambda d: d["codeProof"][0].update(rva=-1),
                   lambda d: d["codeProof"][0].update(rva=4096),
                   lambda d: d["codeProof"][0].update(rva=True),
                   lambda d: d["codeProof"][0].update(size=True),
                   lambda d: d["codeProof"][0].update(size=2)]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.run_check(change=change)


if __name__ == "__main__":
    unittest.main()
