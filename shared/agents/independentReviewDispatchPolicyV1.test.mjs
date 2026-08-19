import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_DISPATCH_INPUTS,
  validateIndependentReviewDispatchPolicyV1,
} from './independentReviewDispatchPolicyV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const currentMain = 'a8a513eaf65922eee2311b10bb3c934c45f8ef47';
const head = '1111111111111111111111111111111111111111';
const target = Object.freeze({
  prNumber: 1914,
  branch: 'fix/battle-bridge-mailbox-outbox-starvation-v1',
  head,
  baseBranch: 'main',
  base: currentMain,
});
const workflow = Object.freeze({
  repository,
  name: 'Independent Merge Security Review',
  path: '.github/workflows/independent-merge-security-review.yml',
  state: 'active',
  trustedCurrentMain: true,
  workflowDispatchEnabled: true,
});
const dispatchInputs = Object.freeze({
  pr_number: target.prNumber,
  expected_branch: target.branch,
  expected_head: target.head,
  expected_base: target.base,
});

function evaluate(overrides = {}) {
  return validateIndependentReviewDispatchPolicyV1({
    repository,
    currentMain,
    target,
    workflow,
    dispatchInputs,
    ...overrides,
  });
}

test('exact current-main target admits only bounded review dispatch authority', () => {
  const result = evaluate();
  assert.equal(result.valid, true);
  assert.equal(result.finalVerdict, 'INDEPENDENT_REVIEW_DISPATCH_POLICY_READY');
  assert.deepEqual(Object.keys(result.dispatchInputs).sort(), [...INDEPENDENT_REVIEW_DISPATCH_INPUTS].sort());
  assert.deepEqual(result.authority, {
    workflowDispatchAllowed: true,
    reviewExecutionAllowed: true,
    sourceMutationAllowed: false,
    approvalAllowed: false,
    markReadyAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerQualificationAllowed: false,
    leaseSeizureAllowed: false,
  });
});

test('stale base cannot be presented as current-main review launch', () => {
  const stale = { ...target, base: '2222222222222222222222222222222222222222' };
  const result = evaluate({ target: stale, dispatchInputs: { ...dispatchInputs, expected_base: stale.base } });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('target-base-not-current-main'));
  assert.equal(result.authority.workflowDispatchAllowed, false);
});

test('wrong PR branch head or dispatch value fails closed', () => {
  const cases = [
    { dispatchInputs: { ...dispatchInputs, pr_number: 1905 }, blocker: 'dispatch-pr-mismatch' },
    { dispatchInputs: { ...dispatchInputs, expected_branch: 'lookalike' }, blocker: 'dispatch-branch-mismatch' },
    { dispatchInputs: { ...dispatchInputs, expected_head: '3333333333333333333333333333333333333333' }, blocker: 'dispatch-head-mismatch' },
    { dispatchInputs: { ...dispatchInputs, expected_base: '4444444444444444444444444444444444444444' }, blocker: 'dispatch-base-mismatch' },
  ];
  for (const fixture of cases) {
    const result = evaluate({ dispatchInputs: fixture.dispatchInputs });
    assert.equal(result.valid, false, fixture.blocker);
    assert.ok(result.blockers.includes(fixture.blocker), fixture.blocker);
  }
});

test('lookalike or cross-repository workflow fails closed', () => {
  for (const changed of [
    { repository: 'Other/stephan-os' },
    { name: 'Independent Merge Security Review Copy' },
    { path: '.github/workflows/lookalike.yml' },
    { state: 'disabled_manually' },
    { trustedCurrentMain: false },
    { workflowDispatchEnabled: false },
  ]) {
    const result = evaluate({ workflow: { ...workflow, ...changed } });
    assert.equal(result.valid, false, JSON.stringify(changed));
    assert.equal(result.authority.workflowDispatchAllowed, false);
  }
});

test('non-main or malformed target identity cannot launch review', () => {
  const nonMain = evaluate({ target: { ...target, baseBranch: 'release' } });
  assert.ok(nonMain.blockers.includes('target-base-branch-not-main'));

  const mainAsFeature = evaluate({ target: { ...target, branch: 'main' } });
  assert.ok(mainAsFeature.blockers.includes('target-branch-invalid'));

  const malformed = evaluate({ target: { ...target, head: 'short' } });
  assert.ok(malformed.blockers.includes('target-head-invalid'));
});

test('dispatch input shape is closed and cannot smuggle authority', () => {
  const result = evaluate({
    dispatchInputs: {
      ...dispatchInputs,
      merge: true,
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('dispatch-input-shape-invalid'));
  assert.equal(result.authority.mergeAllowed, false);
});

test('policy result is inert and never widens consequential authority', () => {
  const result = evaluate();
  for (const key of [
    'sourceMutationAllowed',
    'approvalAllowed',
    'markReadyAllowed',
    'mergeAllowed',
    'deploymentAllowed',
    'runtimeMutationAllowed',
    'providerQualificationAllowed',
    'leaseSeizureAllowed',
  ]) {
    assert.equal(result.authority[key], false, key);
  }
});
