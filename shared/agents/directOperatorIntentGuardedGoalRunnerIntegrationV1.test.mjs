import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDirectOperatorIntentStandingAuthorityV1 } from './directOperatorIntentStandingAuthorityV1.mjs';
import {
  GUARDED_GOAL_RUNNER_V1_BLOCKER_CLASSES as C,
  GUARDED_GOAL_RUNNER_V1_BLOCKERS as B,
  GUARDED_GOAL_RUNNER_V1_OUTCOMES as O,
  classifyGuardedGoalRunnerV1,
} from './guardedGoalRunnerV1.mjs';

const head = '37915edd61a319c3a1f3e456605986ab637a59fd';

function authority(overrides = {}) {
  return buildDirectOperatorIntentStandingAuthorityV1({
    requestId: 'request-001',
    goalId: 'goal-1506',
    originSurface: 'chatgpt',
    intent: 'Complete this bounded request through the normal protected publication and live path without repeating the same operator decision.',
    ...overrides,
  });
}

function basePacket(overrides = {}) {
  return {
    authorizedGoal: '1506',
    directOperatorIntentAuthority: authority(),
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha: head, currentPhase: 'ready', trafficLight: 'green' },
    currentSourceHead: { sha: head },
    prProof: {
      publicationState: 'published',
      prNumber: 1497,
      prUrl: 'https://github.com/example/repo/pull/1497',
      expectedBaseSha: 'base1',
      baseSha: 'base1',
      expectedHeadSha: head,
      headSha: head,
      mergeable: true,
      conflicting: false,
      draft: false,
      changedFiles: { count: 1 },
      testsRun: { allGreen: true },
      operatorApprovalRequired: true,
    },
    ...overrides,
  };
}

test('a valid direct request carries forward at the green exact-head gate', () => {
  const result = classifyGuardedGoalRunnerV1(basePacket());
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.requiresNewOperatorApproval, false);
  assert.equal(result.mergeGate.standingIntentReused, true);
  assert.equal(result.mergeGate.environmentApprovalEligible, true);
  assert.equal(result.mergeGate.guardedLiveUpdateEligible, true);
});

test('only the protected environment gate may reuse standing intent', () => {
  const protectedGate = classifyGuardedGoalRunnerV1(basePacket({
    supervisorCurrentRecord: { blocker: 'protected-environment-waiting', expectedHeadSha: head, currentPhase: 'ready', trafficLight: 'green' },
    blockerClassification: { class: C.GENUINE_OPERATOR_APPROVAL_GATE, approvalKind: 'protected-merge-environment' },
  }));
  assert.equal(protectedGate.outcome, O.ROUTE_TO_PROTECTED_MERGE);

  const legalGate = classifyGuardedGoalRunnerV1(basePacket({
    supervisorCurrentRecord: { blocker: 'legal-consent', expectedHeadSha: head, currentPhase: 'ready', trafficLight: 'green' },
    blockerClassification: { class: C.GENUINE_OPERATOR_APPROVAL_GATE, approvalKind: 'legal-consent' },
  }));
  assert.equal(legalGate.outcome, O.WAIT_FOR_GENUINE_OPERATOR_APPROVAL);
});

test('revocation or sensitive-scope widening makes a fresh decision mandatory', () => {
  for (const directOperatorIntentAuthority of [
    authority({ revoked: true }),
    authority({ requiresNewSensitiveAuthority: true }),
  ]) {
    const result = classifyGuardedGoalRunnerV1(basePacket({ directOperatorIntentAuthority }));
    assert.equal(result.mergeGate.requiresNewOperatorApproval, true);
    assert.equal(result.mergeGate.standingIntentReused, false);
  }
});


test('a standing-intent receipt for another goal cannot authorize this goal', () => {
  const result = classifyGuardedGoalRunnerV1(basePacket({
    directOperatorIntentAuthority: authority({ goalId: 'goal-9999' }),
  }));
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.requiresNewOperatorApproval, true);
  assert.equal(result.mergeGate.standingIntentReused, false);
});
