import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileStaleSourceLeaseForGrant,
} from './mission-orchestrator-worker.mjs';

const SOURCE_GRANT = Object.freeze({
  schemaVersion: 'stephanos.mission-worker-action-grant.v1',
  controllerId: 'durable-flywheel-controller',
  sourceRevision: 'a'.repeat(40),
  boundedActionCount: 1,
  missionId: 'goal-2048-pr-2048',
  missionRevision: 7,
  currentPhase: 'REPAIR_REQUIRED',
  actionId: 'action-2048-repair',
  actionKind: 'agent-handoff',
  adapter: 'chatgpt-github',
  operation: '',
  capacityRoute: 'CHATGPT_GITHUB',
  capacityReceiptId: 'capacity-2048',
  capacityProofRefs: ['proofs/capacity-2048.json'],
  workerId: 'chatgpt-github-builder',
  laneId: 'goal-2048-pr-2048',
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 2048,
  prNumber: 2048,
  branch: 'fix/battle-bridge-canonical-git-hardlink-v1',
  headSha: 'b'.repeat(40),
  mergeAuthority: false,
  leaseSeizureAllowed: false,
});

test('exact source grant invokes one bounded stale-lease reconciliation before publication', async () => {
  const calls = [];
  const result = await reconcileStaleSourceLeaseForGrant(SOURCE_GRANT, {
    now: new Date('2026-08-28T14:00:00.000Z'),
    sharedWorkspaceRoot: 'C:/workspace',
    repoRoot: 'C:/repo',
    reconcileStaleSourceMutationLeaseImpl: async (input, options) => {
      calls.push({ input, options });
      return {
        ok: true,
        reconciled: true,
        released: true,
        reason: 'STALE_SOURCE_LEASE_RECONCILED_AND_RELEASED',
        leaseSeizureAllowed: false,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.nowUtc, '2026-08-28T14:00:00.000Z');
  assert.equal(calls[0].options.root, 'C:/workspace');
  assert.equal(calls[0].options.repoRoot, 'C:/repo');
  assert.equal(result.ok, true);
  assert.equal(result.reconciled, true);
  assert.equal(result.leaseSeizureAllowed, false);
});

test('non-source grants never invoke stale-lease mutation', async () => {
  let called = false;
  const result = await reconcileStaleSourceLeaseForGrant({
    ...SOURCE_GRANT,
    adapter: 'openclaw-readonly',
  }, {
    reconcileStaleSourceMutationLeaseImpl: async () => {
      called = true;
      return { ok: true };
    },
  });

  assert.equal(called, false);
  assert.equal(result.ok, true);
  assert.equal(result.reconciled, false);
  assert.equal(result.reason, 'STALE_SOURCE_LEASE_RECONCILIATION_NOT_APPLICABLE');
  assert.equal(result.leaseSeizureAllowed, false);
});

test('reconciliation blocker is returned unchanged and cannot imply seizure', async () => {
  const result = await reconcileStaleSourceLeaseForGrant(SOURCE_GRANT, {
    now: new Date('2026-08-28T14:00:00.000Z'),
    reconcileStaleSourceMutationLeaseImpl: async () => ({
      ok: false,
      reconciled: false,
      released: false,
      reason: 'STALE_SOURCE_LEASE_NONTERMINAL_EXECUTION_PRESENT',
      leaseSeizureAllowed: false,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'STALE_SOURCE_LEASE_NONTERMINAL_EXECUTION_PRESENT');
  assert.equal(result.leaseSeizureAllowed, false);
});
