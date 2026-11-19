"""Prepare private paired-observer loader bytes for independent review.

This pure transformation performs no file I/O, imports of private code, process
access, compilation, DLL loading or session mutation. Its output is a candidate,
not an executable qualification or permission to reuse a consumed capture.
"""
from __future__ import annotations

import ast
import hashlib
import json
import re

BUILD_HEAD = "db730e7f9a83e2f5a053b63e89163189acec9719"
BUILD_RECEIPT = "https://github.com/Cheekyfellastef/stephan-os/issues/3258#issuecomment-6995753681"
OBSERVER_NAME = "native-paired-source-observe.dll"
OBSERVER_SHA256 = "36dd35a2dd31b6f116e8b8a055e2608915445edebdc25f3c1f1fbca99e9c2ef0"
OBSERVER_BYTES = 255488
LOADER_NAME = "load-native-paired-source-observe.py"
PROBE = "native-paired-source-observe"
ORIGINALS = {
    "load-native-eye-output.py": (23459, "44d00cd273e767077add83f95b149dfb83edbf2cd3f01988928f153ee5de009c"),
    "mapped_probe_identity.py": (2715, "1673d03577c8a1381983b2fbe130db212fcac577293334d747d4f71fb83efffa"),
    "native-trace-manifest.json": (410, "5305a403daabab242da6aaec257522bcc02c6e3c8cfd67f78494bd43f79f0ed4"),
    "native-view-manifest.json": (1695, "8406e9afc8196abd35ab05b1bfec5751638f5005b23eb13d4afb579b643815dc"),
    "native-parallel-manifest.json": (214, "432e15d26fe2bd2f185bd5bd9706694b18106206f877ccf6b0da35fa5e1c6662"),
    "native-view-binding-manifest.json": (466, "819b30fb155447f473bebb689f5a2fc441c1d77b15de9f803f3e8da8860f29e2"),
    "native-eye-output-code.json": (27002, "5b024d701c1a4dd426f7c06a4dbc6bdcfb97729ba7347bc85b0e3a2263e6111b"),
    "native-eye-manifest.json": (207, "690a7708a11f2b7e6a83e3bd56c93b5bdf5f88003847ff2c8338dabe436167d0"),
    "native-allocation-manifest.json": (25320, "cbdef0514d80653b7b62d3de4d5a3807cfea24fffd686355c823f13d33178500"),
    "native-rtv-manifest.json": (2207, "cac005437537e02b27cc3f37525f416c925fe5e0b1b976349c4f88e5a4f62124"),
}


def identity(raw: bytes) -> dict:
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def unique_replace(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise ValueError("Non-unique original loader anchor")
    return source.replace(old, new, 1)


def strict_document(raw: bytes) -> dict:
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("Duplicate manifest member")
            value[key] = item
        return value

    def constant(_):
        raise ValueError("Non-finite manifest number")

    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    if not isinstance(value, dict):
        raise ValueError("Manifest must be an object")
    return value


def validate_manifest_inputs(originals: dict[str, bytes]) -> None:
    game = "7e9adb1414a8e1b325e5e1f097b9b17b78deb7eebeda37a333351a43a60f9d28"
    for name, raw in originals.items():
        if name.endswith(".json") and strict_document(raw).get("exeSha256") != game:
            raise ValueError("Manifest game identity differs: " + name)


def _additional_checks() -> str:
    """Public generic checks; private addresses remain in local manifests."""
    hashes = {name: (size, digest) for name, (size, digest) in ORIGINALS.items()
              if name.endswith(".json")}
    return '''
def read_paired_manifest_bytes():
    expected_manifests = HASHES
    snapshots = {}
    for name, (size, digest) in expected_manifests.items():
        with Path(__file__).with_name(name).open("rb") as stream:
            raw = stream.read(size + 1)
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("Paired owner manifest changed: " + name)
        snapshots[name] = raw
    return snapshots


def verify_paired_owner_code(process, base, manifest, manifest_bytes):
    documents = {}
    for name, raw in manifest_bytes.items():
        documents[name] = json.loads(raw)
        if documents[name].get("exeSha256") != GAME_HASH:
            raise ValueError("Paired owner game identity differs")
    eye = documents["native-eye-manifest.json"]
    allocation = documents["native-allocation-manifest.json"]
    if len(eye["hooks"]) != 1 or len(allocation["codeProof"]) != 14:
        raise ValueError("Incomplete paired draw/allocation proof")
    image_size = image_identity(process, base)[2]
    for span in allocation["codeProof"]:
        expected = bytes.fromhex(span["bytes"])
        if (type(span["rva"]) is not int or type(span["size"]) is not int
                or len(expected) != span["size"] or not 0 < len(expected) <= 2048
                or not 0 <= span["rva"] <= image_size - len(expected)):
            raise ValueError("Unbounded paired allocation span")
        if read(process, base + span["rva"], len(expected)) != expected:
            raise ValueError("Paired allocation code differs in the live process")
    verify_rtv_binding(process, base, documents["native-rtv-manifest.json"])
    for name, hook in eye["hooks"].items():
        if name in manifest["hooks"]:
            raise ValueError("Paired draw hook collides with the original hooks")
        manifest["hooks"][name] = hook


'''.replace("HASHES", repr(hashes))


def _transform(source: str) -> bytes:
    # The exact original bytes were authenticated before normalization. Restrict
    # replacement to complete string literals: private manifest filenames and
    # native-eye-output-code verification retain their original identities.
    source = source.replace("\r\n", "\n").replace("\r", "\n")
    old = 'PROBES = {"native-eye-output": ("native-eye-output.dll", "43e6fd3b2a3e92abd11312e46d1f17ef427a220185fb4a3271b702b7efab8448")}'
    source = unique_replace(source, old,
        f'PROBES = {{"native-eye-output": ("{OBSERVER_NAME}", "{OBSERVER_SHA256}")}}')
    source = source.replace('"native-eye-output"', repr(PROBE)).replace("'native-eye-output'", repr(PROBE))
    source = unique_replace(source,
        '    parser.add_argument("--expected-process-created-filetime", type=int)',
        '    parser.add_argument("--expected-process-created-filetime", type=int, required=True)')
    # All active manifest consumers use the same authenticated snapshots; a
    # second path read cannot substitute different bytes after validation.
    for name in ORIGINALS:
        if not name.endswith(".json"):
            continue
        expression = r"Path\(__file__\)\.with_name\((['\"])" + re.escape(name) + r"\1\)\.read_(text|bytes)\(\)"
        source = re.sub(expression,
            lambda match: f"paired_manifest_bytes[{name!r}]" + (".decode('utf-8')" if match[2] == "text" else ""), source)
    source = unique_replace(source, '    args = parser.parse_args()',
        '    args = parser.parse_args()\n    paired_manifest_bytes = read_paired_manifest_bytes()')
    source = unique_replace(source, 'def main():', _additional_checks() + 'def main():')
    source = unique_replace(source, '        if manifest["exeSha256"] != GAME_HASH:',
        '        verify_paired_owner_code(process, target_base, manifest, paired_manifest_bytes)\n'
        '        if manifest["exeSha256"] != GAME_HASH:')
    # The capture remains diagnostic. Do not make inherited "reviewed" wording
    # into an approval for these new bytes or a ready-to-run operator command.
    source = unique_replace(source, source.splitlines()[0],
        '"""Private paired-source loader candidate; independent review and a fresh admitted session are required."""')
    ast.parse(source)  # Parse only. Never import or execute the private loader.
    return source.encode("utf-8")


def prepare(originals: dict[str, bytes], observer: bytes) -> tuple[dict[str, bytes], dict]:
    if not isinstance(originals, dict) or set(originals) != set(ORIGINALS):
        raise ValueError("Exact original loader closure required")
    for name, (size, digest) in ORIGINALS.items():
        raw = originals[name]
        if type(raw) is not bytes or len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("Original loader closure differs: " + name)
    if type(observer) is not bytes or len(observer) != OBSERVER_BYTES or hashlib.sha256(observer).hexdigest() != OBSERVER_SHA256:
        raise ValueError("Observer differs from the completed native build")
    validate_manifest_inputs(originals)
    loader = _transform(originals["load-native-eye-output.py"].decode("utf-8"))
    members = {name: raw for name, raw in originals.items() if name != "load-native-eye-output.py"}
    members[LOADER_NAME] = loader
    members[OBSERVER_NAME] = observer
    packet = {
        "schema": "stephanos.starfield-paired-loader-review-candidate.v1",
        "documentKind": "NON_EXECUTABLE_REVIEW_PREPARATION",
        "buildHead": BUILD_HEAD, "buildReceipt": BUILD_RECEIPT,
        "originals": {name: identity(raw) for name, raw in originals.items()},
        "members": {name: identity(raw) for name, raw in members.items()},
        "privateOwnerReview": None, "freshSession": None,
        "liveExecutionAllowed": False, "headsetReadinessProven": False,
        "priorSessionMustRemainImmutable": True,
        "requiredContinuation": [
            "Independently review the complete private observer/loader pair and public transformations.",
            "Extend the existing Hybrid session owner with a reviewed successor that preserves the consumed attempt.",
            "Verify fresh current process, resource admission, artifact pins, stock DXGI and actual save-loaded confirmation.",
            "Prove hook withdrawal, game exit and proxy restoration before accepting the diagnostic journal.",
        ],
    }
    return members, packet
