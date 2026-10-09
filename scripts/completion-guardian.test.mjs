import test from 'node:test';
import assert from 'node:assert/strict';

import { runCompletionGuardian } from './completion-guardian.mjs';

const NOW = '2026-10-08T18:30:00.000Z';
const mission = {
  missionId: 'critical-1645-elastic-goal',
  currentPhase: 'BLOCKED',
  blockers: ['ORPHANED_ACTIVE_MISSION: claim not active'],
  continuity: {
    parkingStatus: 'PARKED_BLOCKED',
    repairOwner: 'goal-building-agent',
    reason: 'ORPHANED_ACTIVE_MISSION: existing mission must be reconciled',
  },
  approval: { status: 'not-requested' },
  evidenceReceipts: [],
  nextAction: { type: 'REPAIR_REQUIRED' },
};
const backdrop = {
  observedAtUtc: NOW,
  testOnly: true,
  workspaceRoot: '/test/shared-workspace',
  repoRoot: '/test/repo',
  goals: [{ issueNumber: 1645, state: 'READY', mirrorBuildPickupAllowed: true }],
  missions: [mission],
  backlog: [{ issueNumbers: [1645], mission: { missionId: 'critical-1645-elastic-goal' } }],
};

test('preserves a proof-backed repair handoff if Windows denies the pinned status rename', async () => {
  const writes = [];
  const result = await runCompletionGuardian({
    ...backdrop,
    writeRecord: async (_root, segments, record) => {
      const name = segments.join('/');
      writes.push({ name, record });
      if (name === 'status/completion-guardian-current.json') {
        const error = new Error('EPERM: status file pinned by reader');
        error.code = 'EPERM';
        error.atomicRenameAttempts = 4;
        throw error;
      }
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });
  assert.deepEqual(writes.map((row) => row.name), [
    'proof/completion-guardian-current.json',
    'handoffs/completion-guardian-repair-current.json',
    'status/completion-guardian-current.json',
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.writes.proofWrite.ok, true);
  assert.equal(result.writes.handoffWrite.ok, true);
  assert.equal(result.writes.statusWrite.ok, false);
  assert.equal(result.writes.statusWrite.errorCode, 'EPERM');
  assert.equal(result.writes.statusWrite.atomicRenameAttempts, 4);
  const handoff = writes[1].record;
  assert.equal(handoff.existingMissionId, 'critical-1645-elastic-goal');
  assert.equal(handoff.duplicateMissionAllowed, false);
  assert.equal(handoff.duplicateBranchOrPrAllowed, false);
  assert.equal(handoff.mergeAuthority, false);
  assert.ok(handoff.proofRefs.includes('proof/completion-guardian-current.json'));
});

test('normal Guardian sweep writes the existing proof, handoff and status without duplicate machinery', async () => {
  const paths = [];
  const result = await runCompletionGuardian({
    ...backdrop,
    writeRecord: async (_root, segments) => {
      paths.push(segments.join('/'));
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(paths, [
    'proof/completion-guardian-current.json',
    'handoffs/completion-guardian-repair-current.json',
    'status/completion-guardian-current.json',
  ]);
  assert.equal(result.projection.duplicateSchedulerCreated, false);
});
