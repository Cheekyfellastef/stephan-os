import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION,
  buildIndependentReviewMissingRunRetriggerMarker,
  planIndependentReviewMissingRunRecovery,
} from './independentReviewMissingRunRecoveryV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const GITHUB_ACTIONS = { login: 'github-actions[bot]', type: 'Bot', id: 41898282 };

function input(overrides = {}) {
  return {
    repository: REPOSITORY,
    retryDecision: 'NO_MATCHING_RUN',
    pr: {
      number: 1894,
      state: 'open',
      draft: false,
      sameRepository: true,
      baseRef: 'main',
      baseSha: BASE,
      headRef: 'fix/recovery-mesh-launch-liveness-specialist-v1',
      headSha: HEAD,
    },
    comments: [],
    ...overrides,
  };
}

function markerComment({ headSha = HEAD, baseSha = BASE, user = GITHUB_ACTIONS } = {}) {
  return {
    body: buildIndependentReviewMissingRunRetriggerMarker({ headSha, baseSha }),
    user,
  };
}

test('permits exactly one draft-ready pulse when no exact review run exists', () => {
  const result = planIndependentReviewMissingRunRecovery(input());
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.RETRIGGER_READY);
  assert.equal(result.mutationAllowed, true);
  assert.equal(result.operation, 'draft-ready-pulse');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.runtimeMutationAllowed, false);
});

test('marks an already-draft exact PR ready without a redundant draft transition', () => {
  const result = planIndependentReviewMissingRunRecovery(input({
    pr: { ...input().pr, draft: true },
  }));
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.RETRIGGER_READY);
  assert.equal(result.operation, 'mark-ready');
});

test('trusted exact marker makes recovery once-per-head and once-per-base', () => {
  const exact = planIndependentReviewMissingRunRecovery(input({ comments: [markerComment()] }));
  assert.equal(exact.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.ALREADY_RETRIGGERED);
  assert.equal(exact.mutationAllowed, false);

  const staleHead = planIndependentReviewMissingRunRecovery(input({ comments: [markerComment({ headSha: OTHER })] }));
  assert.equal(staleHead.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.RETRIGGER_READY);

  const staleBase = planIndependentReviewMissingRunRecovery(input({ comments: [markerComment({ baseSha: OTHER })] }));
  assert.equal(staleBase.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.RETRIGGER_READY);
});

test('forged marker cannot suppress recovery', () => {
  const result = planIndependentReviewMissingRunRecovery(input({
    comments: [markerComment({ user: { login: 'attacker', type: 'User', id: 7 } })],
  }));
  assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.RETRIGGER_READY);
});

test('does not pulse when an ordinary retry decision already owns recovery', () => {
  for (const decision of ['RERUN_FAILED_JOBS', 'WAIT_RUNNING', 'ALREADY_SUCCESSFUL', 'RETRY_BUDGET_EXHAUSTED']) {
    const result = planIndependentReviewMissingRunRecovery(input({ retryDecision: decision }));
    assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.NOT_APPLICABLE);
    assert.equal(result.mutationAllowed, false);
  }
});

test('fails closed on stale, cross-repository or malformed PR identity', () => {
  for (const pr of [
    { ...input().pr, state: 'closed' },
    { ...input().pr, sameRepository: false },
    { ...input().pr, baseRef: 'other' },
    { ...input().pr, headSha: 'short' },
    { ...input().pr, baseSha: 'short' },
  ]) {
    const result = planIndependentReviewMissingRunRecovery(input({ pr }));
    assert.equal(result.decision, INDEPENDENT_REVIEW_MISSING_RUN_RECOVERY_DECISION.INVALID_INPUT);
    assert.equal(result.mutationAllowed, false);
  }
});

test('retrigger marker is exact-head and exact-base bound', () => {
  assert.equal(
    buildIndependentReviewMissingRunRetriggerMarker({ headSha: HEAD, baseSha: BASE }),
    `<!-- stephanos:independent-review-missing-run-retrigger:v1 head=${HEAD} base=${BASE} -->`,
  );
  assert.throws(() => buildIndependentReviewMissingRunRetriggerMarker({ headSha: 'bad', baseSha: BASE }));
});
