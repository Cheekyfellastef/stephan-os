import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
  buildDirectOperatorIntentStandingAuthorityV1,
} from './directOperatorIntentStandingAuthorityV1.mjs';
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

function provenance(overrides = {}) {
  return {
    schemaVersion: DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
    authenticated: true,
    source: 'github-owner-authenticated-request',
    repository: 'Cheekyfellastef/stephan-os',
    operator: 'Cheekyfellastef',
    requestId: 'request-001',
    goalId: 'goal-1506',
    evidenceRef: 'github-comment:4995844144',
    ...overrides,
  };
}

function trustedContext(overrides = {}) {
  return { authenticatedOperatorIntentProvenance: provenance(overrides) };
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

test('workspace receipt alone reaches safe merge proof but cannot reuse protected authority', () => {
  const result = classifyGuardedGoalRunnerV1(basePacket());
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.requiresNewOperatorApproval, true);
  assert.equal(result.mergeGate.standingIntentReused, false);
  assert.equal(result.mergeGate.environmentApprovalEligible, false);
  assert.equal(result.mergeGate.guardedLiveUpdateEligible, false);
});

test('trusted authenticated provenance carries the same bounded request through exact-head merge gate', () => {
  const result = classifyGuardedGoalRunnerV1(basePacket(), trustedContext());
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.requiresNewOperatorApproval, false);
  assert.equal(result.mergeGate.standingIntentReused, true);
  assert.equal(result.mergeGate.environmentApprovalEligible, true);
  assert.equal(result.mergeGate.guardedLiveUpdateEligible, true);
});

test('protected environment gate checks exact-head PR proof before routing', () => {
  const packet = basePacket({
    supervisorCurrentRecord: { blocker: 'protected-environment-waiting', expectedHeadSha: head, currentPhase: 'ready', trafficLight: 'green' },
    blockerClassification: { class: C.GENUINE_OPERATOR_APPROVAL_GATE, approvalKind: 'protected-merge-environment' },
  });
  const routed = classifyGuardedGoalRunnerV1(packet, trustedContext());
  assert.equal(routed.outcome, O.ROUTE_TO_PROTECTED_MERGE);
  assert.equal(routed.operatorApproval.standingIntentReused, true);

  const missingProof = { ...packet };
  delete missingProof.prProof;
  const blockedMissing = classifyGuardedGoalRunnerV1(missingProof, trustedContext());
  assert.equal(blockedMissing.outcome, O.ABORT_MISSING_PROOF);

  const wrongHead = classifyGuardedGoalRunnerV1({
    ...packet,
    prProof: { ...packet.prProof, headSha: '0'.repeat(40) },
  }, trustedContext());
  assert.equal(wrongHead.outcome, O.STOP_AND_REPORT);

  const testsNotGreen = classifyGuardedGoalRunnerV1({
    ...packet,
    prProof: { ...packet.prProof, testsRun: { allGreen: false } },
  }, trustedContext());
  assert.equal(testsNotGreen.outcome, O.STOP_AND_REPORT);
});

test('protected environment gate requires trusted provenance even after proof is green', () => {
  const result = classifyGuardedGoalRunnerV1(basePacket({
    supervisorCurrentRecord: { blocker: 'protected-environment-waiting', expectedHeadSha: head, currentPhase: 'ready', trafficLight: 'green' },
    blockerClassification: { class: C.GENUINE_OPERATOR_APPROVAL_GATE, approvalKind: 'protected-merge-environment' },
  }));
  assert.equal(result.outcome, O.WAIT_FOR_GENUINE_OPERATOR_APPROVAL);
  assert.equal(result.operatorApproval.requiresAuthenticatedProvenance, true);
});

test('unrelated legal gate never reuses direct intent', () => {
  const legalGate = classifyGuardedGoalRunnerV1(basePacket({
    supervisorCurrentRecord: { blocker: 'legal-consent', expectedHeadSha: head, currentPhase: 'ready', trafficLight: 'green' },
    blockerClassification: { class: C.GENUINE_OPERATOR_APPROVAL_GATE, approvalKind: 'legal-consent' },
  }), trustedContext());
  assert.equal(legalGate.outcome, O.WAIT_FOR_GENUINE_OPERATOR_APPROVAL);
});

test('revocation or sensitive-scope widening makes a fresh decision mandatory', () => {
  for (const directOperatorIntentAuthority of [
    authority({ revoked: true }),
    authority({ requiresNewSensitiveAuthority: true }),
  ]) {
    const result = classifyGuardedGoalRunnerV1(basePacket({ directOperatorIntentAuthority }), trustedContext());
    assert.equal(result.mergeGate.requiresNewOperatorApproval, true);
    assert.equal(result.mergeGate.standingIntentReused, false);
  }
});

test('a standing-intent receipt for another goal cannot authorize this goal', () => {
  const result = classifyGuardedGoalRunnerV1(basePacket({
    directOperatorIntentAuthority: authority({ goalId: 'goal-9999' }),
  }), trustedContext({ goalId: 'goal-9999' }));
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.requiresNewOperatorApproval, true);
  assert.equal(result.mergeGate.standingIntentReused, false);
});


test('workspace packet cannot smuggle trusted provenance through serialized fields', () => {
  const result = classifyGuardedGoalRunnerV1(basePacket({
    authenticatedOperatorIntentProvenance: provenance(),
  }));
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.requiresNewOperatorApproval, true);
  assert.equal(result.mergeGate.standingIntentReused, false);
});

test('protected environment gate rejects stale base, draft and non-mergeable proof before authority routing', () => {
  const packet = basePacket({
    supervisorCurrentRecord: { blocker: 'protected-environment-waiting', expectedHeadSha: head, currentPhase: 'ready', trafficLight: 'green' },
    blockerClassification: { class: C.GENUINE_OPERATOR_APPROVAL_GATE, approvalKind: 'protected-merge-environment' },
  });
  const stale = classifyGuardedGoalRunnerV1({
    ...packet,
    prProof: { ...packet.prProof, expectedBaseSha: 'base1', baseSha: 'base2' },
  }, trustedContext());
  assert.equal(stale.outcome, O.ABORT_STALE_BASE);

  const draft = classifyGuardedGoalRunnerV1({
    ...packet,
    prProof: { ...packet.prProof, draft: true },
  }, trustedContext());
  assert.equal(draft.outcome, O.STOP_AND_REPORT);

  const nonMergeable = classifyGuardedGoalRunnerV1({
    ...packet,
    prProof: { ...packet.prProof, mergeable: false },
  }, trustedContext());
  assert.equal(nonMergeable.outcome, O.ABORT_CONFLICTING_PR);
});
