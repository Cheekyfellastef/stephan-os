import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_COORDINATOR_JOB,
  CANONICAL_COORDINATOR_WORKFLOW_ID,
  CANONICAL_COORDINATOR_WORKFLOW_NAME,
  CANONICAL_COORDINATOR_WORKFLOW_PATH,
  INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA,
} from './independentReviewHandoffProvenanceV1.mjs';
import {
  INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SCHEMA,
  buildIndependentReviewHandoffRunReceiptV1,
  validateIndependentReviewHandoffRunReceiptV1,
} from './independentReviewHandoffRunReceiptV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = '1111111111111111111111111111111111111111';
const baseSha = '2222222222222222222222222222222222222222';
const branch = 'agent/example-review-target-v1';
const prNumber = 1917;
const handoffCommentId = 5349487923;
const coordinatorWorkflowRunId = 32315732051;
const coordinatorWorkflowRunAttempt = 1;

function provenance(overrides = {}) {
  return {
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA,
    coordinatorWorkflowId: CANONICAL_COORDINATOR_WORKFLOW_ID,
    coordinatorWorkflowName: CANONICAL_COORDINATOR_WORKFLOW_NAME,
    coordinatorWorkflowPath: CANONICAL_COORDINATOR_WORKFLOW_PATH,
    coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt,
    coordinatorEvent: 'schedule',
    coordinatorRepository: repository,
    coordinatorSourceSha: baseSha,
    coordinatorWorkflowRef: `${repository}/${CANONICAL_COORDINATOR_WORKFLOW_PATH}@refs/heads/main`,
    coordinatorJobIdentity: CANONICAL_COORDINATOR_JOB,
    handoffCommentId,
    ...overrides,
  };
}

function pullRequest(overrides = {}) {
  return {
    number: prNumber,
    state: 'open',
    head: {
      sha: sourceHead,
      ref: branch,
      repo: { full_name: repository },
    },
    base: {
      sha: baseSha,
      ref: 'main',
      repo: { full_name: repository },
    },
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildIndependentReviewHandoffRunReceiptV1({
    repository,
    currentMainSha: baseSha,
    pullRequest: pullRequest(),
    provenance: provenance(),
    ...overrides,
  });
}

test('builds evidence-only immutable-run receipt binding coordinator run, handoff and exact PR identity', () => {
  const receipt = build();
  assert.equal(receipt.schemaVersion, INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SCHEMA);
  assert.equal(receipt.repository, repository);
  assert.equal(receipt.prNumber, prNumber);
  assert.equal(receipt.sourceHead, sourceHead);
  assert.equal(receipt.baseSha, baseSha);
  assert.equal(receipt.branch, branch);
  assert.equal(receipt.handoffCommentId, handoffCommentId);
  assert.equal(receipt.coordinatorProvenance.coordinatorWorkflowId, CANONICAL_COORDINATOR_WORKFLOW_ID);
  assert.equal(receipt.coordinatorProvenance.coordinatorWorkflowRunId, coordinatorWorkflowRunId);
  assert.equal(receipt.coordinatorProvenance.coordinatorWorkflowRunAttempt, coordinatorWorkflowRunAttempt);
  assert.match(receipt.bindingSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.authority, {
    evidenceOnly: true,
    reviewWorkflowDispatchAllowed: false,
    sourceMutationAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerQualificationAllowed: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
});

test('validator re-binds the exact expected coordinator run and PR identity', () => {
  const receipt = build();
  const validated = validateIndependentReviewHandoffRunReceiptV1(receipt, {
    repository,
    currentMainSha: baseSha,
    prNumber,
    sourceHead,
    baseSha,
    handoffCommentId,
    coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt,
  });
  assert.equal(validated.bindingSha256, receipt.bindingSha256);
});

test('different exact coordinator run changes immutable binding identity', () => {
  const first = build();
  const second = build({
    provenance: provenance({ coordinatorWorkflowRunId: coordinatorWorkflowRunId + 1 }),
  });
  assert.notEqual(first.bindingSha256, second.bindingSha256);
});

test('stale main, wrong PR head, fork or closed PR fails closed', () => {
  assert.throws(
    () => build({ currentMainSha: '3333333333333333333333333333333333333333' }),
    /current main|provenance source/,
  );

  const wrongHead = pullRequest();
  wrongHead.head = { ...wrongHead.head, sha: '' };
  assert.throws(
    () => build({ pullRequest: wrongHead }),
    /same-repository review scope/,
  );

  const fork = pullRequest();
  fork.head = { ...fork.head, repo: { full_name: 'other/repo' } };
  assert.throws(
    () => build({ pullRequest: fork }),
    /same-repository review scope/,
  );

  assert.throws(
    () => build({ pullRequest: pullRequest({ state: 'closed' }) }),
    /same-repository review scope/,
  );
});

test('tampered binding, widened authority and unknown fields fail closed', () => {
  const receipt = build();
  assert.throws(
    () => validateIndependentReviewHandoffRunReceiptV1({ ...receipt, bindingSha256: 'f'.repeat(64) }),
    /binding hash mismatch/,
  );
  assert.throws(
    () => validateIndependentReviewHandoffRunReceiptV1({
      ...receipt,
      authority: { ...receipt.authority, reviewWorkflowDispatchAllowed: true },
    }),
    /schema or authority/,
  );
  assert.throws(
    () => validateIndependentReviewHandoffRunReceiptV1({ ...receipt, command: 'run anything' }),
    /closed-world schema/,
  );
});

test('expected comment or coordinator-run mismatch is rejected even when payload is otherwise valid', () => {
  const receipt = build();
  assert.throws(
    () => validateIndependentReviewHandoffRunReceiptV1(receipt, { handoffCommentId: handoffCommentId + 1 }),
    /comment mismatch/,
  );
  assert.throws(
    () => validateIndependentReviewHandoffRunReceiptV1(receipt, { coordinatorWorkflowRunId: coordinatorWorkflowRunId + 1 }),
    /coordinator run mismatch/,
  );
});
