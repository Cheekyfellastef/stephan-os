import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_REPOSITORY,
  CANONICAL_REVIEW_WORKFLOW_NAME,
  CANONICAL_REVIEW_WORKFLOW_PATH,
  INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA,
  admitIndependentReviewWorkflowDispatchV1,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';

const sourceHead = '1111111111111111111111111111111111111111';
const baseSha = '2222222222222222222222222222222222222222';
const branch = 'agent/example-independent-review-target-v1';
const prNumber = 1910;

function workflowDefinition(overrides = {}) {
  return {
    id: 123456,
    name: CANONICAL_REVIEW_WORKFLOW_NAME,
    path: CANONICAL_REVIEW_WORKFLOW_PATH,
    state: 'active',
    ...overrides,
  };
}

function handoffIdentity(overrides = {}) {
  return {
    schemaVersion: INDEPENDENT_REVIEW_HANDOFF_IDENTITY_SCHEMA,
    repository: CANONICAL_REPOSITORY,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    baseBranch: 'main',
    marker: `<!-- stephanos:exact-head-review-dispatch:v1 head=${sourceHead} -->`,
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
      repo: { full_name: CANONICAL_REPOSITORY },
    },
    base: {
      sha: baseSha,
      ref: 'main',
      repo: { full_name: CANONICAL_REPOSITORY },
    },
    ...overrides,
  };
}

function valid(overrides = {}) {
  return {
    repository: CANONICAL_REPOSITORY,
    workflowDefinition: workflowDefinition(),
    currentMainSha: baseSha,
    pullRequest: pullRequest(),
    handoffIdentity: handoffIdentity(),
    ...overrides,
  };
}

test('admits only the exact canonical review workflow for the exact current handoff', () => {
  const result = admitIndependentReviewWorkflowDispatchV1(valid());
  assert.equal(result.verdict, 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMITTED');
  assert.equal(result.binding.prNumber, prNumber);
  assert.equal(result.binding.sourceHead, sourceHead);
  assert.equal(result.binding.baseSha, baseSha);
  assert.match(result.handoffBindingSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.workflowDispatchInputs, {
    pr_number: String(prNumber),
    source_head: sourceHead,
    base_sha: baseSha,
    head_branch: branch,
    handoff_binding_sha256: result.handoffBindingSha256,
  });
  assert.equal(result.authority.reviewWorkflowDispatchAllowed, true);
  assert.equal(result.authority.reviewExecutionAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
  assert.equal(result.authority.arbitraryCommandAllowed, false);
});

test('stale current main or pull request base fails closed', () => {
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ currentMainSha: '3333333333333333333333333333333333333333' })),
    /current canonical main/,
  );
  const stalePr = pullRequest();
  stalePr.base = { ...stalePr.base, sha: '3333333333333333333333333333333333333333' };
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ pullRequest: stalePr })),
    /pull request no longer matches/,
  );
});

test('wrong head branch or head SHA fails closed', () => {
  const wrongHead = pullRequest();
  wrongHead.head = { ...wrongHead.head, sha: '4444444444444444444444444444444444444444' };
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ pullRequest: wrongHead })),
    /pull request no longer matches/,
  );
  const wrongBranch = pullRequest();
  wrongBranch.head = { ...wrongBranch.head, ref: 'agent/other' };
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ pullRequest: wrongBranch })),
    /pull request no longer matches/,
  );
});

test('cross-repository or closed pull request cannot be admitted', () => {
  const fork = pullRequest();
  fork.head = { ...fork.head, repo: { full_name: 'other/repo' } };
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ pullRequest: fork })),
    /pull request no longer matches/,
  );
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ pullRequest: pullRequest({ state: 'closed' }) })),
    /pull request no longer matches/,
  );
});

test('lookalike or inactive workflow identity cannot be admitted', () => {
  for (const workflow of [
    workflowDefinition({ id: 0 }),
    workflowDefinition({ name: 'Independent Merge Security Review Copy' }),
    workflowDefinition({ path: '.github/workflows/lookalike.yml' }),
    workflowDefinition({ state: 'disabled_manually' }),
  ]) {
    assert.throws(
      () => admitIndependentReviewWorkflowDispatchV1(valid({ workflowDefinition: workflow })),
      /workflow identity/,
    );
  }
});

test('handoff authority cannot be widened or forged', () => {
  const widened = handoffIdentity();
  widened.authority = { ...widened.authority, sourceMutationAllowed: true };
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ handoffIdentity: widened })),
    /handoff identity/,
  );
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ handoffIdentity: handoffIdentity({ repository: 'other/repo' }) })),
    /handoff identity/,
  );
});

test('unknown top-level or workflow fields fail closed', () => {
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1({ ...valid(), command: 'run anything' }),
    /closed-world schema/,
  );
  assert.throws(
    () => admitIndependentReviewWorkflowDispatchV1(valid({ workflowDefinition: { ...workflowDefinition(), url: 'https://example.test' } })),
    /workflow identity/,
  );
});

test('dispatch binding is deterministic and changes with exact identity', () => {
  const first = admitIndependentReviewWorkflowDispatchV1(valid());
  const second = admitIndependentReviewWorkflowDispatchV1(valid());
  assert.equal(first.handoffBindingSha256, second.handoffBindingSha256);

  const other = handoffIdentity({
    sourceHead: '5555555555555555555555555555555555555555',
    marker: '<!-- stephanos:exact-head-review-dispatch:v1 head=5555555555555555555555555555555555555555 -->',
  });
  const otherPr = pullRequest();
  otherPr.head = { ...otherPr.head, sha: other.sourceHead };
  const changed = admitIndependentReviewWorkflowDispatchV1(valid({ handoffIdentity: other, pullRequest: otherPr }));
  assert.notEqual(first.handoffBindingSha256, changed.handoffBindingSha256);
});
