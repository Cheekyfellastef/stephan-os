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
      // Match the existing ACTIVE checkpoint lease for a genuine resumable handoff.
      resourceIds: ['pr:2003'],
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


test('missing, false or stringified custody guards cannot validate a continuation handoff', () => {
  const guards = [
    ['sameMissionRequired', 'same-mission-guard-missing'],
    ['sameCanonicalOwnerRequired', 'same-canonical-owner-guard-missing'],
    ['duplicateControllerForbidden', 'duplicate-controller-guard-missing'],
    ['duplicateMissionForbidden', 'duplicate-mission-guard-missing'],
    ['duplicateBranchOrPrForbidden', 'duplicate-branch-or-pr-guard-missing'],
  ];
  for (const [field, reason] of guards) {
    for (const untrustedValue of [undefined, false, 'true']) {
      const record = createGoalBuildingSharedWorkspaceContinuationRecord(input());
      const body = JSON.parse(record.body);
      if (untrustedValue === undefined) delete body.constraints[field];
      else body.constraints[field] = untrustedValue;
      const forged = { ...record, body: JSON.stringify(body) };
      const checked = validateGoalBuildingSharedWorkspaceContinuationRecord({ ...input(), record: forged });
      assert.equal(checked.valid, false, `${field}: ${String(untrustedValue)}`);
      assert.ok(checked.reasons.includes(reason), `${field}: ${String(untrustedValue)}`);
    }
  }
});

test('a complete original-owner handoff preserves all five strict custody guards', () => {
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(input());
  const body = JSON.parse(record.body);
  const checked = validateGoalBuildingSharedWorkspaceContinuationRecord({ ...input(), record });
  assert.equal(checked.valid, true);
  for (const field of ['sameMissionRequired', 'sameCanonicalOwnerRequired', 'duplicateControllerForbidden', 'duplicateMissionForbidden', 'duplicateBranchOrPrForbidden']) {
    assert.equal(body.constraints[field], true, field);
  }
});

test('handoff rejects forged continuation identities while preserving original valid record', () => {
  const canonical = input();
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(canonical);
  assert.equal(validateGoalBuildingSharedWorkspaceContinuationRecord({ ...canonical, record }).valid, true);
  for (const [field, altered, reason] of [
    ['missionId', 'foreign-mission', 'handoff-mission-identity-mismatch'],
    ['goalId', 'foreign-goal', 'handoff-goal-identity-mismatch'],
    ['canonicalOwnerId', 'foreign-owner', 'handoff-owner-identity-mismatch'],
    ['checkpointId', 'foreign-checkpoint', 'handoff-checkpoint-identity-mismatch'],
    ['protectedMainHead', '4'.repeat(40), 'handoff-main-identity-mismatch'],
    ['sourceHead', '5'.repeat(40), 'handoff-source-identity-mismatch'],
  ]) {
    const body = JSON.parse(record.body);
    body.continuation[field] = altered;
    const result = validateGoalBuildingSharedWorkspaceContinuationRecord({
      ...canonical, record: { ...record, body: JSON.stringify(body) },
    });
    assert.equal(result.valid, false, field);
    assert.ok(result.reasons.includes(reason), field);
  }
});

test('handoff cannot redirect canonical controller targets or receipt recipient', () => {
  const canonical = input();
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(canonical);
  for (const field of ['scheduler', 'continuityController', 'capacityRefill', 'goalBuildingAgent']) {
    const body = JSON.parse(record.body);
    body.canonicalTargets[field] = 'other-controller';
    const result = validateGoalBuildingSharedWorkspaceContinuationRecord({
      ...canonical, record: { ...record, body: JSON.stringify(body) },
    });
    assert.equal(result.valid, false, field);
    assert.ok(result.reasons.includes(`handoff-canonical-target-mismatch:${field}`), field);
  }
  const wrongRecipient = validateGoalBuildingSharedWorkspaceContinuationRecord({
    ...canonical, record: { ...record, toParticipantId: 'other-controller' },
  });
  assert.equal(wrongRecipient.valid, false);
  assert.ok(wrongRecipient.reasons.includes('handoff-receiver-identity-mismatch'));

  for (const altered of ['EXISTING_OTHER_CONTROLLER', '']) {
    const body = JSON.parse(record.body);
    body.continuation.continuationTarget = altered;
    const result = validateGoalBuildingSharedWorkspaceContinuationRecord({
      ...canonical, record: { ...record, body: JSON.stringify(body) },
    });
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes('handoff-continuity-controller-target-invalid'));
  }
});

test('original checkpoint branch PR lease and source bindings cannot be changed by the record', () => {
  const canonical = input();
  const record = createGoalBuildingSharedWorkspaceContinuationRecord(canonical);
  for (const [field, altered] of [
    ['branch', 'foreign-branch'],
    ['prNumber', 2999],
    ['repository', 'foreign/repo'],
    ['sourceTree', '7'.repeat(40)],
    ['leases', [{ leaseId: 'lease-foreign', resourceId: 'pr:2999', ownerId: 'foreign-owner', disposition: 'ACTIVE' }]],
    ['allowedPaths', ['foreign-source.mjs']],
  ]) {
    const body = JSON.parse(record.body);
    body.checkpoint[field] = altered;
    const result = validateGoalBuildingSharedWorkspaceContinuationRecord({
      ...canonical, record: { ...record, body: JSON.stringify(body) },
    });
    assert.equal(result.valid, false, field);
    assert.ok(result.reasons.includes(`handoff-original-checkpoint-mismatch:${field}`), field);
  }
  const unbound = validateGoalBuildingSharedWorkspaceContinuationRecord({ record });
  assert.equal(unbound.valid, false);
  assert.ok(unbound.reasons.includes('handoff-original-checkpoint-reference-unproven'));
});
