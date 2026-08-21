import {
  INDEPENDENT_REVIEW_RETRY_DECISION,
} from './independentReviewRetryPlanner.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMISSION_SCHEMA,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';

export const INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_SCHEMA = 'stephanos.independent-review-missing-run-launch.v1';
export const INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION = Object.freeze({
  LAUNCH_MISSING_RUN: 'LAUNCH_MISSING_RUN',
  SUPPRESS_EXISTING_RUN: 'SUPPRESS_EXISTING_RUN',
  BLOCKED: 'BLOCKED',
});

const FULL_SHA = /^[0-9a-f]{40}$/i;
const FULL_DIGEST = /^[0-9a-f]{64}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;
const AUTHORITY_KEYS = Object.freeze([
  'reviewWorkflowDispatchAllowed',
  'reviewExecutionAllowed',
  'sourceMutationAllowed',
  'approvalAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'providerQualificationAllowed',
  'leaseSeizureAllowed',
  'arbitraryCommandAllowed',
]);
const DISPATCH_INPUT_KEYS = Object.freeze([
  'pr_number',
  'source_head',
  'base_sha',
  'head_branch',
  'handoff_binding_sha256',
  'handoff_run_receipt_sha256',
]);

function text(value) {
  return String(value ?? '').trim();
}

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function exactFalse(value) {
  return value === false;
}

function safeAuthority(authority) {
  return hasExactKeys(authority, AUTHORITY_KEYS)
    && authority.reviewWorkflowDispatchAllowed === true
    && authority.reviewExecutionAllowed === true
    && exactFalse(authority.sourceMutationAllowed)
    && exactFalse(authority.approvalAllowed)
    && exactFalse(authority.mergeAllowed)
    && exactFalse(authority.deploymentAllowed)
    && exactFalse(authority.runtimeMutationAllowed)
    && exactFalse(authority.providerQualificationAllowed)
    && exactFalse(authority.leaseSeizureAllowed)
    && exactFalse(authority.arbitraryCommandAllowed);
}

function exactDispatchInputs(admission, retryPlan) {
  const inputs = admission?.workflowDispatchInputs;
  const binding = admission?.binding;
  if (!hasExactKeys(inputs, DISPATCH_INPUT_KEYS) || !isPlainRecord(binding)) return false;

  const repository = text(retryPlan?.repository);
  const branch = text(retryPlan?.branch);
  const prNumber = retryPlan?.prNumber;
  const exactHead = text(retryPlan?.exactHead).toLowerCase();
  const exactBase = text(retryPlan?.exactBase).toLowerCase();
  const handoffBindingSha256 = text(admission?.handoffBindingSha256).toLowerCase();
  const handoffRunReceiptSha256 = text(binding?.handoffRunReceiptSha256).toLowerCase();

  return repository
    && SAFE_BRANCH.test(branch)
    && text(binding.repository) === repository
    && text(binding.branch) === branch
    && binding.prNumber === prNumber
    && text(binding.sourceHead).toLowerCase() === exactHead
    && text(binding.baseSha).toLowerCase() === exactBase
    && inputs.pr_number === String(prNumber)
    && text(inputs.source_head).toLowerCase() === exactHead
    && text(inputs.base_sha).toLowerCase() === exactBase
    && inputs.head_branch === branch
    && text(inputs.handoff_binding_sha256).toLowerCase() === handoffBindingSha256
    && text(inputs.handoff_run_receipt_sha256).toLowerCase() === handoffRunReceiptSha256;
}

function base(input = {}) {
  const retryPlan = input.retryPlan || {};
  const admission = input.dispatchAdmission || {};
  return {
    schemaVersion: INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_SCHEMA,
    repository: text(retryPlan.repository),
    prNumber: retryPlan.prNumber ?? null,
    sourceHead: text(retryPlan.exactHead).toLowerCase(),
    baseSha: text(retryPlan.exactBase).toLowerCase(),
    workflowId: retryPlan.workflowId ?? null,
    handoffBindingSha256: text(admission.handoffBindingSha256).toLowerCase(),
    operation: 'none',
    mutationAllowed: false,
  };
}

export function planIndependentReviewMissingRunLaunchV1(input = {}) {
  const retryPlan = input.retryPlan || {};
  const admission = input.dispatchAdmission || {};
  const result = base(input);

  if (retryPlan.decision !== INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN) {
    return Object.freeze({
      ...result,
      decision: INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.SUPPRESS_EXISTING_RUN,
      reason: 'an exact canonical review run exists or retry planning is not in the missing-run state',
    });
  }

  if (text(admission.schemaVersion) !== INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMISSION_SCHEMA
    || text(admission.verdict) !== 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_ADMITTED'
    || !safeAuthority(admission.authority)
    || !Number.isSafeInteger(retryPlan.prNumber)
    || retryPlan.prNumber <= 0
    || !FULL_SHA.test(text(retryPlan.exactHead))
    || !FULL_SHA.test(text(retryPlan.exactBase))
    || !SAFE_BRANCH.test(text(retryPlan.branch))
    || text(admission.binding?.repository) !== text(retryPlan.repository)
    || admission.binding?.prNumber !== retryPlan.prNumber
    || text(admission.binding?.branch) !== text(retryPlan.branch)
    || text(admission.binding?.sourceHead).toLowerCase() !== text(retryPlan.exactHead).toLowerCase()
    || text(admission.binding?.baseSha).toLowerCase() !== text(retryPlan.exactBase).toLowerCase()
    || admission.binding?.workflowId !== retryPlan.workflowId
    || !FULL_DIGEST.test(text(admission.handoffBindingSha256).toLowerCase())
    || !FULL_DIGEST.test(text(admission.binding?.handoffRunReceiptSha256).toLowerCase())
    || !exactDispatchInputs(admission, retryPlan)) {
    return Object.freeze({
      ...result,
      decision: INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.BLOCKED,
      reason: 'exact immutable dispatch admission does not match the missing-run retry identity',
    });
  }

  return Object.freeze({
    ...result,
    decision: INDEPENDENT_REVIEW_MISSING_RUN_LAUNCH_DECISION.LAUNCH_MISSING_RUN,
    reason: 'no exact review run exists and Stage-1 immutable dispatch admission matches the exact PR/head/base/workflow',
    operation: 'workflow-dispatch',
    mutationAllowed: true,
    workflowDispatchInputs: Object.freeze({ ...admission.workflowDispatchInputs }),
    requiredRevalidation: Object.freeze({
      currentMain: true,
      pullRequestIdentity: true,
      workflowIdentity: true,
      coordinatorWorkflowRun: true,
      handoffComment: true,
      coordinatorHandoffRunReceipt: true,
      exactRunAbsenceImmediatelyBeforeDispatch: true,
    }),
    authority: Object.freeze({
      reviewWorkflowDispatchAllowed: true,
      reviewExecutionAllowed: true,
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
