import {
  INDEPENDENT_REVIEW_WORKFLOW_NAME,
  INDEPENDENT_REVIEW_WORKFLOW_PATH,
} from './operatorMergeApprovalGate.mjs';

export const INDEPENDENT_REVIEW_RETRY_SCHEMA_VERSION = 'stephanos.independent-review-retry-plan.v1';
export const INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT = 2;

export const INDEPENDENT_REVIEW_RETRY_DECISION = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NO_MATCHING_RUN: 'NO_MATCHING_RUN',
  WAIT_RUNNING: 'WAIT_RUNNING',
  ALREADY_SUCCESSFUL: 'ALREADY_SUCCESSFUL',
  RERUN_FAILED_JOBS: 'RERUN_FAILED_JOBS',
  RETRY_BUDGET_EXHAUSTED: 'RETRY_BUDGET_EXHAUSTED',
  BLOCKED_CONCLUSION: 'BLOCKED_CONCLUSION',
});

const FULL_SHA = /^[0-9a-f]{40}$/i;
const RETRYABLE_CONCLUSIONS = new Set(['failure']);
const RUNNING_STATES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function sameSha(left, right) {
  return FULL_SHA.test(text(left))
    && FULL_SHA.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

function normalizedRepository(value) {
  return text(value).toLowerCase();
}

function exactPullRequestBinding(run, pr) {
  const candidates = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
  return candidates.some((candidate) => (
    positiveInteger(candidate?.number) === positiveInteger(pr?.number)
    && text(candidate?.head?.ref) === text(pr?.headRef)
    && sameSha(candidate?.head?.sha, pr?.headSha)
    && text(candidate?.base?.ref) === 'main'
    && sameSha(candidate?.base?.sha, pr?.baseSha)
  ));
}

function exactCanonicalRun(run, { repository, workflowId, pr }) {
  return positiveInteger(run?.id) > 0
    && positiveInteger(run?.workflow_id) === workflowId
    && text(run?.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(run?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH
    && text(run?.event) === 'pull_request_target'
    && normalizedRepository(run?.repository?.full_name) === normalizedRepository(repository)
    && positiveInteger(run?.run_attempt) > 0
    && exactPullRequestBinding(run, pr);
}

function compareRuns(left, right) {
  const leftRunNumber = positiveInteger(left?.run_number);
  const rightRunNumber = positiveInteger(right?.run_number);
  if (leftRunNumber !== rightRunNumber) return leftRunNumber - rightRunNumber;
  const leftCreated = Date.parse(text(left?.created_at));
  const rightCreated = Date.parse(text(right?.created_at));
  if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }
  return positiveInteger(left?.id) - positiveInteger(right?.id);
}

function basePlan({ repository, workflowId, pr }) {
  return {
    schemaVersion: INDEPENDENT_REVIEW_RETRY_SCHEMA_VERSION,
    repository: text(repository),
    prNumber: positiveInteger(pr?.number) || null,
    branch: text(pr?.headRef),
    exactHead: text(pr?.headSha).toLowerCase(),
    exactBase: text(pr?.baseSha).toLowerCase(),
    workflowId: workflowId || null,
    workflowName: INDEPENDENT_REVIEW_WORKFLOW_NAME,
    workflowPath: INDEPENDENT_REVIEW_WORKFLOW_PATH,
    mutationAllowed: false,
    operation: 'none',
    runId: null,
    runAttempt: null,
  };
}

export function planIndependentReviewRetry(input = {}) {
  const repository = text(input.repository);
  const workflow = input.workflow || {};
  const pr = input.pr || {};
  const workflowId = positiveInteger(workflow.id);
  const base = basePlan({ repository, workflowId, pr });
  const valid = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    && workflowId > 0
    && text(workflow.name) === INDEPENDENT_REVIEW_WORKFLOW_NAME
    && text(workflow.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH
    && text(workflow.state).toLowerCase() === 'active'
    && positiveInteger(pr.number) > 0
    && text(pr.state).toLowerCase() === 'open'
    && typeof pr.draft === 'boolean'
    && pr.sameRepository === true
    && text(pr.baseRef) === 'main'
    && text(pr.headRef)
    && FULL_SHA.test(text(pr.headSha))
    && FULL_SHA.test(text(pr.baseSha));
  if (!valid) {
    return Object.freeze({
      ...base,
      decision: INDEPENDENT_REVIEW_RETRY_DECISION.INVALID_INPUT,
      reason: 'canonical workflow and exact open same-repository PR identity are required',
    });
  }

  const exactRuns = (Array.isArray(input.runs) ? input.runs : [])
    .filter((run) => exactCanonicalRun(run, { repository, workflowId, pr }))
    .sort(compareRuns);
  const run = exactRuns.at(-1) || null;
  if (!run) {
    return Object.freeze({
      ...base,
      decision: INDEPENDENT_REVIEW_RETRY_DECISION.NO_MATCHING_RUN,
      reason: 'no canonical pull_request_target review run matches the exact PR head and base',
    });
  }

  const runId = positiveInteger(run.id);
  const runAttempt = positiveInteger(run.run_attempt);
  const status = text(run.status).toLowerCase();
  const conclusion = text(run.conclusion).toLowerCase();
  const selected = {
    ...base,
    runId,
    runAttempt,
    runNumber: positiveInteger(run.run_number) || null,
    runStatus: status,
    runConclusion: conclusion || null,
  };

  if (RUNNING_STATES.has(status) || status !== 'completed') {
    return Object.freeze({
      ...selected,
      decision: INDEPENDENT_REVIEW_RETRY_DECISION.WAIT_RUNNING,
      reason: 'the latest exact canonical review run is not terminal',
    });
  }
  if (conclusion === 'success') {
    return Object.freeze({
      ...selected,
      decision: INDEPENDENT_REVIEW_RETRY_DECISION.ALREADY_SUCCESSFUL,
      reason: 'the latest exact canonical review run is already successful',
    });
  }
  if (!RETRYABLE_CONCLUSIONS.has(conclusion)) {
    return Object.freeze({
      ...selected,
      decision: INDEPENDENT_REVIEW_RETRY_DECISION.BLOCKED_CONCLUSION,
      reason: `review conclusion ${conclusion || 'unknown'} is not eligible for failed-job-only retry`,
    });
  }
  if (runAttempt >= INDEPENDENT_REVIEW_MAX_RUN_ATTEMPT) {
    return Object.freeze({
      ...selected,
      decision: INDEPENDENT_REVIEW_RETRY_DECISION.RETRY_BUDGET_EXHAUSTED,
      reason: `review attempt ${runAttempt} reached the bounded retry limit`,
    });
  }
  return Object.freeze({
    ...selected,
    decision: INDEPENDENT_REVIEW_RETRY_DECISION.RERUN_FAILED_JOBS,
    reason: 'the latest exact canonical review failed before a receipt and is eligible for one failed-job-only retry',
    mutationAllowed: true,
    operation: 'rerun-failed-jobs',
  });
}
