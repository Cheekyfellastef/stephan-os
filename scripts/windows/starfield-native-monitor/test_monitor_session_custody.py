"""Cross-attempt exclusion, predecessor continuity and typed custody evidence."""
import os
from pathlib import Path
import tempfile
import unittest

import test_splash_monitor_bridge as fixtures


class SuccessorCustodyTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.CustodyTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.core, self.helper = self.fixture.core, self.fixture.helper
        self.model = fixtures.b.custody_model()
        self.hashes = fixtures.b.REVIEWED_RUNNER_HASHES
        self.owner = self.core.json_bytes({'owner': 'e' * 32, 'pid': os.getpid()})

    def host_factory(self):
        fixture = self.fixture

        class Host:
            def games(self):
                return fixture.host_factory().games()

            def proxy_state(self):
                return 'restored'

        return Host()

    def reserve(self):
        self.fixture.completed_records()
        self.fixture.paths['outerLock'].write_bytes(self.owner)

    def admit(self):
        return self.model.admit_successor(self.core, self.helper, self.owner,
            runner_hashes=self.hashes, host_factory=self.host_factory)

    def test_no_custody_is_not_a_successor_predecessor(self):
        self.assertTrue(self.fixture.observe()['allowed'])
        self.fixture.write('outerLock', self.core.strict_json(self.owner))
        with self.assertRaisesRegex(self.model.CustodyError, 'PREDECESSOR_REQUIRED'):
            self.admit()

    def test_successor_requires_exact_current_common_owner(self):
        self.reserve()
        for change in ({'owner': 'f' * 32}, {'pid': os.getpid() + 1}, {'pid': True}):
            with self.subTest(change=change):
                invalid = {**self.core.strict_json(self.owner), **change}
                with self.assertRaisesRegex(self.model.CustodyError, 'COMMON_LOCK_NOT_OWNED'):
                    self.model.admit_successor(self.core, self.helper, self.core.json_bytes(invalid),
                        runner_hashes=self.hashes, host_factory=self.host_factory)

    def test_unknown_normal_exit_is_preserved_while_current_exclusion_is_proven(self):
        self.reserve()
        path = self.fixture.paths['starter']
        starter = self.core.strict_json(path.read_bytes())
        starter['normalExitProven'] = False
        path.write_bytes(self.core.json_bytes(starter))
        before = {str(p): p.read_bytes() for p in Path(self.fixture.temporary.name).rglob('*') if p.is_file()}
        proof = self.admit()
        self.assertIs(proof['historicalNormalExitUpgraded'], False)
        self.assertEqual(proof['identity'], self.model.predecessor_identity(
            self.model.custody_snapshot(self.core, self.helper)))
        self.assertEqual(before, {str(p): p.read_bytes() for p in Path(self.fixture.temporary.name).rglob('*') if p.is_file()})

    def test_each_existing_successor_or_shared_starter_hold_denies_admission(self):
        self.reserve()
        for key in ('starterLock', 'heldProxy', 'pairedStarter', 'pairedOuter', 'pairedStockMarker', 'pairedLoadMarker'):
            with self.subTest(key=key):
                self.fixture.write(key, {})
                with self.assertRaises(self.model.CustodyError):
                    self.admit()
                self.fixture.paths[key].unlink()
                directory = self.fixture.paths['pairedDirectory']
                if directory.exists():
                    directory.rmdir()
        self.fixture.paths['pairedDirectory'].mkdir()
        with self.assertRaisesRegex(self.model.CustodyError, 'ALREADY_PRESENT'):
            self.admit()

    def test_active_game_and_snapshot_race_deny_successor(self):
        self.reserve()
        self.fixture.games = [dict(fixtures.fixtures.PROCESS)]
        with self.assertRaisesRegex(self.model.CustodyError, 'CURRENT_EXCLUSION'):
            self.admit()
        self.fixture.games = []
        self.fixture.on_games = lambda: self.fixture.paths['outer'].write_bytes(b'{}')
        with self.assertRaisesRegex(self.model.CustodyError, 'CHANGED_DURING'):
            self.admit()

    def test_uncertain_predecessor_is_not_released_by_a_new_namespace(self):
        self.reserve()
        outer = self.core.strict_json(self.fixture.paths['outer'].read_bytes())
        outer['activeChild'] = {'role': 'load', 'state': 'UNRESOLVED'}
        self.fixture.write('outer', outer)
        with self.assertRaisesRegex(self.model.CustodyError, 'CLEANUP_UNPROVEN'):
            self.admit()

    def test_provider_custody_holds_orphaned_successor_directory_and_records(self):
        self.fixture.completed_records()
        for key in ('pairedStarter', 'pairedStockMarker', 'pairedLoadMarker'):
            with self.subTest(key=key):
                self.fixture.write(key, {})
                with self.assertRaises(fixtures.b.ProtocolError):
                    self.fixture.observe()
                self.fixture.paths[key].unlink()
        self.fixture.paths['pairedDirectory'].mkdir(exist_ok=True)
        with self.assertRaisesRegex(fixtures.b.ProtocolError, 'ORPHANED'):
            self.fixture.observe()

    def paired_completed(self):
        self.reserve()
        proof = self.admit()
        self.fixture.paths['outerLock'].unlink()
        outer = self.core.strict_json(self.fixture.paths['outer'].read_bytes())
        starter = self.core.strict_json(self.fixture.paths['starter'].read_bytes())
        for record in (outer, starter):
            record.update(sessionProfile=self.model.PAIRED_PROFILE,
                          reviewedDllSha256=self.model.PAIRED_DLL_SHA256)
        outer.update(runId='c' * 32, predecessor=proof, starterSessionId='d' * 32)
        outer['cleanupReceipt']['sessionId'] = 'd' * 32
        starter['sessionId'] = 'd' * 32
        self.fixture.write('pairedOuter', outer)
        self.fixture.write('pairedStarter', starter)
        return outer, starter

    def test_both_terminal_attempts_release_only_with_exact_predecessor_binding(self):
        outer, _starter = self.paired_completed()
        self.assertTrue(self.fixture.observe()['allowed'])
        outer['predecessor']['identity']['outerSha256'] = '0' * 64
        self.fixture.write('pairedOuter', outer)
        with self.assertRaisesRegex(fixtures.b.ProtocolError, 'PREDECESSOR_IDENTITY_CHANGED'):
            self.fixture.observe()

    def test_paired_profile_cannot_borrow_legacy_dll_or_missing_profile(self):
        outer, _starter = self.paired_completed()
        for change in ({'reviewedDllSha256': self.core.DLL_SHA256}, {'sessionProfile': None},
                       {'activeChild': {}}, {'cleanupComplete': 1}):
            with self.subTest(change=change):
                self.fixture.write('pairedOuter', {**outer, **change})
                with self.assertRaises(fixtures.b.ProtocolError):
                    self.fixture.observe()

    def test_legacy_markers_cannot_be_substituted_for_paired_loader(self):
        outer, starter = self.paired_completed()
        outer['captureAttemptToken'] = 'a' * 32
        self.fixture.write('pairedOuter', outer)
        marker = {'runId': outer['runId'], 'starterSessionId': starter['sessionId'],
                  'pid': starter['process']['pid'], 'createdFileTime': starter['process']['createdFileTime'],
                  'attemptToken': outer['captureAttemptToken'], 'reviewedDllSha256': self.model.PAIRED_DLL_SHA256,
                  'loaderSha256': self.model.PAIRED_LOADER_SHA256}
        self.fixture.write('pairedLoadMarker', marker)
        self.assertTrue(self.fixture.observe()['allowed'])
        marker['loaderSha256'] = self.core.LOADER_SHA256
        self.fixture.write('pairedLoadMarker', marker)
        with self.assertRaisesRegex(fixtures.b.ProtocolError, 'LOAD_CUSTODY_MISMATCH'):
            self.fixture.observe()

    def test_predecessor_cannot_disappear_after_successor_completion(self):
        self.paired_completed()
        self.fixture.paths['outer'].unlink()
        with self.assertRaises(fixtures.b.ProtocolError):
            self.fixture.observe()

    def test_profile_bool_aliases_fail_closed(self):
        outer, starter, restore = self.fixture.completed_records()
        for alias in (0, 1, None, '', [], {}):
            with self.subTest(alias=alias), self.assertRaises(self.model.CustodyError):
                self.model.validate_released_custody(self.core, self.helper, outer, starter, restore,
                    paired=alias, runner_hashes=self.hashes)


@unittest.skipUnless(os.name == 'nt', 'Windows namespace retention fixture')
class NamespacePinTests(unittest.TestCase):
    def test_directory_rename_is_excluded_while_child_creation_remains_possible(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent = root / 'parent'
            package = parent / 'package'
            package.mkdir(parents=True)
            pins = fixtures.m.ReadPins()
            try:
                pins.add_namespaces([package])
                member = package / 'reviewed-input.bin'
                member.write_bytes(b'known reviewed input')
                pins.add([member])
                journal = package / 'session.json'
                temporary_journal = package / 'session.tmp'
                journal.write_bytes(b'old journal')
                temporary_journal.write_bytes(b'new journal')
                os.replace(temporary_journal, journal)
                self.assertEqual(journal.read_bytes(), b'new journal')
                lock = package / 'operator.lock'
                lock.write_bytes(b'owned token')
                lock.unlink()
                self.assertFalse(lock.exists())
                with self.assertRaises(OSError):
                    package.rename(parent / 'substituted-package')
                with self.assertRaises(OSError):
                    parent.rename(root / 'substituted-parent')
                with self.assertRaises(OSError):
                    member.write_bytes(b'changed input')
                self.assertEqual(member.read_bytes(), b'known reviewed input')
            finally:
                pins.close()
            package.rename(parent / 'released-package')

    def test_failed_namespace_open_does_not_invent_a_pin(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'regular-file'
            path.write_bytes(b'not a directory')
            pins = fixtures.m.ReadPins()
            try:
                with self.assertRaises(fixtures.m.Blocked):
                    pins.add_namespaces([path])
                self.assertNotIn(str(path), pins.handles)
            finally:
                pins.close()


if __name__ == '__main__':
    unittest.main()
