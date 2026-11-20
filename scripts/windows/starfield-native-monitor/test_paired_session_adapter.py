"""Fixed-profile ownership and recovery contracts; no game or loader executes."""
import copy
import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

import test_run_native_eye_output_monitor as fixtures
import test_start_native_eye_output_session as starter_fixtures
import test_splash_monitor_bridge as splash_fixtures

spec = importlib.util.spec_from_file_location('paired_adapter_test', Path(__file__).with_name('paired_session_adapter.py'))
paired = importlib.util.module_from_spec(spec)
spec.loader.exec_module(paired)
m = fixtures.m
helper = starter_fixtures.starter


class FixedProfileTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.run, self.source = self.root / 'run', self.root / 'source'
        self.run.mkdir()
        self.source.mkdir()
        for name, value in (('RUN_DIRECTORY', self.run), ('SOURCE', self.source)):
            patch = mock.patch.object(m, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        custody = splash_fixtures.b.custody_model()
        self.Journal, self.Actions, self.Store = paired.classes(m, helper, custody, m.reviewed_runner_hashes())

    def journal(self):
        result = self.Journal()
        result.admission = lambda token: {'testOnlyAuthenticatedPredecessor': True}
        return result

    def test_legacy_and_paired_journals_share_one_owner_lock(self):
        old = m.Journal(self.run)
        new = self.journal()
        self.assertEqual(old.lock, new.lock)
        old.acquire()
        old_bytes = old.path.read_bytes()
        try:
            with self.assertRaises(m.Blocked):
                new.acquire()
            self.assertIsNone(new.token)
            self.assertFalse(new.path.exists())
            self.assertEqual(old.path.read_bytes(), old_bytes)
        finally:
            old.release()

    def test_failed_successor_admission_does_not_create_a_new_namespace(self):
        journal = self.journal()
        journal.admission = mock.Mock(side_effect=m.Blocked('predecessor not proven'))
        try:
            with self.assertRaisesRegex(m.Blocked, 'predecessor not proven'):
                journal.acquire()
            self.assertFalse(journal.directory.exists())
            self.assertIsNone(journal.state)
        finally:
            journal.release()

    def test_two_paired_windows_cannot_both_reserve_the_attempt(self):
        first, second = self.journal(), self.journal()
        first.acquire()
        try:
            with self.assertRaises(m.Blocked):
                second.acquire()
            self.assertEqual(first.state['sessionProfile'], paired.PROFILE)
            self.assertEqual(first.state['reviewedDllSha256'], paired.DLL_SHA256)
            self.assertIs(first.state['packagePrepared'], False)
        finally:
            first.release()

    def test_reopen_adds_cleanup_owner_without_replacing_capture_identity(self):
        first = self.journal()
        first.acquire()
        original = copy.deepcopy(first.state)
        first.release()
        reopened = self.journal()
        self.assertFalse(reopened.acquire())
        try:
            for key in ('runId', 'operatorLockOwner', 'windowProcessId', 'captureAttempted',
                        'saveLoadedConfirmed', 'reviewedDllSha256', 'predecessor'):
                self.assertEqual(reopened.state[key], original[key])
            recovery = reopened.state['recoveryOwner']
            self.assertEqual(recovery['scope'], 'cleanup-only')
            self.assertNotEqual(recovery['owner'], original['operatorLockOwner'])
        finally:
            reopened.release()

    def test_reopened_profile_cannot_reconfirm_or_load(self):
        first = self.journal()
        first.acquire()
        first.release()
        journal = self.journal()
        host = fixtures.FakeHost(journal)
        monitor = m.Monitor(journal, host)
        try:
            self.assertEqual(monitor.prepare(), 'existing')
            with self.assertRaises(m.Blocked):
                monitor.confirm_save_loaded()
            self.assertNotIn('load', host.calls)
            self.assertNotIn('start', host.calls)
        finally:
            journal.release()

    def test_both_starter_profiles_share_the_legacy_operation_lock(self):
        old, new = helper.Store(self.source), self.Store()
        self.assertEqual(old.lock, new.lock)
        self.assertNotEqual(old.path, new.path)
        with old.operation():
            with self.assertRaises(helper.Blocked):
                with new.operation():
                    self.fail('second starter acquired the same lock')

    def test_existing_starter_state_machine_reserves_fixed_paired_identity(self):
        store = self.Store()
        host = starter_fixtures.FakeHost(store)
        result = helper.start(store, host)
        self.assertEqual(result['sessionProfile'], paired.PROFILE)
        self.assertEqual(result['reviewedDllSha256'], paired.DLL_SHA256)
        self.assertEqual(host.effects, ['isolate', 'launch'])
        self.assertIs(result['captureAttempted'], False)
        with self.assertRaises(helper.Blocked):
            helper.start(store, host)
        self.assertEqual(host.effects, ['isolate', 'launch'])

    def test_paired_starter_refuses_legacy_profile_bytes(self):
        store = self.Store()
        host = starter_fixtures.FakeHost(store)
        state = helper.start(store, host)
        state['reviewedDllSha256'] = helper.DLL_HASH
        store.save(state)
        with self.assertRaises(helper.Blocked):
            store.load()

    def test_readiness_binding_requires_the_closed_profiles_own_dll(self):
        receipt = fixtures.starter_receipt()
        with self.assertRaises(m.Blocked):
            m.waiting_receipt(receipt, paired.DLL_SHA256)
        receipt['reviewedDllSha256'] = paired.DLL_SHA256
        self.assertIs(m.waiting_receipt(receipt, paired.DLL_SHA256), receipt)
        with self.assertRaises(m.Blocked):
            m.waiting_receipt(receipt)

    def test_missing_or_changed_qualification_cannot_materialize_a_package(self):
        pins = types.SimpleNamespace(add_namespaces=lambda paths: None, add=lambda paths: None)
        with self.assertRaises((OSError, m.Blocked)):
            paired.qualification(m, pins)
        path = self.run / 'paired-owner-qualification.json'
        path.write_bytes(b'{"runtimeAdmissionGranted":true}')
        with self.assertRaises(m.Blocked):
            paired.checked_package(m, pins, {'packagePrepared': False, 'captureAttempted': False}, create=True)
        self.assertFalse((self.run / paired.PROFILE).exists())


class ChildAuthorityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / paired.PROFILE).mkdir()
        self.core = types.SimpleNamespace(**{name: getattr(m, name) for name in (
            'SCHEMA', 'WORKSPACE', 'HANDOFF_SHA256', 'sha256', 'strict_json', 'bounded_bytes', 'Blocked')})
        self.core.__file__ = m.__file__
        self.core.RUN_DIRECTORY = self.root
        self.lock = {'owner': 'e' * 32, 'pid': os.getppid()}
        self.state = {'schema': m.SCHEMA, 'workspace': str(m.WORKSPACE),
            'handoffSha256': m.HANDOFF_SHA256, 'sessionProfile': paired.PROFILE,
            'reviewedDllSha256': paired.DLL_SHA256, 'runnerSha256': m.sha256(Path(m.__file__).read_bytes()),
            'runId': 'a' * 32, 'operatorLockOwner': self.lock['owner'], 'windowProcessId': self.lock['pid'],
            'stage': 'STARTER_LAUNCH_INTENT', 'captureAttempted': False, 'saveLoadedConfirmed': False,
            'starterSessionId': None, 'process': None, 'predecessor': {'testFixture': True}}
        self.custody = types.SimpleNamespace(custody_snapshot=mock.Mock(return_value={}),
                                             validate_predecessor=mock.Mock())

    def observe(self, action):
        (self.root / 'operator.lock').write_bytes(m.json_bytes(self.lock))
        (self.root / paired.PROFILE / 'session.json').write_bytes(m.json_bytes(self.state))
        return paired.child_owner(self.core, object(), self.custody, set(), action)

    def recover(self):
        self.lock['owner'] = 'f' * 32
        self.state['recoveryOwner'] = {'scope': 'cleanup-only', 'runId': self.state['runId'], **self.lock}

    def test_primary_owner_can_observe_its_reserved_launch(self):
        state, lock = self.observe('start')
        self.assertEqual(state, self.state)
        self.assertEqual(lock, self.lock)
        self.custody.validate_predecessor.assert_called_once()

    def test_recovery_token_is_limited_to_status_and_finish(self):
        self.recover()
        for action in ('status', 'finish'):
            self.observe(action)
        for action in ('start', 'modules', 'scene', 'stock', 'load'):
            with self.subTest(action=action), self.assertRaises(m.Blocked):
                self.observe(action)

    def test_foreign_recovery_session_and_lock_are_rejected(self):
        self.recover()
        for key, value in (('scope', 'capture'), ('runId', 'b' * 32), ('owner', '0' * 32), ('pid', True)):
            original = self.state['recoveryOwner'][key]
            self.state['recoveryOwner'][key] = value
            with self.subTest(key=key), self.assertRaises(m.Blocked):
                self.observe('finish')
            self.state['recoveryOwner'][key] = original

    def test_corrupt_primary_identity_never_becomes_launch_authority(self):
        for key, value in (('runId', None), ('reviewedDllSha256', m.DLL_SHA256),
                           ('runnerSha256', '0' * 64), ('windowProcessId', True),
                           ('sessionProfile', 'legacy'), ('saveLoadedConfirmed', True),
                           ('captureAttempted', 0), ('process', {})):
            original = self.state[key]
            self.state[key] = value
            with self.subTest(key=key), self.assertRaises(m.Blocked):
                self.observe('start')
            self.state[key] = original

    def test_missing_owner_nonce_cannot_match_a_missing_state_nonce(self):
        del self.lock['owner']
        del self.state['operatorLockOwner']
        with self.assertRaises(m.Blocked):
            self.observe('status')


class PairedResultTests(unittest.TestCase):
    def setUp(self):
        import test_analyze_paired_source_session as evidence
        self.evidence = evidence
        self.fixture = fixtures.ResultBundleTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.state = self.fixture.state
        self.fixture.journal.dll_sha256 = paired.DLL_SHA256
        custody = splash_fixtures.b.custody_model()
        _, actions_type, _ = paired.classes(m, helper, custody, m.reviewed_runner_hashes())
        self.host = actions_type.__new__(actions_type)
        self.host.__dict__.update(self.fixture.host.__dict__)
        self.host.capture_source = self.fixture.folder / 'paired-package'
        self.host.capture_source.mkdir()
        self.host.capture_prefix = 'native-paired-source-observe'
        self.host.paired_analyzer = evidence.m
        self.patch = mock.patch.object(evidence.m, 'DRAW_MANIFEST_SHA256', evidence.m.digest(evidence.MANIFEST))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        (self.host.capture_source / 'native-eye-manifest.json').write_bytes(evidence.MANIFEST)
        self.capture = self.host.capture_source / ('native-paired-source-observe-%d.jsonl' % fixtures.PROCESS['pid'])
        self.capture.write_bytes(evidence.encoded(evidence.rows()))
        self.state.update(sessionProfile=paired.PROFILE, reviewedDllSha256=paired.DLL_SHA256)
        self.state['loaderReceipt']['dllSha256'] = paired.DLL_SHA256
        raw = m.json_bytes(self.state['loaderReceipt'])
        (self.fixture.journal.directory / self.fixture.stdout_name).write_bytes(raw)
        self.state['childCalls'][0]['stdoutSha256'] = m.sha256(raw)
        self.fixture.marker.update(reviewedDllSha256=paired.DLL_SHA256, loaderSha256=paired.LOADER_SHA256)
        for name in ('stock-child-consumed.json', 'loader-child-consumed.json'):
            (self.fixture.journal.directory / name).write_bytes(m.json_bytes(self.fixture.marker))

    def test_complete_paired_diagnostic_and_cleanup_produce_a_non_headset_result(self):
        self.host.collect_results(self.state)
        self.assertTrue(self.state['analysis']['monitorCaptureAccepted'], self.state['analysis']['reasons'])
        self.assertTrue(self.state['bundleEvidenceIntegrityVerified'], self.state['bundleEvidenceIssues'])
        self.assertEqual(self.state['outcome'], 'REVIEWED_MONITOR_TEST_PASSED')
        self.assertIs(self.state['playableVRProven'], False)
        self.assertIs(self.state['analysis']['processExitProven'], False)
        for claim in self.evidence.m.FALSE_CLAIMS:
            self.assertIs(self.state['analysis'][claim], False, claim)
        self.assertEqual(self.state['captureSnapshot']['name'], self.capture.name)

    def test_unknown_exit_never_turns_diagnostic_success_into_overall_pass(self):
        self.state['cleanupReceipt']['normalExitProven'] = False
        self.host.collect_results(self.state)
        self.assertTrue(self.state['analysis']['monitorCaptureAccepted'])
        self.assertEqual(self.state['outcome'], 'CAPTURE_PASSED_CLEANUP_OR_EXIT_PROVENANCE_INCOMPLETE')

    def test_legacy_consumption_marker_cannot_pass_paired_result_integrity(self):
        marker = {**self.fixture.marker, 'loaderSha256': m.LOADER_SHA256}
        (self.fixture.journal.directory / 'loader-child-consumed.json').write_bytes(m.json_bytes(marker))
        self.host.collect_results(self.state)
        self.assertFalse(self.state['bundleEvidenceIntegrityVerified'])
        self.assertEqual(self.state['outcome'], 'CAPTURE_PASSED_RESULT_RECEIPTS_INCOMPLETE')

    def test_legacy_capture_does_not_supply_a_paired_terminal_or_missing_analysis(self):
        self.capture.unlink()
        self.assertFalse(self.host.capture_terminal_seen(fixtures.PROCESS))
        self.host.collect_results(self.state)
        self.assertFalse(self.state['analysis']['monitorCaptureAccepted'])
        self.assertTrue(self.fixture.capture.exists())


if __name__ == '__main__':
    unittest.main()
