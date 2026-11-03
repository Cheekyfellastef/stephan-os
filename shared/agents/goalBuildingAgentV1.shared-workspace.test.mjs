import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGoalBuildingSharedWorkspaceContinuationRecord,
  validateGoalBuildingSharedWorkspaceContinuationRecord,
} from './goalBuildingAgentV1.shared-workspace.mjs';

const main = '1'.repeat(40);
const head = '2'.repeat(40);
const tree = '3'.repeat(40);

function input(overrides = {}) {
  return {
    timestampUtc: '2026-09-04T09:10:00.000Z',
    proofRefs: ['evidence/receipts/goal-build-resume-1.json'],
    checkpoint: {
      checkpointId: 'resume-2002-1',
      missionId: 'mission-goal-building-continuity',
      goalId: '2002',
      canonicalOwnerId: 'goal-building-agent',
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 2003,
      branch: 'agent/goal-building-agent-v1',
      protectedMainHead: main,
      sourceHead: head,
      sourceTree: tree,
      phase: 'IMPLEMENT',
      allowedPaths: ['shared/agents/goalBuildingAgentV1.shared-workspace.mjs'],
      leases: [{ leaseId: 'lease-resume-1', resourceId: 'pr:2003', ownerId: 'goal-building-agent', disposition: 'ACTIVE' }],
      lastMaterialReceiptId: 'receipt-resume-1',
      lastMaterialReceiptHead: head,
      blockers: [],
      operatorGate: false,
      nextLegalAction: 'Continue the same mission through the existing continuity controller.',
      createdAtUtc: '2026-09-04T09:09:00.000Z',
    },
    current: {
      protectedMainHead: main,
      sourceHead: head,
      canonicalOwnerId: 'goal-building-agent',
    },
    schedulerCandidate: {
      goalId: '2002',
      missionId: 'mission-goal-building-continuity',
      canonicalOwnerId: 'goal-building-agent',
      schedulerEligible: true,
      qualifiedProviderAvailable: true,
      operatorGate: false,
    },
    validationOptions: { nowMs: Date.parse('2026-09-04T09:10:10.000Z') },
    ...overrides,
  };
}

test('publishes the exact resumable mission to the existing mission orchestrator', () => {
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(input());
  const checked = validateGoalBuildingSharedWorkspaceContinuationRecord({ ...input(), record });
  const body = JSON.parse(record.body);

  assert.equal(checked.valid, true);
  assert.equal(record.kind, 'stephanos.shared_workspace.record.handoff');
  assert.equal(record.participantId, 'goal-building-agent');
  assert.equal(record.fromParticipantId, 'goal-building-agent');
  assert.equal(record.toParticipantId, 'mission-orchestrator');
  assert.equal(body.checkpoint.missionId, 'mission-goal-building-continuity');
  assert.equal(body.continuation.mayRequestExistingControllerContinuation, true);
  assert.equal(body.continuation.continuationTarget, 'EXISTING_1557_CONTINUITY_CONTROLLER');
  assert.equal(body.constraints.duplicateControllerForbidden, true);
  assert.equal(body.constraints.protectedMergeAuthority, false);
  assert.equal(body.constraints.runtimeMutationAuthority, false);
});

test('approval parked goal keeps its durable identity and points only at existing refill machinery', () => {
  const value = input();
  value.checkpoint = { ...value.checkpoint, operatorGate: true, phase: 'READY_FOR_OPERATOR_APPROVAL' };
  value.schedulerCandidate = { ...value.schedulerCandidate, schedulerEligible: false, qualifiedProviderAvailable: false, operatorGate: true };
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(value);
  const body = JSON.parse(record.body);

  assert.equal(body.continuation.mayRequestExistingControllerContinuation, false);
  assert.equal(body.continuation.mayRequestCapacityRefill, true);
  assert.equal(body.continuation.refillTarget, 'EXISTING_1947_CAPACITY_REFILL');
  assert.equal(body.checkpoint.goalId, '2002');
  assert.equal(body.constraints.duplicateMissionForbidden, true);
});

test('main drift is published as reproof-required and never as autonomous continuation', () => {
  const value = input({
    current: {
      protectedMainHead: '4'.repeat(40),
      sourceHead: head,
      canonicalOwnerId: 'goal-building-agent',
    },
  });
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(value);
  const body = JSON.parse(record.body);

  assert.equal(body.continuation.state, 'REPROVE_BEFORE_CONTINUE');
  assert.equal(body.continuation.mayRequestExistingControllerContinuation, false);
  assert.equal(body.continuation.protectedMergeAuthority, false);
});

test('missing proof refs fail Shared Workspace validation closed', () => {
  const value = input({ proofRefs: [] });
  const checked = validateGoalBuildingSharedWorkspaceContinuationRecord(value);

  assert.equal(checked.valid, false);
  assert.ok(checked.reasons.includes('missing-proofRefs'));
});

test('forged consequential authority in the handoff body is rejected', () => {
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(input());
  const body = JSON.parse(record.body);
  body.constraints.runtimeMutationAuthority = true;
  const forged = { ...record, body: JSON.stringify(body) };
  const checked = validateGoalBuildingSharedWorkspaceContinuationRecord({ ...input(), record: forged });

  assert.equal(checked.valid, false);
  assert.ok(checked.reasons.includes('runtime-mutation-authority-widened'));
});
