export const INDEPENDENT_REVIEW_DISPATCH_POLICY_SCHEMA = 'stephanos.independent-review-dispatch-policy.v1';
export const INDEPENDENT_REVIEW_WORKFLOW = Object.freeze({
  name: 'Independent Merge Security Review',
  path: '.github/workflows/independent-merge-security-review.yml',
  baseBranch: 'main',
});
export const INDEPENDENT_REVIEW_DISPATCH_INPUTS = Object.freeze([
  'pr_number',
  'expected_branch',
  'expected_head',
  'expected_base',
]);

const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function sameSha(left, right) {
  return FULL_SHA.test(text(left))
    && FULL_SHA.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

function freezeAuthority() {
  return Object.freeze({
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
}

/**
 * Validate the exact trusted identity required before the existing independent
 * review workflow may be launched through a bounded workflow_dispatch route.
 *
 * This is an inert policy result. It does not dispatch the workflow.
 */
export function validateIndependentReviewDispatchPolicyV1(input = {}) {
  const repository = text(input.repository);
  const currentMain = text(input.currentMain).toLowerCase();
  const target = input.target;
  const workflow = input.workflow;
  const dispatchInputs = input.dispatchInputs;
  const blockers = [];

  if (!REPOSITORY.test(repository)) blockers.push('repository-invalid');
  if (!FULL_SHA.test(currentMain)) blockers.push('current-main-invalid');
  if (!target || typeof target !== 'object' || Array.isArray(target)) blockers.push('target-invalid');
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) blockers.push('workflow-invalid');
  if (!exactKeys(dispatchInputs, INDEPENDENT_REVIEW_DISPATCH_INPUTS)) blockers.push('dispatch-input-shape-invalid');

  const prNumber = positiveInteger(target?.prNumber);
  const branch = text(target?.branch);
  const head = text(target?.head).toLowerCase();
  const baseBranch = text(target?.baseBranch);
  const base = text(target?.base).toLowerCase();

  if (!prNumber) blockers.push('target-pr-invalid');
  if (!branch || branch === 'main' || branch.length > 255) blockers.push('target-branch-invalid');
  if (!FULL_SHA.test(head)) blockers.push('target-head-invalid');
  if (baseBranch !== INDEPENDENT_REVIEW_WORKFLOW.baseBranch) blockers.push('target-base-branch-not-main');
  if (!sameSha(base, currentMain)) blockers.push('target-base-not-current-main');

  if (text(workflow?.repository).toLowerCase() !== repository.toLowerCase()) blockers.push('workflow-repository-mismatch');
  if (text(workflow?.name) !== INDEPENDENT_REVIEW_WORKFLOW.name) blockers.push('workflow-name-mismatch');
  if (text(workflow?.path) !== INDEPENDENT_REVIEW_WORKFLOW.path) blockers.push('workflow-path-mismatch');
  if (text(workflow?.state).toLowerCase() !== 'active') blockers.push('workflow-not-active');
  if (workflow?.trustedCurrentMain !== true) blockers.push('workflow-not-trusted-current-main');
  if (workflow?.workflowDispatchEnabled !== true) blockers.push('workflow-dispatch-not-enabled');

  if (dispatchInputs && typeof dispatchInputs === 'object') {
    if (positiveInteger(dispatchInputs.pr_number) !== prNumber) blockers.push('dispatch-pr-mismatch');
    if (text(dispatchInputs.expected_branch) !== branch) blockers.push('dispatch-branch-mismatch');
    if (!sameSha(dispatchInputs.expected_head, head)) blockers.push('dispatch-head-mismatch');
    if (!sameSha(dispatchInputs.expected_base, base)) blockers.push('dispatch-base-mismatch');
  }

  const valid = blockers.length === 0;
  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_DISPATCH_POLICY_SCHEMA,
    valid,
    repository,
    prNumber,
    branch,
    head,
    baseBranch,
    base,
    workflow: Object.freeze({
      name: text(workflow?.name),
      path: text(workflow?.path),
    }),
    dispatchInputs: valid ? Object.freeze({ ...dispatchInputs }) : null,
    authority: valid ? freezeAuthority() : Object.freeze({
      workflowDispatchAllowed: false,
      reviewExecutionAllowed: false,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      markReadyAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerQualificationAllowed: false,
      leaseSeizureAllowed: false,
    }),
    blockers: Object.freeze(blockers),
    finalVerdict: valid
      ? 'INDEPENDENT_REVIEW_DISPATCH_POLICY_READY'
      : 'INDEPENDENT_REVIEW_DISPATCH_POLICY_BLOCKED',
  });
}
