import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILDING_RESUME_STATES,
  createGoalBuildResumeCheckpoint,
  evaluateGoalBuildResumeCheckpoint,
  reconstructGoalBuildHandoff,
} from './goalBuildingAgentV1.resume.mjs';

const main = '1'.repeat(40);
const head = '2'.repeat(40);
const tree = '3'.repeat(40);

function checkpointInput(overrides = {}) {
  return {
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
    allowedPaths: ['shared/agents/goalBuildingAgentV1.resume.mjs'],
    leases: [{ leaseId: 'lease-resume-1', resourceId: 'pr:2003', ownerId: 'goal-building-agent', disposition: 'ACTIVE' }],
    lastMaterialReceiptId: 'receipt-resume-1',
    lastMaterialReceiptHead: head,
    blockers: [],
    operatorGate: false,
    nextLegalAction: 'Continue the same bounded implementation and run focused tests.',
    createdAtUtc: '2026-09-04T08:50:00.000Z',
    ...overrides,
  };
}

test('another chat can reconstruct and resume the same canonical mission', () => {
  const result = reconstructGoalBuildHandoff({
    checkpoint: checkpointInput(),
    current: {
      protectedMainHead: main,
      sourceHead: head,
      canonicalOwnerId: 'goal-building-agent',
    },
  });

  assert.equal(result.evaluation.state, GOAL_BUILDING_RESUME_STATES.RESUMABLE);
  assert.equal(result.evaluation.resumable, true);
  assert.equal(result.handoff.sameMissionRequired, true);
  assert.equal(result.handoff.duplicateBranchOrPrForbidden, true);
  assert.equal(result.handoff.nextLegalAction, checkpointInput().nextLegalAction);
  assert.equal(result.checkpoint.authority.protectedMerge, false);
  assert.equal(result.checkpoint.authority.runtimeMutation, false);
});

test('protected-main movement requires reproof instead of blind continuation', () => {
  const checkpoint = createGoalBuildResumeCheckpoint(checkpointInput());
  const result = evaluateGoalBuildResumeCheckpoint(checkpoint, {
    protectedMainHead: '4'.repeat(40),
    sourceHead: head,
    canonicalOwnerId: 'goal-building-agent',
  });

  assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.REPROVE_REQUIRED);
  assert.equal(result.resumable, false);
  assert.equal(result.mustReprove, true);
  assert.ok(result.reasons.includes('protected-main-moved-reprove-required'));
});

test('source-head movement requires reproof so stale chat state cannot mutate', () => {
  const checkpoint = createGoalBuildResumeCheckpoint(checkpointInput());
  const result = evaluateGoalBuildResumeCheckpoint(checkpoint, {
    protectedMainHead: main,
    sourceHead: '5'.repeat(40),
    canonicalOwnerId: 'goal-building-agent',
  });

  assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.REPROVE_REQUIRED);
  assert.ok(result.reasons.includes('source-head-moved-reprove-required'));
});

test('a competing mutation owner fails closed instead of creating a duplicate lane', () => {
  const checkpoint = createGoalBuildResumeCheckpoint(checkpointInput());
  const result = evaluateGoalBuildResumeCheckpoint(checkpoint, {
    protectedMainHead: main,
    sourceHead: head,
    canonicalOwnerId: 'goal-building-agent',
    competingOwnerId: 'other-writer',
  });

  assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.SAFE_HOLD);
  assert.equal(result.resumable, false);
  assert.ok(result.reasons.includes('competing-mutation-owner'));
});

test('approval-gated work parks without granting approval and leaves independent capacity continuable', () => {
  const result = reconstructGoalBuildHandoff({
    checkpoint: checkpointInput({ operatorGate: true, phase: 'READY_FOR_OPERATOR_APPROVAL' }),
    current: { protectedMainHead: main, sourceHead: head, canonicalOwnerId: 'goal-building-agent' },
  });

  assert.equal(result.evaluation.state, GOAL_BUILDING_RESUME_STATES.APPROVAL_PARKED);
  assert.equal(result.evaluation.operatorGate, true);
  assert.equal(result.checkpoint.authority.readyTransition, false);
  assert.equal(result.checkpoint.authority.protectedMerge, false);
  assert.equal(result.handoff.continueIndependentCapacityWhileParked, true);
});

test('owned blocker is durable but does not masquerade as active building', () => {
  const checkpoint = createGoalBuildResumeCheckpoint(checkpointInput({
    blockers: ['provider route unavailable; retry through already-qualified GitHub path'],
  }));
  const result = evaluateGoalBuildResumeCheckpoint(checkpoint, {
    protectedMainHead: main,
    sourceHead: head,
    canonicalOwnerId: 'goal-building-agent',
  });

  assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.BLOCKED_WITH_OWNER);
  assert.equal(result.resumable, false);
  assert.deepEqual(result.reasons, []);
});

test('malformed or authority-widened checkpoint fails closed', () => {
  const checkpoint = createGoalBuildResumeCheckpoint(checkpointInput({ nextLegalAction: '' }));
  const forged = {
    ...checkpoint,
    authority: { ...checkpoint.authority, protectedMerge: true },
  };
  const result = evaluateGoalBuildResumeCheckpoint(forged, {
    protectedMainHead: main,
    sourceHead: head,
    canonicalOwnerId: 'goal-building-agent',
  });

  assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.SAFE_HOLD);
  assert.ok(result.reasons.includes('next-legal-action-missing'));
  assert.ok(result.reasons.includes('authority-widened:protectedMerge'));
});

test('a saved checkpoint cannot self-prove live protected main, source, or canonical owner', () => {
  const checkpoint = createGoalBuildResumeCheckpoint(checkpointInput());
  const cases = [
    { label: 'all current observations omitted', current: {}, reasons: [
      'current-protected-main-head-unproven',
      'current-source-head-unproven',
      'current-canonical-owner-unproven',
    ] },
    { label: 'protected main omitted', current: { sourceHead: head, canonicalOwnerId: 'goal-building-agent' }, reasons: ['current-protected-main-head-unproven'] },
    { label: 'source head omitted', current: { protectedMainHead: main, canonicalOwnerId: 'goal-building-agent' }, reasons: ['current-source-head-unproven'] },
    { label: 'canonical owner omitted', current: { protectedMainHead: main, sourceHead: head }, reasons: ['current-canonical-owner-unproven'] },
    { label: 'malformed current main', current: { protectedMainHead: 'not-a-sha', sourceHead: head, canonicalOwnerId: 'goal-building-agent' }, reasons: ['current-protected-main-head-unproven'] },
    { label: 'malformed current source', current: { protectedMainHead: main, sourceHead: 'not-a-sha', canonicalOwnerId: 'goal-building-agent' }, reasons: ['current-source-head-unproven'] },
  ];
  for (const { label, current, reasons } of cases) {
    const result = evaluateGoalBuildResumeCheckpoint(checkpoint, current);
    assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.SAFE_HOLD, label);
    assert.equal(result.resumable, false, label);
    assert.equal(result.mustReprove, false, label);
    for (const reason of reasons) assert.ok(result.reasons.includes(reason), label + ': ' + reason);
  }
});

test('missing live observations cannot wake existing continuity controller or refill', async () => {
  const { projectStephanosGoalContinuation } = await import('./goalBuildingAgentV1.continuation.mjs');
  const result = projectStephanosGoalContinuation({
    checkpoint: checkpointInput(),
    current: {},
    schedulerCandidate: {
      goalId: '2002',
      missionId: 'mission-goal-building-continuity',
      canonicalOwnerId: 'goal-building-agent',
      schedulerEligible: true,
      qualifiedProviderAvailable: true,
      operatorGate: false,
      resourceIds: ['pr:2003'],
    },
  });
  assert.equal(result.state, 'SAFE_HOLD');
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, false);
  assert.equal(result.protectedMergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});
