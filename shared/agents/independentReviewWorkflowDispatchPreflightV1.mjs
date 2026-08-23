import {
  CANONICAL_REPOSITORY,
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_SCHEMA,
  validateIndependentReviewWorkflowDispatchRunV1,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';

export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_SCHEMA = 'stephanos.independent-review-workflow-dispatch-preflight.v1';

const INPUT_KEYS = Object.freeze([
  'environment',
  'workflowDefinition',
  'currentMainSha',
  'pullRequest',
  'handoffIdentity',
  'handoffRunReceipt',
  'workflowDispatchInputs',
]);
const AUTHORITY_KEYS = Object.freeze([
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

function text(value) {
  return String(value ?? '').trim();
}

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
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeAuthority(value) {
  return exactKeys(value, AUTHORITY_KEYS)
    && value.reviewExecutionAllowed === true
    && value.sourceMutationAllowed === false
    && value.approvalAllowed === false
    && value.mergeAllowed === false
    && value.deploymentAllowed === false
    && value.runtimeMutationAllowed === false
    && value.providerQualificationAllowed === false
    && value.leaseSeizureAllowed === false
    && value.arbitraryCommandAllowed === false;
}

function snapshotReviewPullRequest(pullRequest, run) {
  const expectedNumber = run.prNumber;
  const headRepo = text(pullRequest?.head?.repo?.full_name);
  const baseRepo = text(pullRequest?.base?.repo?.full_name);
  if (!isPlainRecord(pullRequest)
    || Number(pullRequest.number) !== expectedNumber
    || text(pullRequest.state).toLowerCase() !== 'open'
    || typeof pullRequest.draft !== 'boolean'
    || text(pullRequest?.head?.sha).toLowerCase() !== run.sourceHead
    || text(pullRequest?.head?.ref) !== run.branch
    || text(pullRequest?.base?.sha).toLowerCase() !== run.baseSha
    || text(pullRequest?.base?.ref) !== 'main'
    || headRepo !== CANONICAL_REPOSITORY
    || baseRepo !== CANONICAL_REPOSITORY) {
    throw new Error('workflow-dispatch preflight pull request no longer matches the trusted run identity');
  }
  return Object.freeze({
    number: expectedNumber,
    state: 'open',
    draft: pullRequest.draft === true,
    head: Object.freeze({
      sha: run.sourceHead,
      ref: run.branch,
      repo: Object.freeze({ full_name: CANONICAL_REPOSITORY }),
    }),
    base: Object.freeze({
      sha: run.baseSha,
      ref: 'main',
      repo: Object.freeze({ full_name: CANONICAL_REPOSITORY }),
    }),
  });
}

export function buildIndependentReviewWorkflowDispatchPreflightV1(input = {}) {
  if (!exactKeys(input, INPUT_KEYS)) {
    throw new Error('workflow-dispatch preflight input must use the exact closed-world schema');
  }
  const run = validateIndependentReviewWorkflowDispatchRunV1(input);
  if (run.schemaVersion !== INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_SCHEMA
    || run.verdict !== 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_TRUSTED'
    || !safeAuthority(run.authority)) {
    throw new Error('workflow-dispatch run did not produce the trusted bounded review identity');
  }
  const pullRequest = snapshotReviewPullRequest(input.pullRequest, run);
  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_SCHEMA,
    verdict: 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PASS',
    repository: CANONICAL_REPOSITORY,
    prNumber: run.prNumber,
    sourceHead: run.sourceHead,
    baseSha: run.baseSha,
    branch: run.branch,
    workflowName: run.workflowName,
    workflowPath: run.workflowPath,
    workflowJob: run.job,
    handoffBindingSha256: run.handoffBindingSha256,
    handoffRunReceiptSha256: run.handoffRunReceiptSha256,
    coordinatorWorkflowRunId: run.coordinatorWorkflowRunId,
    coordinatorWorkflowRunAttempt: run.coordinatorWorkflowRunAttempt,
    handoffCommentId: run.handoffCommentId,
    pullRequest,
    authority: Object.freeze({ ...run.authority }),
  });
}
