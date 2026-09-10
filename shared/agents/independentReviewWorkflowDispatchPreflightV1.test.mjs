import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewHandoffRunReceiptV1,
} from './independentReviewHandoffRunReceiptV1.mjs';
import {
  INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA,
  CANONICAL_COORDINATOR_JOB,
  CANONICAL_COORDINATOR_WORKFLOW_NAME,
  CANONICAL_COORDINATOR_WORKFLOW_PATH,
} from './independentReviewHandoffProvenanceV1.mjs';
import {
  CANONICAL_REPOSITORY,
  CANONICAL_REVIEW_JOB,
  CANONICAL_REVIEW_WORKFLOW_NAME,
  CANONICAL_REVIEW_WORKFLOW_PATH,
  INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA,
  admitIndependentReviewWorkflowDispatchV1,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';
import {
  buildIndependentReviewWorkflowDispatchPreflightV1,
} from './independentReviewWorkflowDispatchPreflightV1.mjs';

const sourceHead = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const branch = 'agent/openclaw-oc1';
const prNumber = 1910;
const handoffCommentId = 5350412992;

function workflowDefinition() {
  return {
    id: 123456,
    name: CANONICAL_REVIEW_WORKFLOW_NAME,
    path: CANONICAL_REVIEW_WORKFLOW_PATH,
    state: 'active',
  };
}

function provenance() {
  return {
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_SCHEMA,
    coordinatorWorkflowId: 316253381,
    coordinatorWorkflowName: CANONICAL_COORDINATOR_WORKFLOW_NAME,
    coordinatorWorkflowPath: CANONICAL_COORDINATOR_WORKFLOW_PATH,
    coordinatorWorkflowRunId: 32307961772,
    coordinatorWorkflowRunAttempt: 1,
    coordinatorEvent: 'schedule',
    coordinatorRepository: CANONICAL_REPOSITORY,
    coordinatorSourceSha: baseSha,
    coordinatorWorkflowRef: `${CANONICAL_REPOSITORY}/${CANONICAL_COORDINATOR_WORKFLOW_PATH}@refs/heads/main`,
    coordinatorJobIdentity: CANONICAL_COORDINATOR_JOB,
    handoffCommentId,
  };
}

function pullRequest(overrides = {}) {
  return {
    number: prNumber,
    state: 'open',
    draft: false,
    head: { sha: sourceHead, ref: branch, repo: { full_name: CANONICAL_REPOSITORY } },
    base: { sha: baseSha, ref: 'main', repo: { full_name: CANONICAL_REPOSITORY } },
    ...overrides,
  };
}

function handoffIdentity() {
  return {
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA,
    repository: CANONICAL_REPOSITORY,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    baseBranch: 'main',
    marker: `<!-- stephanos:exact-head-review-dispatch:v1 head=${sourceHead} -->`,
    coordinatorProvenance: provenance(),
    authority: {
      reviewExecutionAllowed: true,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      leaseSeizureAllowed: false,
    },
  };
}

function environment(overrides = {}) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: CANONICAL_REPOSITORY,
    GITHUB_WORKFLOW: CANONICAL_REVIEW_WORKFLOW_NAME,
    GITHUB_JOB: CANONICAL_REVIEW_JOB,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: baseSha,
    GITHUB_WORKFLOW_REF: `${CANONICAL_REPOSITORY}/${CANONICAL_REVIEW_WORKFLOW_PATH}@refs/heads/main`,
    ...overrides,
  };
}

function validInput({ draft = false } = {}) {
  const pr = pullRequest({ draft });
  const receipt = buildIndependentReviewHandoffRunReceiptV1({
    repository: CANONICAL_REPOSITORY,
    currentMainSha: baseSha,
    pullRequest: pr,
    provenance: provenance(),
  });
  const admission = admitIndependentReviewWorkflowDispatchV1({
    repository: CANONICAL_REPOSITORY,
    workflowDefinition: workflowDefinition(),
    currentMainSha: baseSha,
    pullRequest: pr,
    handoffIdentity: handoffIdentity(),
    handoffRunReceipt: receipt,
  });
  return {
    environment: environment(),
    workflowDefinition: workflowDefinition(),
    currentMainSha: baseSha,
    pullRequest: pr,
    handoffIdentity: handoffIdentity(),
    handoffRunReceipt: receipt,
    workflowDispatchInputs: { ...admission.workflowDispatchInputs },
  };
}

test('normalizes one trusted workflow-dispatch run into a bounded immutable review context', () => {
  const result = buildIndependentReviewWorkflowDispatchPreflightV1(validInput());
  assert.equal(result.verdict, 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PASS');
  assert.equal(result.prNumber, prNumber);
  assert.equal(result.sourceHead, sourceHead);
  assert.equal(result.baseSha, baseSha);
  assert.equal(result.branch, branch);
  assert.equal(result.pullRequest.draft, false);
  assert.equal(result.authority.reviewExecutionAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pullRequest), true);
});

test('preserves draft truth while keeping provider-neutral review zero-authority', () => {
  const result = buildIndependentReviewWorkflowDispatchPreflightV1(validInput({ draft: true }));
  assert.equal(result.verdict, 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PASS');
  assert.equal(result.pullRequest.state, 'open');
  assert.equal(result.pullRequest.draft, true);
  assert.equal(result.authority.reviewExecutionAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.approvalAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.deploymentAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
  assert.equal(result.authority.providerQualificationAllowed, false);
  assert.equal(result.authority.leaseSeizureAllowed, false);
  assert.equal(result.authority.arbitraryCommandAllowed, false);
});

test('fails closed if the workflow run, dispatch inputs or live pull request identity drift', () => {
  const wrongEvent = validInput();
  wrongEvent.environment = environment({ GITHUB_EVENT_NAME: 'schedule' });
  assert.throws(() => buildIndependentReviewWorkflowDispatchPreflightV1(wrongEvent), /workflow dispatch run identity/);

  const wrongInput = validInput();
  wrongInput.workflowDispatchInputs = { ...wrongInput.workflowDispatchInputs, source_head: '3'.repeat(40) };
  assert.throws(() => buildIndependentReviewWorkflowDispatchPreflightV1(wrongInput), /workflow dispatch run identity/);

  const closed = validInput();
  closed.pullRequest = pullRequest({ state: 'closed' });
  assert.throws(() => buildIndependentReviewWorkflowDispatchPreflightV1(closed), /pull request/);

  const malformedDraft = validInput();
  malformedDraft.pullRequest = pullRequest({ draft: 'yes' });
  assert.throws(() => buildIndependentReviewWorkflowDispatchPreflightV1(malformedDraft), /pull request/);
});
