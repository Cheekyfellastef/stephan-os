import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1,
  validateIndependentReviewWorkflowFinalPolicyV1,
} from './independentReviewWorkflowFinalPolicyV1.mjs';

function facts() {
  return {
    events: [...INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1.events],
    workflowDispatchInputs: [...INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1.workflowDispatchInputs],
    checkoutRefs: INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1.checkoutRefs.map((entry) => ({ ...entry })),
    checkoutCount: INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1.checkoutCount,
    permissionSignatures: [...INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1.permissionSignatures],
  };
}

test('accepts only the exact two-event six-input reviewer workflow policy', () => {
  const result = validateIndependentReviewWorkflowFinalPolicyV1(facts());
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_PASS');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.authority.reviewExecutionAllowed, false);
  assert.equal(result.authority.reviewWorkflowDispatchAllowed, false);
  assert.equal(Object.isFrozen(result), true);
});

test('fails closed on trigger, input, checkout, permission or schema widening', () => {
  const mutations = [
    (value) => value.events.push('schedule'),
    (value) => value.events.reverse(),
    (value) => value.workflowDispatchInputs.push('command'),
    (value) => { value.workflowDispatchInputs[0] = 'pr'; },
    (value) => value.checkoutRefs.push({ expression: 'github.event.pull_request.head.sha', count: 1 }),
    (value) => { value.checkoutRefs[1].expression = 'github.event.repository.default_branch'; },
    (value) => { value.checkoutCount = 3; },
    (value) => value.permissionSignatures.push('contents:write'),
    (value) => { value.permissionSignatures[0] = 'actions:write,contents:read,issues:write,pull-requests:read'; },
    (value) => { value.command = 'gh workflow run'; },
  ];

  for (const mutate of mutations) {
    const value = facts();
    mutate(value);
    const result = validateIndependentReviewWorkflowFinalPolicyV1(value);
    assert.equal(result.valid, false);
    assert.ok(result.blockers.length > 0);
  }
});

test('rejects non-data checkout records and keeps all authority false', () => {
  const value = facts();
  const exotic = Object.create({ inherited: true });
  exotic.expression = 'github.sha';
  exotic.count = 1;
  value.checkoutRefs[1] = exotic;

  const result = validateIndependentReviewWorkflowFinalPolicyV1(value);
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('workflow-checkout-refs-not-exact'));
  assert.deepEqual(result.authority, {
    reviewExecutionAllowed: false,
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
