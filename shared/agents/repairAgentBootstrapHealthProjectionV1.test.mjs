import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRepairAgentBootstrapHealthProjectionV1,
} from './repairAgentBootstrapHealthProjectionV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-09T09:00:00.000Z';

function healthy() {
  return { state: 'HEALTHY', observedAtUtc: NOW };
}

test('all three bootstrap surfaces healthy remains no-op eligible', () => {
  const result = evaluateRepairAgentBootstrapHealthProjectionV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    githubCommandMailbox: healthy(),
    recoveryMesh: healthy(),
    recoveryLifeboat: healthy(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_ALL_REQUIRED_HEALTHY');
  assert.equal(result.allRequiredHealthy, true);
  assert.equal(result.repairCandidates.length, 0);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
});

test('healthy mailbox cannot mask stale Recovery Mesh', () => {
  const result = evaluateRepairAgentBootstrapHealthProjectionV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    githubCommandMailbox: healthy(),
    recoveryMesh: { state: 'HEALTHY', observedAtUtc: '2026-09-09T08:00:00.000Z' },
    recoveryLifeboat: healthy(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIR_REQUIRED');
  assert.equal(result.allRequiredHealthy, false);
  assert.deepEqual(result.repairCandidates.map((entry) => entry.id), ['recoveryMesh']);
  assert.equal(result.repairCandidates[0].state, 'STALE');
  assert.equal(result.repairCandidates[0].repairRoute, 'CONTROL_PLANE_SELF_REPAIR');
});

test('missing lifeboat evidence requires repair rather than inferring health', () => {
  const result = evaluateRepairAgentBootstrapHealthProjectionV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    githubCommandMailbox: healthy(),
    recoveryMesh: healthy(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIR_REQUIRED');
  assert.deepEqual(result.repairCandidates.map((entry) => entry.id), ['recoveryLifeboat']);
  assert.equal(result.repairCandidates[0].state, 'MISSING');
});
