import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_COORDINATOR_JOB,
  CANONICAL_COORDINATOR_WORKFLOW_NAME,
  CANONICAL_COORDINATOR_WORKFLOW_PATH,
  appendIndependentReviewHandoffProvenanceV1,
  buildIndependentReviewHandoffProvenanceV1,
} from './independentReviewHandoffProvenanceV1.mjs';
import {
  exactHeadReviewDispatchMarker,
  validateIndependentReviewHandoffIdentityV1,
} from './independentReviewHandoffIdentityV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1914;
const sourceHead = 'db4fe6a9e9a225bb3e21436ff1280eacffbb8741';
const baseSha = 'a8a513eaf65922eee2311b10bb3c934c45f8ef47';
const branch = 'fix/battle-bridge-mailbox-outbox-starvation-v1';
const commentId = 5347312291;

function provenance(overrides = {}) {
  const workflowRun = {
    id: 32307961772,
    run_attempt: 1,
    workflow_id: 316253381,
    name: CANONICAL_COORDINATOR_WORKFLOW_NAME,
    path: CANONICAL_COORDINATOR_WORKFLOW_PATH,
    event: 'schedule',
    repository: { full_name: repository },
    head_sha: baseSha,
    ...(overrides.workflowRun || {}),
  };
  return buildIndependentReviewHandoffProvenanceV1({
    repository,
    currentMainSha: baseSha,
    workflowRun,
    workflowRef: `${repository}/${CANONICAL_COORDINATOR_WORKFLOW_PATH}@refs/heads/main`,
    jobIdentity: CANONICAL_COORDINATOR_JOB,
    handoffCommentId: commentId,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'workflowRun')),
  });
}

function handoffBody(provenanceValue = provenance()) {
  return appendIndependentReviewHandoffProvenanceV1(
    `${exactHeadReviewDispatchMarker(sourceHead)}\n## Provider-neutral exact-head review handoff\n\nAutomated bounded review handoff.`,
    provenanceValue,
  );
}

function event(overrides = {}) {
  return {
    repository: { full_name: repository },
    issue: { number: prNumber, pull_request: { url: 'https://api.github.com/example' } },
    comment: {
      id: commentId,
      body: handoffBody(),
      user: { login: 'github-actions[bot]', id: 41898282 },
    },
    ...overrides,
  };
}

function validate(overrides = {}) {
  return validateIndependentReviewHandoffIdentityV1({
    event: event(),
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    ...overrides,
  });
}

test('trusted exact-head coordinator handoff requires exact coordinator-run provenance and permits review only', () => {
  const result = validate();
  assert.equal(result.sourceHead, sourceHead);
  assert.equal(result.baseSha, baseSha);
  assert.equal(result.prNumber, prNumber);
  assert.equal(result.coordinatorProvenance.coordinatorWorkflowId, 316253381);
  assert.equal(result.coordinatorProvenance.coordinatorWorkflowRunId, 32307961772);
  assert.equal(result.coordinatorProvenance.coordinatorSourceSha, baseSha);
  assert.equal(result.coordinatorProvenance.handoffCommentId, commentId);
  assert.deepEqual(result.authority, {
    reviewExecutionAllowed: true,
    sourceMutationAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerQualificationAllowed: false,
    leaseSeizureAllowed: false,
  });
});

test('wrong or lookalike actor cannot launch the reviewer', () => {
  for (const user of [
    { login: 'github-actions[bot]', id: 1 },
    { login: 'github-actions', id: 41898282 },
    { login: 'Cheekyfellastef', id: 267490109 },
  ]) {
    const bad = event();
    bad.comment.user = user;
    assert.throws(() => validate({ event: bad }), /trusted GitHub Actions coordinator/);
  }
});

test('stale or malformed head marker fails closed', () => {
  const stale = event();
  stale.comment.body = handoffBody().replace(sourceHead, '1111111111111111111111111111111111111111');
  assert.throws(() => validate({ event: stale }), /marker is missing|different exact head/);

  const malformed = event();
  malformed.comment.body = '## Provider-neutral exact-head review handoff';
  assert.throws(() => validate({ event: malformed }), /marker is missing/);
});

test('wrong repository or PR fails closed', () => {
  const wrongRepo = event({ repository: { full_name: 'other/repo' } });
  assert.throws(() => validate({ event: wrongRepo }), /repository/);

  const wrongPr = event();
  wrongPr.issue.number = prNumber + 1;
  assert.throws(() => validate({ event: wrongPr }), /exact pull request/);
});

test('ordinary owner comment cannot counterfeit a handoff', () => {
  const owner = event();
  owner.comment.user = { login: 'Cheekyfellastef', id: 267490109 };
  assert.throws(() => validate({ event: owner }), /trusted GitHub Actions coordinator/);
});

test('missing or mismatched coordinator run provenance fails closed', () => {
  const missing = event();
  missing.comment.body = `${exactHeadReviewDispatchMarker(sourceHead)}\n## Provider-neutral exact-head review handoff`;
  assert.throws(() => validate({ event: missing }), /provenance marker is missing/);

  const wrongComment = event();
  wrongComment.comment.id = commentId + 1;
  assert.throws(() => validate({ event: wrongComment }), /comment id mismatch/);

  const wrongSource = event();
  wrongSource.comment.body = handoffBody().replace(
    `"coordinatorSourceSha": "${baseSha}"`,
    '"coordinatorSourceSha": "3333333333333333333333333333333333333333"',
  );
  assert.throws(() => validate({ event: wrongSource }), /current main/);

  const wrongWorkflow = event();
  wrongWorkflow.comment.body = handoffBody().replace(
    `"coordinatorWorkflowPath": "${CANONICAL_COORDINATOR_WORKFLOW_PATH}"`,
    '"coordinatorWorkflowPath": ".github/workflows/lookalike.yml"',
  );
  assert.throws(() => validate({ event: wrongWorkflow }), /not canonical/);
});

test('invalid normalized base or branch identity fails before review', () => {
  assert.throws(() => validate({ baseSha: 'not-a-sha' }), /normalized review identity/);
  assert.throws(() => validate({ branch: '' }), /normalized review identity/);
});
