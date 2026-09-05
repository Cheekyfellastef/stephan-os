export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_EXECUTION_SCHEMA = 'stephanos.independent-review-workflow-dispatch-execution.v1';

const WORKFLOW_NAME = 'Independent Merge Security Review';
const WORKFLOW_PATH = '.github/workflows/independent-merge-security-review.yml';
const REVIEW_JOB = 'independent-security-review';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function workflowRepository(run = {}) {
  return text(run?.repository?.full_name || run?.repository);
}

function canonicalPath(run = {}, repository = '') {
  let path = text(run?.path);
  if (repository && path.startsWith(`${repository}/`)) path = path.slice(repository.length + 1);
  const at = path.indexOf('@');
  if (at === -1) return path;
  if (at === 0 || at === path.length - 1 || path.indexOf('@', at + 1) !== -1) return '';
  const ref = path.slice(at + 1);
  if (!['main', 'refs/heads/main'].includes(ref)) return '';
  return path.slice(0, at);
}

function expectedRunNamePattern(prNumber, sourceHead) {
  return new RegExp(`^stephanos-independent-review-pr-${prNumber}-head-${sourceHead}-binding-([a-f0-9]{64})$`);
}

export function validateIndependentReviewWorkflowDispatchExecutionV1(run = {}, jobs = [], options = {}) {
  const repository = text(options.repository);
  const prNumber = positiveInteger(options.prNumber);
  const expectedHead = text(options.expectedHead).toLowerCase();
  const expectedBranch = text(options.expectedBranch);
  const expectedBaseSha = text(options.expectedBaseSha).toLowerCase();
  const expectedWorkflowId = positiveInteger(options.expectedWorkflowId);
  const workflowRunId = positiveInteger(options.workflowRunId);
  const workflowRunAttempt = positiveInteger(options.workflowRunAttempt);
  const expectedHandoffBindingSha256 = text(options.expectedHandoffBindingSha256).toLowerCase();
  const blockers = [];

  if (!repository) blockers.push('dispatch-review-repository-invalid');
  if (!prNumber) blockers.push('dispatch-review-pr-invalid');
  if (!SHA40.test(expectedHead)) blockers.push('dispatch-review-head-invalid');
  if (!expectedBranch) blockers.push('dispatch-review-branch-invalid');
  if (!SHA40.test(expectedBaseSha)) blockers.push('dispatch-review-base-invalid');
  if (!expectedWorkflowId) blockers.push('dispatch-review-workflow-id-invalid');
  if (!workflowRunId) blockers.push('dispatch-review-run-id-invalid');
  if (!workflowRunAttempt) blockers.push('dispatch-review-run-attempt-invalid');
  if (expectedHandoffBindingSha256 && !SHA256.test(expectedHandoffBindingSha256)) {
    blockers.push('dispatch-review-expected-handoff-binding-invalid');
  }

  if (positiveInteger(run?.id) !== workflowRunId) blockers.push('dispatch-review-run-id-mismatch');
  if (positiveInteger(run?.run_attempt) !== workflowRunAttempt) blockers.push('dispatch-review-run-attempt-mismatch');
  if (positiveInteger(run?.workflow_id) !== expectedWorkflowId) blockers.push('dispatch-review-workflow-id-mismatch');
  if (canonicalPath(run, repository) !== WORKFLOW_PATH) blockers.push('dispatch-review-workflow-path-mismatch');
  if (text(run?.event) !== 'workflow_dispatch') blockers.push('dispatch-review-event-mismatch');
  if (workflowRepository(run) !== repository) blockers.push('dispatch-review-repository-mismatch');
  if (text(run?.head_branch) !== 'main') blockers.push('dispatch-review-trusted-branch-mismatch');
  if (text(run?.head_sha).toLowerCase() !== expectedBaseSha) blockers.push('dispatch-review-trusted-base-mismatch');
  if (text(run?.status).toLowerCase() !== 'completed' || text(run?.conclusion).toLowerCase() !== 'success') {
    blockers.push('dispatch-review-run-not-green');
  }
  if (!Array.isArray(run?.pull_requests) || run.pull_requests.length !== 0) {
    blockers.push('dispatch-review-pr-association-not-empty');
  }

  const displayTitle = text(run?.display_title);
  const titleMatch = prNumber && SHA40.test(expectedHead)
    ? displayTitle.match(expectedRunNamePattern(prNumber, expectedHead))
    : null;
  const observedHandoffBindingSha256 = text(titleMatch?.[1]).toLowerCase();
  if (!titleMatch) blockers.push('dispatch-review-run-name-binding-mismatch');
  const runName = text(run?.name);
  const exactAllowedRunName = runName === WORKFLOW_NAME || (Boolean(titleMatch) && runName === displayTitle);
  if (!exactAllowedRunName) blockers.push('dispatch-review-workflow-name-mismatch');
  if (expectedHandoffBindingSha256
    && observedHandoffBindingSha256 !== expectedHandoffBindingSha256) {
    blockers.push('dispatch-review-handoff-binding-mismatch');
  }

  const reviewJobs = (Array.isArray(jobs) ? jobs : []).filter((job) => (
    text(job?.name) === REVIEW_JOB
    && positiveInteger(job?.run_attempt) === workflowRunAttempt
  ));
  const reviewJob = reviewJobs[0];
  if (reviewJobs.length !== 1) blockers.push('dispatch-review-job-count-not-one');
  if (!reviewJob
    || text(reviewJob?.status).toLowerCase() !== 'completed'
    || text(reviewJob?.conclusion).toLowerCase() !== 'success'
    || (text(reviewJob?.run_url) && !text(reviewJob.run_url).endsWith(`/actions/runs/${workflowRunId}`))) {
    blockers.push('dispatch-review-job-not-green');
  }

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_EXECUTION_SCHEMA,
    valid: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    handoffBindingSha256: observedHandoffBindingSha256,
    finalVerdict: blockers.length
      ? 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_EXECUTION_BLOCKED'
      : 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_EXECUTION_READY',
    authority: Object.freeze({
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      arbitraryCommandAllowed: false,
    }),
  });
}
