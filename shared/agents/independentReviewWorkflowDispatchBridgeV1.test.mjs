import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIndependentReviewWorkflowDispatchBridgeV1,
  validateIndependentReviewWorkflowDispatchBridgePreflightV1,
} from './independentReviewWorkflowDispatchBridgeV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const branch = 'fix/ignition-canonical-convergence-gate-v1';

function preflight(overrides = {}) {
  return {
    schemaVersion: 'stephanos.independent-review-workflow-dispatch-preflight.v1',
    verdict: 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PASS',
    repository,
    prNumber: 1919,
    sourceHead,
    baseSha,
    branch,
    workflowName: 'Independent Merge Security Review',
    workflowPath: '.github/workflows/independent-merge-security-review.yml',
    workflowJob: 'independent-security-review',
    handoffBindingSha256: 'c'.repeat(64),
    handoffRunReceiptSha256: 'd'.repeat(64),
    coordinatorWorkflowRunId: 32580358680,
    coordinatorWorkflowRunAttempt: 1,
    handoffCommentId: 5381041638,
    pullRequest: {
      number: 1919,
      state: 'open',
      draft: false,
      head: { sha: sourceHead, ref: branch, repo: { full_name: repository } },
      base: { sha: baseSha, ref: 'main', repo: { full_name: repository } },
    },
    authority: {
      reviewExecutionAllowed: true,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      leaseSeizureAllowed: false,
      arbitraryCommandAllowed: false,
    },
    ...overrides,
  };
}

test('trusted dispatch preflight becomes only a read-only synthetic pull_request_target event', () => {
  const bridge = buildIndependentReviewWorkflowDispatchBridgeV1(preflight(), { repository });
  assert.equal(bridge.syntheticEventName, 'pull_request_target');
  assert.equal(bridge.syntheticEvent.repository.full_name, repository);
  assert.equal(bridge.syntheticEvent.pull_request.number, 1919);
  assert.equal(bridge.syntheticEvent.pull_request.head.sha, sourceHead);
  assert.equal(bridge.syntheticEvent.pull_request.base.sha, baseSha);
  assert.equal(bridge.authority.reviewExecutionAllowed, true);
  assert.equal(bridge.authority.sourceMutationAllowed, false);
  assert.equal(bridge.authority.mergeAllowed, false);
  assert.equal(bridge.authority.runtimeMutationAllowed, false);
});

test('dispatch bridge fails closed on identity, authority or snapshot drift', () => {
  for (const candidate of [
    preflight({ sourceHead: 'f'.repeat(39) }),
    preflight({ baseSha: 'f'.repeat(39) }),
    preflight({ workflowJob: 'other-job' }),
    preflight({ handoffBindingSha256: 'x'.repeat(64) }),
    preflight({ authority: { ...preflight().authority, mergeAllowed: true } }),
    preflight({ pullRequest: { ...preflight().pullRequest, number: 1920 } }),
    preflight({ pullRequest: {
      ...preflight().pullRequest,
      base: { ...preflight().pullRequest.base, sha: 'e'.repeat(40) },
    } }),
  ]) {
    assert.equal(
      validateIndependentReviewWorkflowDispatchBridgePreflightV1(candidate, { repository }).valid,
      false,
    );
  }
});

test('dispatch bridge rejects open-world preflight fields', () => {
  const candidate = preflight();
  candidate.unexpectedAuthority = true;
  const validation = validateIndependentReviewWorkflowDispatchBridgePreflightV1(candidate, { repository });
  assert.equal(validation.valid, false);
  assert.ok(validation.blockers.includes('dispatch-bridge-preflight-schema-not-exact'));
});
