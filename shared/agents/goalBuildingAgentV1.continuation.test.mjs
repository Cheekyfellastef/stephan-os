import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILDING_CONTINUATION_STATES,
  projectStephanosGoalContinuation,
} from './goalBuildingAgentV1.continuation.mjs';

const main = '1'.repeat(40);
const head = '2'.repeat(40);
const tree = '3'.repeat(40);

function checkpoint(overrides = {}) {
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
    allowedPaths: ['shared/agents/goalBuildingAgentV1.continuation.mjs'],
    leases: [{ leaseId: 'lease-continuation-1', resourceId: 'pr:2003', ownerId: 'goal-building-agent', disposition: 'ACTIVE' }],
    lastMaterialReceiptId: 'receipt-continuation-1',
    lastMaterialReceiptHead: head,
    blockers: [],
    operatorGate: false,
    nextLegalAction: 'Continue through the existing continuity controller.',
    createdAtUtc: '2026-09-04T09:10:00.000Z',
    ...overrides,
  };
}

function current(overrides = {}) {
  return {
    protectedMainHead: main,
    sourceHead: head,
    canonicalOwnerId: 'goal-building-agent',
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    goalId: '2002',
    missionId: 'mission-goal-building-continuity',
    canonicalOwnerId: 'goal-building-agent',
    schedulerEligible: true,
    qualifiedProviderAvailable: true,
    operatorGate: false,
    nextLegalAction: 'Continue through the existing continuity controller.',
    resourceIds: ['pr:2003'],
    ...overrides,
  };
}

test('Stephanos may request the existing continuity controller to resume a proven same-owner mission', () => {
  const result = projectStephanosGoalContinuation({ checkpoint: checkpoint(), current: current(), schedulerCandidate: candidate() });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE);
  assert.equal(result.mayRequestExistingControllerContinuation, true);
  assert.equal(result.continuationTarget, 'EXISTING_1557_CONTINUITY_CONTROLLER');
  assert.equal(result.duplicateControllerForbidden, true);
  assert.equal(result.duplicateMissionForbidden, true);
  assert.equal(result.protectedMergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('operator-gated work is parked and asks only the existing refill machinery to fill independent capacity', () => {
  const result = projectStephanosGoalContinuation({
    checkpoint: checkpoint({ operatorGate: true, phase: 'READY_FOR_OPERATOR_APPROVAL' }),
    current: current(),
    schedulerCandidate: candidate({ operatorGate: true }),
  });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.APPROVAL_PARKED_REFILL_ELIGIBLE);
  assert.equal(result.mayRequestExistingControllerContinuation, false);
  assert.equal(result.mayRequestCapacityRefill, true);
  assert.equal(result.refillTarget, 'EXISTING_1947_CAPACITY_REFILL');
});

test('main movement forces reproof and prevents autonomous continuation', () => {
  const result = projectStephanosGoalContinuation({
    checkpoint: checkpoint(),
    current: current({ protectedMainHead: '4'.repeat(40) }),
    schedulerCandidate: candidate(),
  });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.REPROVE_BEFORE_CONTINUE);
  assert.equal(result.mayRequestExistingControllerContinuation, false);
});

test('scheduler identity mismatch fails closed rather than creating a new owner or mission', () => {
  const result = projectStephanosGoalContinuation({
    checkpoint: checkpoint(),
    current: current(),
    schedulerCandidate: candidate({ missionId: 'different-mission' }),
  });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD);
  assert.ok(result.reasons.includes('scheduler-mission-mismatch'));
  assert.equal(result.mayRequestExistingControllerContinuation, false);
});

test('missing qualified provider does not fabricate execution', () => {
  const result = projectStephanosGoalContinuation({
    checkpoint: checkpoint(),
    current: current(),
    schedulerCandidate: candidate({ qualifiedProviderAvailable: false }),
  });
  assert.equal(result.state, GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED);
  assert.equal(result.mayRequestExistingControllerContinuation, false);
});
