"""Fixed build validation tests; mocked stages never constitute native proof.

Private reconstruction is opt-in with STEPH_OBSERVER_TEST_ORIGINAL_ROOT and
optionally STEPH_OBSERVER_TEST_OVERLAY_ROOT. No private source is baked into CI.
Native file-sharing/deletion tests run only on actual 64-bit Windows.
"""
import base64
import copy
import ctypes
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from contextlib import ExitStack
from unittest.mock import patch


SOURCE = Path(__file__).with_name("native_build.py")
SPEC = importlib.util.spec_from_file_location("native_build_under_test", SOURCE)
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


def record(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "gitBlob": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest(),
            "base64": base64.b64encode(raw).decode()}


def closure(packet):
    packet["sourceClosureSha256"] = build.digest("".join(
        name + "\0" + packet["files"][name]["sha256"] + "\n" for name in sorted(packet["files"])).encode())
    return packet


def packet_fixture():
    payload = {build.ENTRY: b"# entry fixture\n", build.JOB: b"# job fixture\n",
               build.LAUNCHER: b"# launcher fixture\n", build.BUILDER: b"# builder fixture\n",
               build.PACKAGE + "model.h": b"#pragma once\n",
               build.PACKAGE + "test_model.cpp": b"int main(){return 0;}\n"}
    recipe = {"schemaVersion": "stephanos.starfield-native-build-recipe.v1", "stage": build.STAGE,
              "originalPackageSha256": build.ORIGINAL_PACKAGE,
              "publicMembers": [{"path": name, "sha256": build.digest(raw)} for name, raw in payload.items()
                                if name.startswith(build.PACKAGE)]}
    payload[build.RECIPE] = json.dumps(recipe, sort_keys=True).encode()
    packet = {"schemaVersion": "stephanos.starfield-native-build-input.v1", "sourceHead": "a" * 40,
              "requestId": "native-build-test-0001", "stage": build.STAGE, "sourceClosureSha256": "",
              "parentPid": 1234, "parentBirthFileTime": "133000000000000001",
              "launcherPid": 1235, "launcherBirthFileTime": "133000000000000002",
              "files": {name: record(raw) for name, raw in payload.items()}}
    return closure(packet)


def governor(**changes):
    value = {"schemaVersion": "stephanos.vr-resource-governor.v1", "governorVersion": 3,
             "updatedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "active": False, "flatGameActive": False, "airLinkActive": False,
             "realAirLinkActive": False, "virtualAirLinkTestActive": False, "prepareLeaseActive": False,
             "phase": "NORMAL", "overrideMode": "AUTO", "ollamaLoadMode": "balanced",
             "cooldownUntilUtc": "", "localModelAllowed": True, "heavyModelAllowed": True}
    value.update(changes)
    return value


class PacketTests(unittest.TestCase):
    def test_exact_packet_and_git_blob_binding(self):
        packet = packet_fixture();verified, recipe = build.validate_packet(packet)
        self.assertEqual(set(verified), set(packet["files"]))
        self.assertEqual(len(verified), 7)
        self.assertEqual(recipe["originalPackageSha256"], build.ORIGINAL_PACKAGE)

    def test_duplicate_json_fields_and_nonfinite_values(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":{"a":1,"a":2}}', b'{"x":NaN}', b'{"x":Infinity}', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(build.BuildBlocked):build.strict_json(raw)

    def test_identity_types_and_closed_top_level(self):
        bad = [("sourceHead", int("1" * 40)), ("requestId", 12345678),
               ("sourceClosureSha256", int("1" * 64)), ("sourceHead", "A" * 40),
               ("parentPid", True), ("parentPid", 0), ("launcherPid", 3.0),
               ("parentBirthFileTime", 133000000000000001), ("parentBirthFileTime", "01"),
               ("launcherBirthFileTime", "18446744073709551616"), ("stage", "unregistered")]
        for name, value in bad:
            packet = packet_fixture();packet[name] = value
            with self.subTest(name=name, value=value), self.assertRaises(build.BuildBlocked):build.validate_packet(packet)
        packet = packet_fixture();packet["command"] = "anything"
        with self.assertRaises(build.BuildBlocked):build.validate_packet(packet)

    def test_changed_bytes_size_hash_blob_and_encoding(self):
        for key, value in (("bytes", True), ("bytes", 1), ("sha256", "b" * 64),
                           ("gitBlob", "b" * 40), ("base64", "!!not-base64!!")):
            packet = packet_fixture();packet["files"][build.ENTRY][key] = value;closure(packet)
            with self.subTest(key=key), self.assertRaises(build.BuildBlocked):build.validate_packet(packet)
        packet = packet_fixture();packet["sourceClosureSha256"] = "b" * 64
        with self.assertRaises(build.BuildBlocked):build.validate_packet(packet)

    def test_missing_extra_and_unapproved_path_members(self):
        packet = packet_fixture();del packet["files"][build.LAUNCHER];closure(packet)
        with self.assertRaises(build.BuildBlocked):build.validate_packet(packet)
        for extra in (build.PACKAGE + "extra.h", build.PACKAGE + "../other.h", "scripts/other.py"):
            packet = packet_fixture();packet["files"][extra] = record(b"extra\n");closure(packet)
            with self.subTest(extra=extra), self.assertRaises(build.BuildBlocked):build.validate_packet(packet)

    def test_recipe_duplicate_case_and_extra_fields(self):
        for mode in ("duplicate", "case", "field", "wrong_hash"):
            packet = packet_fixture();recipe = json.loads(base64.b64decode(packet["files"][build.RECIPE]["base64"]))
            if mode == "duplicate":recipe["publicMembers"].append(dict(recipe["publicMembers"][0]))
            elif mode == "case":
                old = build.PACKAGE + "model.h";new = build.PACKAGE + "MODEL.h"
                packet["files"][new] = copy.deepcopy(packet["files"][old])
                recipe["publicMembers"].append({"path": new, "sha256": packet["files"][new]["sha256"]})
            elif mode == "field":recipe["arbitraryPath"] = True
            else:recipe["publicMembers"][0]["sha256"] = "b" * 64
            packet["files"][build.RECIPE] = record(json.dumps(recipe).encode());closure(packet)
            with self.subTest(mode=mode), self.assertRaises(build.BuildBlocked):build.validate_packet(packet)


class FilesAndGamingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="starfield-build-contract-")
        self.root = Path(self.temp.name);self.vr = self.root / "vr";self.vr.mkdir()
        self.state = self.vr / "vr-resource-governor-current.json"
        self.write_state(governor())

    def tearDown(self):self.temp.cleanup()

    def write_state(self, value):self.state.write_text(json.dumps(value), encoding="utf-8")

    def test_relative_paths_do_not_normalize_authority(self):
        for value in ("../x", "x/../y", "./x", "x/./y", "/absolute", "C:/x", "x\\y", "x//y", "", "CON", "dir./file.h", "aux.txt"):
            with self.subTest(value=value), self.assertRaises(build.BuildBlocked):build.safe_relative(value)
        self.assertEqual(build.safe_relative("vendor/minhook/header.h"), "vendor/minhook/header.h")

    def test_links_and_hardlinks_refuse_plain_file(self):
        source = self.root / "source.h";source.write_bytes(b"source")
        self.assertEqual(build.require_plain(source).st_size, 6)
        hard = self.root / "hard.h"
        try:os.link(source, hard)
        except (OSError, NotImplementedError):self.skipTest("Hard links unavailable")
        with self.assertRaises(build.BuildBlocked):build.require_plain(source)
        hard.unlink()
        link = self.root / "link.h"
        try:link.symlink_to(source)
        except (OSError, NotImplementedError):self.skipTest("Symlink creation unavailable")
        with self.assertRaises(build.BuildBlocked):build.require_plain(link)

    def test_dangling_preparation_and_override_hold(self):
        for name in ("gaming-resource-prepare.json", "gaming-resource-override.json"):
            target = self.vr / name
            try:target.symlink_to(self.root / "absent")
            except (OSError, NotImplementedError):self.skipTest("Symlink creation unavailable")
            self.assertTrue(build.entry_present(target))
            with self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)
            target.unlink()

    def test_governor_normal_and_authority_flags(self):
        self.assertTrue(build.gaming_admitted(self.root))
        for field in ("active", "flatGameActive", "airLinkActive", "realAirLinkActive", "virtualAirLinkTestActive", "prepareLeaseActive"):
            for value in (True, 0, None, "false"):
                self.write_state(governor(**{field: value}))
                with self.subTest(field=field, value=value), self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)
        for field in ("localModelAllowed", "heavyModelAllowed"):
            for value in (False, 1, None, "true"):
                self.write_state(governor(**{field: value}))
                with self.subTest(field=field, value=value), self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)

    def test_governor_clock_and_version_types(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        clocks = [(now - datetime.timedelta(seconds=60)).isoformat(),
                  (now + datetime.timedelta(seconds=60)).isoformat(),
                  now.replace(tzinfo=None).isoformat(), "not-a-clock", 4, None]
        for clock in clocks:
            self.write_state(governor(updatedAtUtc=clock))
            with self.subTest(clock=clock), self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)
        for value in (True, 3.0, "3", None):
            self.write_state(governor(governorVersion=value))
            with self.subTest(value=value), self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)

    def test_governor_phase_override_and_prepare_are_holds(self):
        for fields in ({"phase": "COOLDOWN"}, {"overrideMode": "HOLD"}, {"ollamaLoadMode": "heavy"}, {"cooldownUntilUtc": "future"}):
            self.write_state(governor(**fields))
            with self.subTest(fields=fields), self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)
        self.write_state(governor());override = self.vr / "gaming-resource-override.json"
        override.write_text(json.dumps({"schemaVersion": "stephanos.gaming-resource-override.v1", "mode": "AUTO"}))
        self.assertTrue(build.gaming_admitted(self.root))
        override.write_text(json.dumps({"schemaVersion": "stephanos.gaming-resource-override.v1", "mode": "HOLD"}))
        with self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)
        override.unlink();(self.vr / "gaming-resource-prepare.json").write_text("{}")
        with self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)

    def test_governor_duplicate_and_nonobject_json(self):
        for raw in ('{"active":false,"active":true}', '[]', '{"active":NaN}'):
            self.state.write_text(raw)
            with self.subTest(raw=raw), self.assertRaises(build.BuildBlocked):build.gaming_admitted(self.root)

    def test_source_records_and_content_verification(self):
        records = {}
        for index in range(5):
            name = f"input{index}.h";raw = f"source{index}".encode();(self.root / name).write_bytes(raw)
            records[name] = {"sha256": build.digest(raw), "bytes": len(raw)}
        builder = types.SimpleNamespace(ORIGINAL_FILES=records)
        self.assertEqual(build.source_records(builder), records);build.verify_originals(self.root, records)
        (self.root / "input0.h").write_bytes(b"changed")
        with self.assertRaises(build.BuildBlocked):build.verify_originals(self.root, records)
        for bad in ({**records, "INPUT1.h": records["input1.h"]}, {**records, "../escape": records["input1.h"]}):
            with self.assertRaises(build.BuildBlocked):build.source_records(types.SimpleNamespace(ORIGINAL_FILES=bad))
        bad = copy.deepcopy(records);bad["input0.h"]["bytes"] = True
        with self.assertRaises(build.BuildBlocked):build.source_records(types.SimpleNamespace(ORIGINAL_FILES=bad))

    def test_exact_staged_members_and_artifacts(self):
        stage = self.root / "staged";stage.mkdir();files = {}
        for index in range(5):
            name = f"file{index}.h";raw = f"file {index}".encode();(stage / name).write_bytes(raw)
            files[name] = {"bytes": len(raw), "sha256": build.digest(raw)}
        result = {"buildCommand": "build-paired-source-observe.cmd", "files": files, "artifacts": list(build.EXPECTED_ARTIFACTS)}
        self.assertEqual(build.verify_staged(stage, result), list(build.EXPECTED_ARTIFACTS))
        for artifact_list in (list(reversed(build.EXPECTED_ARTIFACTS)), list(build.EXPECTED_ARTIFACTS)[:-1], list(build.EXPECTED_ARTIFACTS) + ["unexpected.exe"]):
            with self.assertRaises(build.BuildBlocked):build.verify_staged(stage, {**result, "artifacts": artifact_list})
        (stage / "undeclared.h").write_bytes(b"extra")
        with self.assertRaises(build.BuildBlocked):build.verify_staged(stage, result)
        (stage / "undeclared.h").unlink();(stage / "file0.h").write_bytes(b"mutated")
        with self.assertRaises(build.BuildBlocked):build.verify_staged(stage, result)


@unittest.skipIf(os.name == "nt", "Portable persistence seam; native lock cases below")
class PortableCustodyTests(unittest.TestCase):
    def test_prior_lock_never_reclaimed_and_held_receipt_persists(self):
        with tempfile.TemporaryDirectory(prefix="starfield-build-lock-") as temporary:
            directory = Path(temporary);packet = packet_fixture();active = build.ActiveBuild(directory, packet)
            identity = active.identity
            try:
                with self.assertRaises(build.BuildBlocked):build.ActiveBuild(directory, packet)
                active.bind({"root_pid": 200, "root_created_filetime": "133000000000000003", "assigned_before_execution": True})
                saved = json.loads(active.path.read_text());self.assertEqual(saved["state"], "ROOT_SUSPENDED_IN_OWNED_JOB")
                active.finish({"finalVerdict": "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD", "executionCustodyReleased": False,
                               "allJobsEmpty": False, "originalSourceUnchanged": True})
                self.assertEqual(active.path.stat().st_ino, identity.st_ino)
                self.assertIs(json.loads(active.path.read_text())["executionCustodyReleased"], False)
                with self.assertRaises(build.BuildBlocked):build.ActiveBuild(directory, packet)
            finally:active.close()

    def test_changed_path_cannot_redirect_custody_write(self):
        with tempfile.TemporaryDirectory(prefix="starfield-build-lock-") as temporary:
            directory = Path(temporary);active = build.ActiveBuild(directory, packet_fixture())
            try:
                moved = directory / "retained-owner.json";active.path.rename(moved);active.path.write_text('{"replacement":true}')
                with self.assertRaises(build.BuildBlocked):active.bind({"root_pid": 201})
                self.assertEqual(json.loads(active.path.read_text()), {"replacement": True})
                self.assertTrue(moved.exists())
            finally:active.close()


@unittest.skipUnless(os.environ.get("STEPH_OBSERVER_TEST_ORIGINAL_ROOT"), "Private original integration requires explicit local test opt-in")
class PrivateReconstructionTests(unittest.TestCase):
    def test_exact_original_reconstruction_and_source_unchanged(self):
        original = Path(os.environ["STEPH_OBSERVER_TEST_ORIGINAL_ROOT"]).resolve(strict=True)
        overlay = Path(os.environ.get("STEPH_OBSERVER_TEST_OVERLAY_ROOT", str(SOURCE.parents[3] / build.PACKAGE))).resolve(strict=True)
        spec = importlib.util.spec_from_file_location("private_test_reconstruct", overlay / "reconstruct_paired_observer.py")
        builder = importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        records = build.source_records(builder);build.verify_originals(original, records)
        before = {name: build.digest((original / name).read_bytes()) for name in records}
        with tempfile.TemporaryDirectory(prefix="starfield-private-reconstruction-") as temporary:
            destination = Path(temporary) / "source"
            output = builder.reconstruct(original, destination, {name: (overlay / name).read_bytes() for name in builder.MEMBERS})
            self.assertEqual(build.verify_staged(destination, output), list(build.EXPECTED_ARTIFACTS))
            self.assertEqual(output["buildCommand"], "build-paired-source-observe.cmd")
        self.assertEqual(before, {name: build.digest((original / name).read_bytes()) for name in records})


class PortableOrchestrationModelTests(unittest.TestCase):
    """Control-flow fault injection only; no Win32, compiler or child executes."""
    def exercise(self, mode):
        packet = packet_fixture();verified, _ = build.validate_packet(packet)
        with tempfile.TemporaryDirectory(prefix="starfield-build-mocked-stage-") as temporary:
            root = Path(temporary);original = root / "original";original.mkdir()
            workspace = root / "workspace";workspace.mkdir();(workspace / "vr").mkdir()
            (workspace / "vr" / "vr-resource-governor-current.json").write_text(json.dumps(governor()))
            builds = root / "builds";records = {}
            for index in range(5):
                name = f"source{index}.h";raw = f"original {index}".encode();(original / name).write_bytes(raw)
                records[name] = {"sha256": build.digest(raw), "bytes": len(raw)}
            observed = {"nativeCalls": 0, "mockStageCalls": 0, "pendingReceipts": []}

            class Proxy:
                def __init__(self, target, **values):self.target = target;self.values = values
                def __getattr__(self, key):return self.values[key] if key in self.values else getattr(self.target, key)

            class PinsModel:
                def pin_parents(self, path):pass
                def read(self, path, maximum):
                    raw = Path(path).read_bytes()
                    if len(raw) > maximum:raise build.BuildBlocked("MODEL_READ_BOUND")
                    return raw
                def close(self):pass

            class CustodyModel:
                def __init__(self, directory, admitted):
                    self.path = directory / "active.json";self.record = {"state": "RESERVED", "executionCustodyReleased": False}
                    with self.path.open("xb") as stream:stream.write(json.dumps(self.record).encode())
                def write(self):self.path.write_text(json.dumps(self.record))
                def bind(self, identity):self.record.update(state="ROOT_SUSPENDED_IN_OWNED_JOB", root=dict(identity));self.write();return True
                def finish(self, receipt):
                    terminal = builds / packet["requestId"] / "build-receipt.json"
                    if terminal.exists():observed["pendingReceipts"].append(json.loads(terminal.read_text()))
                    if mode == "finalize_failure":raise build.BuildBlocked("MODEL_CUSTODY_FINALIZATION_FAILED")
                    self.record.update(state=receipt["finalVerdict"], executionCustodyReleased=receipt["executionCustodyReleased"])
                    self.write()
                    if receipt["executionCustodyReleased"] and receipt["allJobsEmpty"] and receipt["originalSourceUnchanged"]:self.path.unlink()
                def close(self):pass

            def reconstruct(_original, destination, _overlay):
                destination.mkdir();files = {}
                for name in ("build-paired-source-observe.cmd", "a.h", "b.h", "c.h", "d.h"):
                    raw = b"portable orchestration fixture only\n";(destination / name).write_bytes(raw)
                    files[name] = {"sha256": build.digest(raw), "bytes": len(raw)}
                return {"buildCommand": "build-paired-source-observe.cmd", "files": files,
                        "artifacts": list(build.EXPECTED_ARTIFACTS)}

            def mock_stage(**arguments):
                observed["mockStageCalls"] += 1
                self.assertEqual(arguments["executable"], r"C:\Windows\System32\cmd.exe")
                self.assertEqual(arguments["args"], ["/d", "/s", "/c", "build-paired-source-observe.cmd"])
                self.assertFalse(arguments["cancel_requested"]())
                self.assertTrue(arguments["on_suspended"]({"root_pid": 200, "root_created_filetime": "133000000000000003", "assigned_before_execution": True}))
                for name in build.EXPECTED_ARTIFACTS:(Path(arguments["cwd"]) / name).write_bytes(b"MZ-PORTABLE-MOCK-NOT-A-NATIVE-BINARY")
                if mode == "source_changed":(original / "source0.h").write_bytes(b"changed by explicit fault fixture")
                result = {"operation_ok": True, "root_exit_code": 0, "root_exited": True,
                          "zero_active_processes_observed": True, "custody_released": True,
                          "output_complete": True, "output_text": "PORTABLE MOCK ONLY\nSTEPHANOS_PAIRED_OBSERVER_BUILD_PASSED\n"}
                if mode == "missing_marker":result["output_text"] = "PORTABLE MOCK ONLY"
                if mode == "unknown_exit":result["root_exit_code"] = None
                if mode == "boolean_exit":result["root_exit_code"] = False
                if mode == "float_exit":result["root_exit_code"] = 0.0
                if mode.startswith("truthy_"):result[mode[len("truthy_"):]] = 1
                if mode == "custody_held":result.update(operation_ok=False, custody_released=False)
                if mode == "missing_artifact":(Path(arguments["cwd"]) / build.EXPECTED_ARTIFACTS[-1]).unlink()
                return result

            job = types.SimpleNamespace(observe_parent_identity=lambda *_: {"ok": True, "alive": True}, run_owned_stage=mock_stage)
            builder = types.SimpleNamespace(ORIGINAL_FILES=records, reconstruct=reconstruct)
            real_os, real_sys = build.os, build.sys

            def fsync_model(fd):
                terminal = builds / packet["requestId"] / "build-receipt.json"
                if mode == "terminal_final_fsync_failure" and terminal.exists():
                    opened, current = real_os.fstat(fd), terminal.stat()
                    if (opened.st_ino, opened.st_dev) == (current.st_ino, current.st_dev):
                        persisted = json.loads(terminal.read_text())
                        if persisted.get("terminalFinalized") is True:
                            raise OSError("Explicit portable terminal-fsync fault")
                return real_os.fsync(fd)

            with ExitStack() as stack:
                stack.enter_context(patch.object(build, "os", Proxy(real_os, name="nt", getppid=lambda: packet["launcherPid"], fsync=fsync_model)))
                stack.enter_context(patch.object(build, "sys", Proxy(real_sys, flags=types.SimpleNamespace(isolated=1, no_site=1, optimize=0), dont_write_bytecode=True)))
                stack.enter_context(patch.object(build, "fixed_roots", return_value=(original, builds, workspace)))
                stack.enter_context(patch.object(build, "NativePins", PinsModel))
                stack.enter_context(patch.object(build, "ActiveBuild", CustodyModel))
                stack.enter_context(patch.object(build, "toolchain", return_value=(root / "fixture-cl.exe", {"fixture": "not-native"})))
                stack.enter_context(patch.object(build, "load_verified", side_effect=lambda _name, path, _raw: job if path == build.JOB else builder))
                receipt = build.run_build(packet, verified)
            terminal = builds / packet["requestId"] / "build-receipt.json"
            saved = json.loads(terminal.read_text()) if terminal.exists() else None
            owner_path = builds / "active.json";owner = json.loads(owner_path.read_text()) if owner_path.exists() else None
            self.assertEqual(observed["nativeCalls"], 0)
            self.assertEqual(observed["mockStageCalls"], 1)
            for field in build.FALSE_CLAIMS:self.assertIs(receipt[field], False)
            for pending in observed["pendingReceipts"]:
                self.assertIs(pending["terminalFinalized"], False)
                self.assertIs(pending["executionCustodyReleased"], False)
                self.assertEqual(pending["finalVerdict"], "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD")
            return receipt, saved, owner

    def test_portable_mock_models_successful_control_flow_only(self):
        receipt, saved, owner = self.exercise("success")
        self.assertEqual(receipt["finalVerdict"], "STARFIELD_VR_NATIVE_BUILD_PASSED")
        self.assertIs(receipt["terminalFinalized"], True);self.assertEqual(saved, receipt);self.assertIsNone(owner)
        self.assertEqual([r["name"] for r in receipt["artifacts"]], list(build.EXPECTED_ARTIFACTS))

    def test_missing_marker_exit_and_artifact_never_pass(self):
        for mode in ("missing_marker", "unknown_exit", "boolean_exit", "float_exit", "missing_artifact"):
            with self.subTest(mode=mode):
                receipt, saved, _ = self.exercise(mode)
                self.assertNotEqual(receipt["finalVerdict"], "STARFIELD_VR_NATIVE_BUILD_PASSED")
                self.assertEqual(saved, receipt)

    def test_truthy_proof_flags_never_pass(self):
        for field in ("operation_ok", "root_exited", "zero_active_processes_observed", "custody_released", "output_complete"):
            with self.subTest(field=field):
                receipt, saved, _ = self.exercise("truthy_" + field)
                self.assertNotEqual(receipt["finalVerdict"], "STARFIELD_VR_NATIVE_BUILD_PASSED")
                self.assertEqual(saved, receipt)

    def test_terminal_fsync_failure_never_leaves_authoritative_pass(self):
        receipt, saved, _ = self.exercise("terminal_final_fsync_failure")
        self.assertEqual(receipt["finalVerdict"], "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD")
        self.assertIs(receipt["executionCustodyReleased"], False)
        self.assertFalse(saved.get("terminalFinalized") is True
                         and saved.get("finalVerdict") == "STARFIELD_VR_NATIVE_BUILD_PASSED")

    def test_source_recheck_failure_keeps_owner(self):
        receipt, saved, owner = self.exercise("source_changed")
        self.assertIs(receipt["originalSourceUnchanged"], False)
        self.assertNotEqual(receipt["finalVerdict"], "STARFIELD_VR_NATIVE_BUILD_PASSED")
        self.assertEqual(saved, receipt);self.assertIsNotNone(owner)

    def test_custody_and_finalization_failures_persist_held_truth(self):
        for mode in ("custody_held", "finalize_failure"):
            with self.subTest(mode=mode):
                receipt, saved, owner = self.exercise(mode)
                self.assertEqual(receipt["finalVerdict"], "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD")
                self.assertIs(receipt["executionCustodyReleased"], False)
                self.assertEqual(saved, receipt);self.assertIs(owner["executionCustodyReleased"], False)


@unittest.skipUnless(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8, "Actual Windows file-sharing/deletion semantics required")
class WindowsNativeCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="starfield-native-pins-");self.root = Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()

    def test_native_pins_deny_write_delete_and_replacement_until_close(self):
        source = self.root / "source.h";source.write_bytes(b"exact source")
        pins = build.NativePins()
        try:
            self.assertEqual(pins.read(source, 100), b"exact source")
            with self.assertRaises(OSError):source.write_bytes(b"mutation")
            with self.assertRaises(OSError):source.unlink()
            replacement = self.root / "replacement.h";replacement.write_bytes(b"replacement")
            with self.assertRaises(OSError):os.replace(replacement, source)
            self.assertEqual(source.read_bytes(), b"exact source")
        finally:pins.close()
        source.write_bytes(b"after release");source.unlink();self.assertFalse(source.exists())

    def test_active_lock_deletes_only_owned_handle_after_proven_release(self):
        active = build.ActiveBuild(self.root, packet_fixture())
        try:
            with self.assertRaises(OSError):active.path.rename(self.root / "moved.json")
            with self.assertRaises(build.BuildBlocked):build.ActiveBuild(self.root, packet_fixture())
            active.finish({"finalVerdict": "STARFIELD_VR_NATIVE_BUILD_PASSED", "executionCustodyReleased": True,
                           "allJobsEmpty": True, "originalSourceUnchanged": True})
            self.assertFalse(active.path.exists())
        finally:active.close()

    def test_native_release_failure_retains_exact_lock_and_held_status(self):
        active = build.ActiveBuild(self.root, packet_fixture());identity = active.identity
        try:
            with patch.object(active.kernel, "SetFileInformationByHandle", return_value=False):
                with self.assertRaises(build.BuildBlocked):active.finish({"finalVerdict": "STARFIELD_VR_NATIVE_BUILD_PASSED",
                    "executionCustodyReleased": True, "allJobsEmpty": True, "originalSourceUnchanged": True})
            self.assertTrue(active.path.exists());self.assertEqual(active.path.stat().st_ino, identity.st_ino)
            # The enclosing run_build recovery records held status. Here the
            # direct method test proves physical same-owner exclusion on failure.
            with self.assertRaises(build.BuildBlocked):build.ActiveBuild(self.root, packet_fixture())
        finally:active.close()

    def test_unproved_job_zero_keeps_native_lock(self):
        active = build.ActiveBuild(self.root, packet_fixture());identity = active.identity
        try:
            active.finish({"finalVerdict": "STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD", "executionCustodyReleased": False,
                           "allJobsEmpty": False, "originalSourceUnchanged": True})
            self.assertEqual(active.path.stat().st_ino, identity.st_ino)
            with self.assertRaises(build.BuildBlocked):build.ActiveBuild(self.root, packet_fixture())
        finally:active.close()


if __name__ == "__main__":unittest.main()
