import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_COORDINATOR_JOB,
  CANONICAL_COORDINATOR_WORKFLOW_ID,
  CANONICAL_COORDINATOR_WORKFLOW_NAME,
  CANONICAL_COORDINATOR_WORKFLOW_PATH,
  appendIndependentReviewHandoffProvenanceV1,
  buildIndependentReviewHandoffProvenanceV1,
  parseIndependentReviewHandoffProvenanceV1,
} from './independentReviewHandoffProvenanceV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const currentMainSha = '2222222222222222222222222222222222222222';
const handoffCommentId = 987654321;
const workflowRef = `${repository}/${CANONICAL_COORDINATOR_WORKFLOW_PATH}@refs/heads/main`;

function workflowRun(overrides = {}) {
  return {
    id: 32307961772,
    run_attempt: 1,
    workflow_id: CANONICAL_COORDINATOR_WORKFLOW_ID,
    name: CANONICAL_COORDINATOR_WORKFLOW_NAME,
    path: CANONICAL_COORDINATOR_WORKFLOW_PATH,
    event: 'schedule',
    repository: { full_name: repository },
    head_sha: currentMainSha,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildIndependentReviewHandoffProvenanceV1({
    repository,
    currentMainSha,
    workflowRun: workflowRun(),
    workflowRef,
    jobIdentity: CANONICAL_COORDINATOR_JOB,
    handoffCommentId,
    ...overrides,
  });
}

test('builds exact trusted coordinator-run provenance and round-trips through the handoff body', () => {
  const provenance = build();
  assert.equal(provenance.coordinatorWorkflowId, CANONICAL_COORDINATOR_WORKFLOW_ID);
  assert.equal(provenance.coordinatorWorkflowRunId, 32307961772);
  assert.equal(provenance.coordinatorWorkflowRunAttempt, 1);
  assert.equal(provenance.coordinatorSourceSha, currentMainSha);
  assert.equal(provenance.handoffCommentId, handoffCommentId);

  const body = appendIndependentReviewHandoffProvenanceV1(
    '<!-- stephanos:exact-head-review-dispatch:v1 head=1111111111111111111111111111111111111111 -->\n## Provider-neutral exact-head review handoff',
    provenance,
  );
  const parsed = parseIndependentReviewHandoffProvenanceV1(body, {
    repository,
    currentMainSha,
    handoffCommentId,
  });
  assert.deepEqual(parsed, provenance);
});

test('wrong workflow id, workflow identity, event, source, ref, job, repository or run identity fails closed', () => {
  const badRuns = [
    workflowRun({ workflow_id: 0 }),
    workflowRun({ workflow_id: CANONICAL_COORDINATOR_WORKFLOW_ID + 1 }),
    workflowRun({ run_attempt: 0 }),
    workflowRun({ name: 'Exact-Head Review Dispatch Copy' }),
    workflowRun({ path: '.github/workflows/lookalike.yml' }),
    workflowRun({ event: 'pull_request' }),
    workflowRun({ repository: { full_name: 'other/repo' } }),
    workflowRun({ head_sha: '3333333333333333333333333333333333333333' }),
  ];
  for (const run of badRuns) {
    assert.throws(
      () => buildIndependentReviewHandoffProvenanceV1({
        repository,
        currentMainSha,
        workflowRun: run,
        workflowRef,
        jobIdentity: CANONICAL_COORDINATOR_JOB,
        handoffCommentId,
      }),
      /provenance|canonical|repository|current main/,
    );
  }

  assert.throws(() => build({ workflowRef: `${repository}/${CANONICAL_COORDINATOR_WORKFLOW_PATH}@refs/heads/release` }), /provenance|canonical/);
  assert.throws(() => build({ jobIdentity: 'verify' }), /provenance|canonical/);
  assert.throws(() => build({ handoffCommentId: 0 }), /provenance|canonical/);
});

test('parser rejects missing, duplicated, malformed or widened provenance', () => {
  assert.throws(() => parseIndependentReviewHandoffProvenanceV1('no provenance'), /marker is missing/);

  const provenance = build();
  const body = appendIndependentReviewHandoffProvenanceV1('handoff', provenance);
  assert.throws(() => appendIndependentReviewHandoffProvenanceV1(body, provenance), /already exists/);
  assert.throws(
    () => parseIndependentReviewHandoffProvenanceV1(`${body}\n\n${body}`),
    /marker is duplicated/,
  );

  const malformed = body.replace(/```json[\s\S]*?```/, '```json\nnot-json\n```');
  assert.throws(() => parseIndependentReviewHandoffProvenanceV1(malformed), /malformed/);

  const widened = body.replace(
    '"handoffCommentId": 987654321',
    '"handoffCommentId": 987654321,\n  "arbitraryCommand": "run anything"',
  );
  assert.throws(() => parseIndependentReviewHandoffProvenanceV1(widened), /closed-world schema/);
});

test('expected repository, main and comment identity are independently enforced on parse', () => {
  const body = appendIndependentReviewHandoffProvenanceV1('handoff', build());
  assert.throws(
    () => parseIndependentReviewHandoffProvenanceV1(body, { repository: 'other/repo', currentMainSha, handoffCommentId }),
    /repository mismatch/,
  );
  assert.throws(
    () => parseIndependentReviewHandoffProvenanceV1(body, { repository, currentMainSha: '3333333333333333333333333333333333333333', handoffCommentId }),
    /current main/,
  );
  assert.throws(
    () => parseIndependentReviewHandoffProvenanceV1(body, { repository, currentMainSha, handoffCommentId: handoffCommentId + 1 }),
    /comment id mismatch/,
  );
});
