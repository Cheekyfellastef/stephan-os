export const INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_SCHEMA = 'stephanos.independent-review-workflow-final-policy.v1';

export const INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1 = Object.freeze({
  schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_SCHEMA,
  events: Object.freeze(['pull_request_target', 'workflow_dispatch']),
  workflowDispatchInputs: Object.freeze([
    'pr_number',
    'source_head',
    'base_sha',
    'head_branch',
    'handoff_binding_sha256',
    'handoff_run_receipt_sha256',
  ]),
  checkoutRefs: Object.freeze([
    Object.freeze({ expression: 'github.event.pull_request.base.sha', count: 1 }),
    Object.freeze({ expression: 'github.sha', count: 1 }),
  ]),
  checkoutCount: 2,
  permissionSignatures: Object.freeze([
    'actions:read,contents:read,issues:write,pull-requests:read',
  ]),
});

const FACT_KEYS = Object.freeze([
  'events',
  'workflowDispatchInputs',
  'checkoutRefs',
  'checkoutCount',
  'permissionSignatures',
]);

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function exactStringArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function exactCheckoutRefs(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => (
      exactKeys(value, ['expression', 'count'])
      && value.expression === expected[index].expression
      && value.count === expected[index].count
    ));
}

export function validateIndependentReviewWorkflowFinalPolicyV1(facts = {}) {
  const expected = INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_V1;
  const blockers = [];

  if (!exactKeys(facts, FACT_KEYS)) {
    blockers.push('workflow-policy-facts-schema-mismatch');
  } else {
    if (!exactStringArray(facts.events, expected.events)) blockers.push('workflow-events-not-exact');
    if (!exactStringArray(facts.workflowDispatchInputs, expected.workflowDispatchInputs)) {
      blockers.push('workflow-dispatch-inputs-not-exact');
    }
    if (!exactCheckoutRefs(facts.checkoutRefs, expected.checkoutRefs)) {
      blockers.push('workflow-checkout-refs-not-exact');
    }
    if (facts.checkoutCount !== expected.checkoutCount) blockers.push('workflow-checkout-count-not-exact');
    if (!exactStringArray(facts.permissionSignatures, expected.permissionSignatures)) {
      blockers.push('workflow-permissions-not-exact');
    }
  }

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_SCHEMA,
    verdict: blockers.length
      ? 'INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_BLOCKED'
      : 'INDEPENDENT_REVIEW_WORKFLOW_FINAL_POLICY_PASS',
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    authority: Object.freeze({
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
    }),
  });
}
