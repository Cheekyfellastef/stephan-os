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

test('reconstructed handoff refuses injected authority even when normalization would hide it', () => {
  const canonical = createGoalBuildResumeCheckpoint(checkpointInput()).authority;
  const current = { protectedMainHead: main, sourceHead: head, canonicalOwnerId: 'goal-building-agent' };
  const cases = [
    { label: 'merge enabled', authority: { ...canonical, protectedMerge: true }, reason: 'checkpoint-supplied-authority-mismatch:protectedMerge' },
    { label: 'runtime enabled', authority: { ...canonical, runtimeMutation: true }, reason: 'checkpoint-supplied-authority-mismatch:runtimeMutation' },
    { label: 'source scope downgraded', authority: { ...canonical, sourceBuildWithinExistingOwner: false }, reason: 'checkpoint-supplied-authority-mismatch:sourceBuildWithinExistingOwner' },
    { label: 'partial policy', authority: { protectedMerge: false }, reason: 'checkpoint-supplied-authority-mismatch:sourceBuildWithinExistingOwner' },
    { label: 'unknown authority', authority: { ...canonical, arbitraryShell: true }, reason: 'checkpoint-supplied-authority-unknown-field' },
    { label: 'null authority', authority: null, reason: 'checkpoint-supplied-authority-invalid' },
    { label: 'array authority', authority: [], reason: 'checkpoint-supplied-authority-invalid' },
    { label: 'explicit undefined authority', authority: undefined, reason: 'checkpoint-supplied-authority-invalid' },
    { label: 'inherited policy without own fields', authority: Object.create(canonical), reason: 'checkpoint-supplied-authority-mismatch:sourceBuildWithinExistingOwner' },
    { label: 'symbol extra authority field', authority: { ...canonical, [Symbol('extra')]: true }, reason: 'checkpoint-supplied-authority-unknown-field' },
  ];
  for (const { label, authority, reason } of cases) {
    const result = reconstructGoalBuildHandoff({ checkpoint: checkpointInput({ authority }), current });
    assert.equal(result.evaluation.state, GOAL_BUILDING_RESUME_STATES.SAFE_HOLD, label);
    assert.equal(result.evaluation.resumable, false, label);
    assert.ok(result.evaluation.reasons.includes(reason), label);
    assert.equal(result.checkpoint.authority.protectedMerge, false, label);
    assert.equal(result.checkpoint.authority.runtimeMutation, false, label);
  }
  const legitimate = reconstructGoalBuildHandoff({ checkpoint: checkpointInput({ authority: canonical }), current });
  assert.equal(legitimate.evaluation.state, GOAL_BUILDING_RESUME_STATES.RESUMABLE);
  assert.deepEqual(legitimate.checkpoint.authorityInputProblems, []);
});

test('explicitly malformed operator gate never becomes a resumable handoff', () => {
  const current = { protectedMainHead: main, sourceHead: head, canonicalOwnerId: 'goal-building-agent' };
  const malformed = [
    ['string true', 'true'],
    ['numeric true', 1],
    ['numeric false', 0],
    ['null', null],
    ['array', []],
    ['object', {}],
    ['explicit undefined', undefined],
  ];
  for (const [label, operatorGate] of malformed) {
    const result = reconstructGoalBuildHandoff({ checkpoint: checkpointInput({ operatorGate }), current });
    assert.equal(result.evaluation.state, GOAL_BUILDING_RESUME_STATES.SAFE_HOLD, label);
    assert.equal(result.evaluation.resumable, false, label);
    assert.ok(result.evaluation.reasons.includes('checkpoint-supplied-operator-gate-invalid'), label);
    assert.equal(result.checkpoint.operatorGate, false, label);
  }
  const omittedCheckpoint = checkpointInput();
  delete omittedCheckpoint.operatorGate;
  assert.equal(reconstructGoalBuildHandoff({ checkpoint: omittedCheckpoint, current }).evaluation.state, GOAL_BUILDING_RESUME_STATES.RESUMABLE);
  assert.equal(reconstructGoalBuildHandoff({ checkpoint: checkpointInput({ operatorGate: false }), current }).evaluation.state, GOAL_BUILDING_RESUME_STATES.RESUMABLE);
  assert.equal(reconstructGoalBuildHandoff({ checkpoint: checkpointInput({ operatorGate: true }), current }).evaluation.state, GOAL_BUILDING_RESUME_STATES.APPROVAL_PARKED);
});

test('direct persisted checkpoint evaluation rejects missing positive authority and malformed gate', () => {
  const valid = createGoalBuildResumeCheckpoint(checkpointInput());
  const current = { protectedMainHead: main, sourceHead: head, canonicalOwnerId: 'goal-building-agent' };
  assert.equal(evaluateGoalBuildResumeCheckpoint(valid, current).state, GOAL_BUILDING_RESUME_STATES.RESUMABLE);
  for (const invalidValue of [false, null, undefined, 'true']) {
    const forgedAuthority = { ...valid.authority, sourceBuildWithinExistingOwner: invalidValue };
    const result = evaluateGoalBuildResumeCheckpoint({ ...valid, authority: forgedAuthority }, current);
    assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.SAFE_HOLD, String(invalidValue));
    assert.equal(result.resumable, false);
    assert.ok(result.reasons.includes('authority-source-scope-unproven'));
  }
  for (const invalidGate of ['true', 1, null, undefined]) {
    const result = evaluateGoalBuildResumeCheckpoint({ ...valid, operatorGate: invalidGate }, current);
    assert.equal(result.state, GOAL_BUILDING_RESUME_STATES.SAFE_HOLD, String(invalidGate));
    assert.ok(result.reasons.includes('operator-gate-invalid'));
  }
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
