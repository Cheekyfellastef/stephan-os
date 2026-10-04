import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStandingIntentProtectedMergeContinuationV1,
  missionGoalIssueNumberV1,
} from './standingIntentProtectedMergeContinuationV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const REVIEW_DIGEST = `sha256:${'c'.repeat(64)}`;
const PAYLOAD = 'd'.repeat(64);

function mission(overrides = {}) {
  return {
    missionId: 'goal-1903-autonomy-test',
    repository: 'Cheekyfellastef/stephan-os',
    currentPhase: 'AWAITING_OPERATOR_APPROVAL',
    pullRequest: {
      number: 2800,
      headSha: HEAD,
      mergeable: true,
      checks: [
        { name: 'Build Stephanos UI', status: 'success', required: true },
        { name: 'PR Clean Guard', status: 'success', required: true },
      ],
    },
    approval: {
      status: 'pending',
      requiredToken: `APPROVE_OPENCLAW_SQUASH_MERGE:2800:${HEAD}`,
      executionRoute: '',
    },
    ...overrides,
  };
}

function intentEvidence(overrides = {}) {
  const receipt = {
    schemaVersion: 'stephanos.direct-operator-intent-standing-authority.v1',
    repository: 'Cheekyfellastef/stephan-os',
    operator: 'Cheekyfellastef',
    requestId: 'chatgpt-20261004-autonomous-build-closure-v1',
    goalId: 'goal-1903',
    originSurface: 'chatgpt',
    intent: 'Continue bounded source work through exact protected merge and guarded live update.',
    directOperatorRequest: true,
    boundedScope: true,
    requestedOutcome: 'build-test-review-protected-merge-guarded-live',
    autoProtectedMergeRequested: true,
    guardedLiveUpdateRequested: true,
    requiresNewSensitiveAuthority: false,
    revoked: false,
  };
  const authenticatedProvenance = {
    schemaVersion: 'stephanos.direct-operator-intent-authenticated-provenance.v1',
    authenticated: true,
    source: 'github-owner-authenticated-request',
    repository: 'Cheekyfellastef/stephan-os',
    operator: 'Cheekyfellastef',
    requestId: receipt.requestId,
    goalId: receipt.goalId,
    evidenceRef: 'github-comment-5984364946',
  };
  return {
    valid: true,
    receipt,
    authenticatedProvenance,
    authority: {
      ...receipt,
      valid: true,
      protectedContinuationAuthenticated: true,
      protectedMergeEnvironmentApprovalEligible: true,
      protectedExactHeadMergeEligible: true,
      authenticatedProvenance,
    },
    ...overrides,
  };
}

function reviewEvidence(overrides = {}) {
  return {
    ok: true,
    prNumber: 2800,
    expectedHead: HEAD,
    expectedBase: BASE,
    reviewRunId: 40000000001,
    reviewRunAttempt: 1,
    reviewJobId: 100000000001,
    reviewArtifactId: 12000000001,
    reviewArtifactDigest: REVIEW_DIGEST,
    reviewPayloadSha256: PAYLOAD,
    reviewMode: 'clean-independent',
    reviewFindingCode: '',
    ...overrides,
  };
}

test('goal issue is derived only from canonical mission-id prefixes', () => {
  assert.equal(missionGoalIssueNumberV1({ missionId: 'goal-1903-autonomy-test' }), 1903);
  assert.equal(missionGoalIssueNumberV1({ missionId: 'critical-1903-elastic-goal' }), 1903);
  assert.equal(missionGoalIssueNumberV1({ missionId: 'worker-1903' }), 0);
});

test('authenticated standing intent creates only an exact protected mailbox command', () => {
  const result = buildStandingIntentProtectedMergeContinuationV1({
    mission: mission(),
    intentEvidence: intentEvidence(),
    reviewEvidence: reviewEvidence(),
  }, { now: new Date('2026-10-04T21:30:00Z') });
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.command.operation, 'EXECUTE_PROTECTED_OPENCLAW_PR_MERGE');
  assert.equal(result.command.prNumber, 2800);
  assert.equal(result.command.expectedHead, HEAD);
  assert.equal(result.command.expectedBase, BASE);
  assert.equal(result.command.reviewMode, 'clean-independent');
  assert.equal(result.command.reviewFindingCode, '');
  assert.equal(result.command.mergeApprovalToken, `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:2800:${HEAD}`);
  assert.equal(result.approvalEvent.approvalRoute, 'protected-workflow');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.directMergePerformed, false);
  assert.equal(result.protectedWorkflowRequired, true);
});

test('workspace-style or cross-goal authority cannot create protected continuation', () => {
  for (const evidence of [
    intentEvidence({
      authority: {
        ...intentEvidence().authority,
        protectedContinuationAuthenticated: false,
        protectedMergeEnvironmentApprovalEligible: false,
        protectedExactHeadMergeEligible: false,
      },
    }),
    intentEvidence({
      authority: {
        ...intentEvidence().authority,
        goalId: 'goal-1904',
      },
    }),
  ]) {
    const result = buildStandingIntentProtectedMergeContinuationV1({
      mission: mission(),
      intentEvidence: evidence,
      reviewEvidence: reviewEvidence(),
    });
    assert.equal(result.ok, false);
  }
});

test('head, base, mission approval token and independent review are all fail-closed', () => {
  const variants = [
    { mission: mission({ pullRequest: { ...mission().pullRequest, headSha: 'e'.repeat(40) } }), review: reviewEvidence() },
    { mission: mission({ approval: { ...mission().approval, requiredToken: 'wrong' } }), review: reviewEvidence() },
    { mission: mission(), review: reviewEvidence({ expectedBase: 'invalid' }) },
    { mission: mission(), review: reviewEvidence({ reviewMode: 'qualified-operator-bootstrap' }) },
    { mission: mission(), review: reviewEvidence({ ok: false }) },
  ];
  for (const variant of variants) {
    const result = buildStandingIntentProtectedMergeContinuationV1({
      mission: variant.mission,
      intentEvidence: intentEvidence(),
      reviewEvidence: variant.review,
    });
    assert.equal(result.ok, false);
  }
});

test('protected continuation is resumable without replaying approval transition', () => {
  const pending = mission({
    currentPhase: 'MERGE_PULL_REQUEST',
    approval: {
      ...mission().approval,
      status: 'approved',
      executionRoute: 'protected-workflow',
      standingIntentEvidenceRef: 'github-comment-5984364946',
    },
  });
  const result = buildStandingIntentProtectedMergeContinuationV1({
    mission: pending,
    intentEvidence: intentEvidence(),
    reviewEvidence: reviewEvidence(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.approvalEvent, null);
  assert.equal(result.command.requestId, `standing-merge-2800-${HEAD.slice(0, 16)}`);
});
