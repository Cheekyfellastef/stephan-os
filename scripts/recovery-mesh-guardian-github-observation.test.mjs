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
  const readObservation = ({ endpoint }) => endpoint.endsWith('/branches/main')
    ? { ok: true, source: 'SHARED_CACHE', payload: { commit: { sha: A } } }
    : { ok: true, source: 'SHARED_CACHE', payload: { status: 'ahead', ahead_by: 1, behind_by: 0 } };

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
