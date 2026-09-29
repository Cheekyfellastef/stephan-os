import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewFindingsArtifact,
} from './operatorMergeReviewArtifactV1.mjs';
import {
  planIndependentReviewTerminalFindingsPublicationV1,
  renderIndependentReviewTerminalFindingsCommentV1,
} from './independentReviewTerminalFindingsPublicationV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PR_NUMBER = 1946;
const BRANCH = 'fix/battle-bridge-recovery-proof-compatibility-v1';
const HEAD = '9351f5f1acda78c6ea3fffc5ceb3295b4dc28c62';
const BASE = '64d9556e630d38c93ff8aa5f0c1081ac0105bff6';
const RUN_ID = 32530000001;

function artifact(attempt = 2) {
  return buildIndependentReviewFindingsArtifact({
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    workflowRunId: RUN_ID,
    workflowRunAttempt: attempt,
    createdAtUtc: '2026-08-21T21:30:00.000Z',
    analysis: {
      schemaVersion: 'stephanos.independent-security-analysis.v1',
      findings: [
        {
          severity: 'P1',
          code: 'exact-test-finding',
          path: 'scripts/windows/example.ps1',
          message: 'This message is intentionally not copied into the terminal blocker packet.',
        },
      ],
      counts: { P0: 0, P1: 1, P2: 0 },
      verdict: 'findings',
      proofRefs: ['proofs/independent-review/exact-test-finding'],
      finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
    },
  });
}

function input(attempt = 2, value = artifact(attempt)) {
  return {
    artifact: value,
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    workflowRunId: RUN_ID,
    workflowRunAttempt: attempt,
  };
}

test('attempt one findings remain retryable and are not published as terminal', () => {
  const result = planIndependentReviewTerminalFindingsPublicationV1(input(1));
  assert.equal(result.decision, 'RETRY_BUDGET_REMAINS');
  assert.equal(result.publishAllowed, false);
  assert.deepEqual(result.counts, { P0: 0, P1: 1, P2: 0 });
});

test('attempt two findings become one exact blocker packet with zero mutation authority', () => {
  const result = planIndependentReviewTerminalFindingsPublicationV1(input(2));
  assert.equal(result.decision, 'PUBLISH_TERMINAL_FINDINGS');
  assert.equal(result.publishAllowed, true);
  assert.equal(result.workflowRunId, RUN_ID);
  assert.equal(result.workflowRunAttempt, 2);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.baseSha, BASE);
  assert.deepEqual(result.counts, { P0: 0, P1: 1, P2: 0 });
  assert.deepEqual(result.findings, [{
    severity: 'P1',
    code: 'exact-test-finding',
    path: 'scripts/windows/example.ps1',
  }]);
  assert.equal(result.authority.reviewAccepted, false);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);

  const comment = renderIndependentReviewTerminalFindingsCommentV1(result);
  assert.match(comment, /stephanos:independent-review-terminal-findings:v1/);
  assert.match(comment, /exact-test-finding/);
  assert.match(comment, /"reviewAccepted": false/);
  assert.doesNotMatch(comment, /intentionally not copied/);
  assert.doesNotMatch(comment, /proofs\/independent-review\/exact-test-finding/);
});

test('exact head and base movement fail closed', () => {
  assert.throws(() => planIndependentReviewTerminalFindingsPublicationV1({
    ...input(2),
    sourceHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }), /identity does not match/);
  assert.throws(() => planIndependentReviewTerminalFindingsPublicationV1({
    ...input(2),
    baseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }), /identity does not match/);
});

test('tampered findings payload digest fails closed', () => {
  const value = JSON.parse(JSON.stringify(artifact(2)));
  value.analysis.findings[0].code = 'tampered-after-digest';
  assert.throws(() => planIndependentReviewTerminalFindingsPublicationV1(input(2, value)), /payload digest is invalid/);
});

test('a clean review artifact is never recast as terminal findings', () => {
  const result = planIndependentReviewTerminalFindingsPublicationV1({
    ...input(2),
    artifact: { schemaVersion: 'stephanos.independent-review-artifact.v1', kind: 'stephanos.independent-review.artifact' },
  });
  assert.equal(result.decision, 'NOT_FINDINGS_ARTIFACT');
  assert.equal(result.publishAllowed, false);
});
