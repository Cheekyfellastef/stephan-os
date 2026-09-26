import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProviderNeutralTaskEnvelope,
} from './providerNeutralExecutionCompatibilityV1.mjs';
import {
  OPERATOR_REVIEW_PARKING_STATE,
  buildOperatorReviewReadyBatchV1,
  createOperatorReviewParkingPacketV1,
  evaluateParkedGoalIdentityV1,
  planOperatorReviewParkAndRefillV1,
  validateOperatorReviewParkingPacketV1,
} from './operatorReviewParkingRefillV1.mjs';

const BASE = '1111111111111111111111111111111111111111';
const HEAD = '2222222222222222222222222222222222222222';
const TREE = '3333333333333333333333333333333333333333';
const NOW = '2026-09-03T13:30:00Z';

function parking(overrides = {}) {
  return createOperatorReviewParkingPacketV1({
    parkingId: 'parking-goal-1947-pr-2110',
    missionId: 'mission-goal-1947-pr-2110',
    goalId: 'goal-1947',
    correlationId: 'corr-goal-1947-pr-2110',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1947,
    goalTitle: 'Goal: Provider-Neutral Execution Compatibility Shims and Continuous Capacity Refill V1',
    prNumber: 2110,
    prTitle: 'Park operator-ready goals and refill construction capacity',
    branch: 'agent/operator-review-parking-refill-v1',
    exactHead: HEAD,
    exactTree: TREE,
    exactBase: BASE,
    changedPaths: ['shared/agents/operatorReviewParkingRefillV1.mjs'],
    requiredAuthorityClass: 'PROTECTED_MERGE',
    checksProofRefs: ['proof/checks-pr-2110.json'],
    reviewProofRefs: ['proof/review-pr-2110.json'],
    proofRefs: ['proof/parking-pr-2110.json'],
    parkedAtUtc: NOW,
    leaseIds: ['lease-goal-1947-pr-2110'],
    leaseDisposition: 'RELEASED',
    constructionCapacityReleased: true,
    nextOperatorAction: 'Review the exact protected merge packet for PR #2110.',
    ...overrides,
  });
}

function current(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 2110,
    branch: 'agent/operator-review-parking-refill-v1',
    exactHead: HEAD,
    exactTree: TREE,
    exactBase: BASE,
    changedPaths: ['shared/agents/operatorReviewParkingRefillV1.mjs'],
    state: 'OPEN',
    checksCurrent: true,
    reviewCurrent: true,
    unresolvedThreads: 0,
    observedAtUtc: '2026-09-03T13:35:00Z',
    ...overrides,
  };
}

function task({
  goalId,
  missionId = `mission-${goalId}`,
  taskId = `task-${goalId}`,
  path,
  approvalRequired = false,
  leaseId = `lease-${goalId}`,
}) {
  return createProviderNeutralTaskEnvelope({
    missionId,
    goalId,
    taskId,
    taskClass: 'source-construction',
    correlationId: `corr-${goalId}`,
    repository: 'Cheekyfellastef/stephan-os',
    branch: `agent/${goalId}`,
    exactBase: BASE,
    expectedStartingHeadIfMutable: BASE,
    allowedPaths: [path],
    allowedOperations: ['read', 'test'],
    allowedCommandsOrTestIds: ['git diff --check'],
    forbiddenOperations: [],
    timeoutAndRetryBudget: { timeoutMs: 120000, maxAttempts: 1 },
    resourceLeaseIds: [leaseId],
    requiredTests: ['git diff --check'],
    requiredArtifacts: [`proofs/${goalId}.json`],
    requiredEvidence: [`proof/${goalId}.json`],
    completionContract: `COMPLETE_${goalId.toUpperCase().replace(/-/g, '_')}`,
    operatorApprovalState: {
      requiresOperatorApprovalBeforeDispatch: approvalRequired,
      dispatchApprovalPresent: false,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
      mergeApprovalPresent: false,
    },
    portableCheckpointRef: `receipts/${goalId}.json`,
    createdAtUtc: '2026-09-03T13:00:00Z',
    expiresAtUtc: '2026-09-03T14:00:00Z',
    sourceAdapter: 'github-first',
  });
}

test('a review-ready goal parks with zero authority and consumes no builder capacity', () => {
  const packet = parking();
  const validation = validateOperatorReviewParkingPacketV1(packet);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(packet.state, OPERATOR_REVIEW_PARKING_STATE.PARKED);
  assert.equal(packet.leaseDisposition, 'RELEASED');
  assert.equal(packet.constructionCapacityReleased, true);
  assert.equal(packet.builderCapacityConsumed, false);
  assert.deepEqual(Object.values(packet.authority), [false, false, false, false, false, false, false]);
});

test('parking releases the slot and immediately refills it with later resource-disjoint work', () => {
  const packet = parking();
  const parkedTask = task({
    goalId: packet.goalId,
    missionId: packet.missionId,
    taskId: 'task-parked-goal',
    path: 'shared/agents/operatorReviewParkingRefillV1.mjs',
    approvalRequired: true,
  });
  const conflicting = task({
    goalId: 'goal-conflict',
    path: 'shared/agents/operatorReviewParkingRefillV1.mjs',
  });
  const next = task({
    goalId: 'goal-next',
    path: 'shared/agents/independent-next-goal.mjs',
  });

  const result = planOperatorReviewParkAndRefillV1({
    parkingPacket: packet,
    schedulerDecision: { selectedTasks: [parkedTask, conflicting, next] },
    activeLeaseIds: [],
    seenEventKeys: [],
  });

  assert.equal(result.finalVerdict, 'OPERATOR_REVIEW_PARKED_AND_CAPACITY_REFILLED');
  assert.equal(result.parkedGoalConsumesConstructionCapacity, false);
  assert.equal(result.releasedConstructionSlots, 1);
  assert.equal(result.refillPlan.refillRequests.length, 1);
  assert.equal(result.refillPlan.refillRequests[0].goalId, 'goal-next');
  assert.equal(result.refillPlan.heldTasks.some((item) => item.reason === 'PARKED_FOR_OPERATOR_REVIEW'), true);
  assert.equal(result.refillPlan.heldTasks.some((item) => item.reason === 'PARKED_REVIEW_RESOURCE_CONFLICT'), true);
  assert.equal(result.refillPlan.refillRequests.some((item) => item.goalId === packet.goalId), false);
});

test('parking remains truthful when no safe resource-disjoint refill exists', () => {
  const packet = parking();
  const result = planOperatorReviewParkAndRefillV1({
    parkingPacket: packet,
    schedulerDecision: {
      selectedTasks: [task({ goalId: 'goal-conflict', path: packet.changedPaths[0] })],
    },
  });
  assert.equal(result.finalVerdict, 'OPERATOR_REVIEW_PARKED_NO_ELIGIBLE_REFILL');
  assert.equal(result.refillCount, 0);
  assert.equal(result.parkedGoalConsumesConstructionCapacity, false);
});

test('parked exact identity stays review-ready only while head tree base estate checks review and threads remain current', () => {
  const packet = parking();
  const ok = evaluateParkedGoalIdentityV1(packet, current());
  assert.equal(ok.state, OPERATOR_REVIEW_PARKING_STATE.CURRENT);
  assert.equal(ok.operatorNeeded, true);

  const drift = evaluateParkedGoalIdentityV1(packet, current({
    exactHead: '4444444444444444444444444444444444444444',
    checksCurrent: false,
  }));
  assert.equal(drift.state, OPERATOR_REVIEW_PARKING_STATE.REPROVE_REQUIRED);
  assert.equal(drift.operatorNeeded, false);
  assert.equal(drift.reasons.includes('PARKED_HEAD_DRIFTED'), true);
  assert.equal(drift.reasons.includes('PARKED_CHECKS_REPROVE_REQUIRED'), true);
});

test('merged and closed parked goals terminalize without occupying construction capacity', () => {
  const packet = parking();
  const merged = evaluateParkedGoalIdentityV1(packet, current({ state: 'MERGED' }));
  assert.equal(merged.state, OPERATOR_REVIEW_PARKING_STATE.TERMINAL_MERGED);
  assert.equal(merged.builderCapacityConsumed, false);
  const closed = evaluateParkedGoalIdentityV1(packet, current({ state: 'CLOSED' }));
  assert.equal(closed.state, OPERATOR_REVIEW_PARKING_STATE.TERMINAL_CLOSED);
  assert.equal(closed.builderCapacityConsumed, false);
});

test('operator review batch contains only current packets and separates reproving work', () => {
  const first = parking();
  const second = parking({
    parkingId: 'parking-goal-2002-pr-2111',
    missionId: 'mission-goal-2002-pr-2111',
    goalId: 'goal-2002',
    correlationId: 'corr-goal-2002-pr-2111',
    issueNumber: 2002,
    goalTitle: 'Goal: Stephanos Goal Building Agent and 100% Programme Operations V1',
    prNumber: 2111,
    prTitle: 'Wire work-conserving Goal Building Agent parking projection',
    branch: 'agent/goal-building-agent-parking-v1',
    exactHead: '5555555555555555555555555555555555555555',
    exactTree: '6666666666666666666666666666666666666666',
    changedPaths: ['shared/agents/goalBuildingAgentParkingProjectionV1.mjs'],
    leaseIds: ['lease-goal-2002-pr-2111'],
    parkedAtUtc: '2026-09-03T13:31:00Z',
  });
  const batch = buildOperatorReviewReadyBatchV1([
    { packet: first, current: current() },
    { packet: second, current: {
      ...current(),
      prNumber: 2111,
      branch: second.branch,
      exactHead: '7777777777777777777777777777777777777777',
      exactTree: second.exactTree,
      changedPaths: second.changedPaths,
    } },
  ]);

  assert.equal(batch.readyCount, 1);
  assert.equal(batch.reproveCount, 1);
  assert.equal(batch.ready[0].goalTitle, first.goalTitle);
  assert.equal(batch.ready[0].prTitle, first.prTitle);
  assert.equal(batch.reproving[0].prNumber, 2111);
  assert.equal(batch.parkedBuilderCapacityConsumed, 0);
  assert.equal(batch.operatorNeeded, true);
});

test('duplicate parked decision identities fail closed instead of producing two approvals', () => {
  const packet = parking();
  const batch = buildOperatorReviewReadyBatchV1([
    { packet, current: current() },
    { packet, current: current() },
  ]);
  assert.equal(batch.state, OPERATOR_REVIEW_PARKING_STATE.SAFE_HOLD);
  assert.equal(batch.conflicts.some((item) => item.reason === 'DUPLICATE_PARKED_DECISION_IDENTITY'), true);
});

test('forged authority or unreleased capacity cannot become a parking packet', () => {
  const packet = parking();
  const forged = {
    ...packet,
    authority: { ...packet.authority, mergeAllowed: true },
  };
  const forgedValidation = validateOperatorReviewParkingPacketV1(forged);
  assert.equal(forgedValidation.valid, false);
  assert.equal(forgedValidation.errors.includes('parking-authority-not-zero'), true);

  const held = { ...packet, leaseDisposition: 'HELD', constructionCapacityReleased: false };
  const heldValidation = validateOperatorReviewParkingPacketV1(held);
  assert.equal(heldValidation.valid, false);
  assert.equal(heldValidation.errors.includes('lease-not-released'), true);
  assert.equal(heldValidation.errors.includes('construction-capacity-not-released'), true);
});
