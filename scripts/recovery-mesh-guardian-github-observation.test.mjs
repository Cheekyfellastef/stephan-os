import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRecoveryGuardianGithubObservation,
  runRecoveryGuardianGithubObservation,
} from './recovery-mesh-guardian-github-observation.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('guardian broker helper allowlists only canonical main and exact SHA compare reads', () => {
  const main = resolveRecoveryGuardianGithubObservation(['text', 'api', 'repos/Cheekyfellastef/stephan-os/branches/main', '--jq', '.commit.sha']);
  assert.equal(main.ok, true);
  assert.equal(main.key, 'recovery-guardian-main-branch');

  const compare = resolveRecoveryGuardianGithubObservation(['json', 'api', `repos/Cheekyfellastef/stephan-os/compare/${A}...${B}`]);
  assert.equal(compare.ok, true);
  assert.match(compare.key, /recovery-guardian-compare/);

  for (const argv of [
    ['json', 'api', 'repos/other/repo/branches/main'],
    ['text', 'api', 'repos/Cheekyfellastef/stephan-os/issues/1'],
    ['json', 'api', 'repos/Cheekyfellastef/stephan-os/compare/main...other'],
  ]) {
    assert.equal(resolveRecoveryGuardianGithubObservation(argv).ok, false);
  }
});

test('guardian broker helper projects main SHA and compare JSON from shared observation', () => {
  const readObservation = ({ endpoint, ghCommand }) => {
    assert.equal(ghCommand, 'C:\\Program Files\\GitHub CLI\\gh.exe');
    return endpoint.endsWith('/branches/main')
      ? { ok: true, source: 'SHARED_CACHE', ageMs: 1_000, payload: { commit: { sha: A } } }
      : { ok: true, source: 'SHARED_CACHE', ageMs: 1_000, payload: { status: 'ahead', ahead_by: 1, behind_by: 0 } };
  };

  const main = runRecoveryGuardianGithubObservation({
    argv: ['text', 'api', 'repos/Cheekyfellastef/stephan-os/branches/main', '--jq', '.commit.sha'],
    readObservation,
  });
  assert.equal(main.ok, true);
  assert.equal(main.output, A);

  const compare = runRecoveryGuardianGithubObservation({
    argv: ['json', 'api', `repos/Cheekyfellastef/stephan-os/compare/${A}...${B}`],
    readObservation,
  });
  assert.equal(compare.ok, true);
  assert.deepEqual(JSON.parse(compare.output), { status: 'ahead', ahead_by: 1, behind_by: 0 });
});


test('guardian main-head authority fails closed on stale, unproven and expired broker evidence', () => {
  const argv = ['text', 'api', 'repos/Cheekyfellastef/stephan-os/branches/main', '--jq', '.commit.sha'];
  const invalid = [
    ['SHARED_CACHE_STALE_AFTER_UPSTREAM_FAILURE', 91_000],
    ['SHARED_CACHE_STALE_WHILE_REFRESHING', 91_000],
    ['SHARED_CACHE_STALE_AFTER_UPSTREAM_FAILURE', 1_000],
    ['SHARED_CACHE', 90_001],
    ['SHARED_CACHE', -1],
    ['SHARED_CACHE', undefined],
    ['PATH_TAMPERED', 0],
  ];
  for (const [source, ageMs] of invalid) {
    const result = runRecoveryGuardianGithubObservation({
      argv,
      readObservation: ({ ghCommand }) => {
        assert.equal(ghCommand, 'C:\\Program Files\\GitHub CLI\\gh.exe');
        return { ok: true, source, ageMs, payload: { commit: { sha: A } } };
      },
    });
    assert.equal(result.ok, false, source);
    assert.equal(result.reason, 'GUARDIAN_GITHUB_AUTHORITY_SOURCE_NOT_FRESH', source);
  }
  const fresh = runRecoveryGuardianGithubObservation({
    argv,
    readObservation: ({ ghCommand }) => {
      assert.equal(ghCommand, 'C:\\Program Files\\GitHub CLI\\gh.exe');
      return { ok: true, source: 'UPSTREAM_REFRESH', ageMs: 0, payload: { commit: { sha: A } } };
    },
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.output, A);
});

test('guardian rejects stale compare evidence even for immutable exact-SHA comparisons', () => {
  const result = runRecoveryGuardianGithubObservation({
    argv: ['json', 'api', `repos/Cheekyfellastef/stephan-os/compare/${A}...${B}`],
    readObservation: () => ({ ok: true, source: 'SHARED_CACHE_STALE_AFTER_UPSTREAM_FAILURE', ageMs: 86_400_000, payload: { status: 'ahead' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'GUARDIAN_GITHUB_AUTHORITY_SOURCE_NOT_FRESH');
});
