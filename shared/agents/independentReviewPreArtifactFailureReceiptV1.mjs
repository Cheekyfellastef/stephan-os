import { PROTECTED_REVIEW_MARKER } from './operatorMergeApprovalGate.mjs';

export const INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_SCHEMA = 'stephanos.independent-review-pre-artifact-failure.v1';
export const INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_MARKER = 'stephanos:independent-review-pre-artifact-failure:v1';

const EXACT_SHA = /^[0-9a-f]{40}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

export function planIndependentReviewPreArtifactFailureReceiptV1(input = {}) {
  const repository = text(input.repository);
  const prNumber = positiveInteger(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const workflowRunId = positiveInteger(input.workflowRunId);
  const workflowRunAttempt = positiveInteger(input.workflowRunAttempt);

  const errors = [];
  if (!SAFE_REPOSITORY.test(repository)) errors.push('INVALID_REPOSITORY');
  if (!prNumber) errors.push('INVALID_PR_NUMBER');
  if (!SAFE_BRANCH.test(branch) || branch.includes('..')) errors.push('INVALID_BRANCH');
  if (!EXACT_SHA.test(sourceHead)) errors.push('INVALID_SOURCE_HEAD');
  if (!EXACT_SHA.test(baseSha)) errors.push('INVALID_BASE_SHA');
  if (!workflowRunId) errors.push('INVALID_WORKFLOW_RUN_ID');
  if (!workflowRunAttempt) errors.push('INVALID_WORKFLOW_RUN_ATTEMPT');

  if (errors.length) return freeze({
    schemaVersion:INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_SCHEMA,
    decision:'BLOCK_INVALID_PRE_ARTIFACT_FAILURE_IDENTITY',
    publishAllowed:false,
    errors:[...new Set(errors)],
    marker:null,
    receipt:null,
  });

  const marker = `<!-- ${INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_MARKER} run=${workflowRunId} attempt=${workflowRunAttempt} head=${sourceHead} -->`;
  const receipt = {
    schemaVersion:INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_SCHEMA,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
    classification:'PRE_ARTIFACT_REVIEW_RESULT_MISSING',
    verdict:'blocked',
    blocker:'the independent review run reached terminal publication without producing the canonical independent-review result artifact',
    runIdentityHint:`github-actions-independent-review-run-${workflowRunId}-attempt-${workflowRunAttempt}`,
    authority:{
      reviewAcceptanceAllowed:false,
      reviewDispatchAllowed:false,
      sourceMutationAllowed:false,
      approvalAllowed:false,
      mergeAllowed:false,
      deploymentAllowed:false,
      runtimeMutationAllowed:false,
      providerQualificationAllowed:false,
      leaseSeizureAllowed:false,
      arbitraryCommandAllowed:false,
    },
  };

  return freeze({
    schemaVersion:INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_SCHEMA,
    decision:'PUBLISH_PRE_ARTIFACT_FAILURE_RECEIPT',
    publishAllowed:true,
    errors:[],
    marker,
    receipt,
  });
}

export function renderIndependentReviewPreArtifactFailureReceiptV1(plan = {}) {
  if (plan?.publishAllowed !== true || !plan.marker || !plan.receipt) {
    throw new Error('pre-artifact review failure receipt plan is not publishable');
  }
  return `${plan.marker}\n${PROTECTED_REVIEW_MARKER}\n## Provider-neutral independent review pre-artifact failure receipt\n\n`+
    `Run identity: \`${plan.receipt.runIdentityHint}\`\n\n`+
    '```json\n'+JSON.stringify(plan.receipt, null, 2)+'\n```\n\n'+
    'This is a fail-closed execution receipt only. It is not a clean review, approval, merge authorization, deployment authority, runtime authority or permission to dispatch a second review. The canonical coordinator may inspect this exact run and use only its existing bounded retry policy.';
}
