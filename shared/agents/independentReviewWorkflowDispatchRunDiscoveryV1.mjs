import {
  validateIndependentReviewWorkflowDispatchLaunchReceiptV1,
} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';

export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_DISCOVERY_SCHEMA = 'stephanos.independent-review-workflow-dispatch-run-discovery.v1';

const RUNNING = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
const TERMINAL = new Set(['completed']);
const GITHUB_TIMESTAMP_PRECISION_MS = 1000;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizedRepository(value) {
  return text(value).toLowerCase();
}

function compareRuns(left, right) {
  const leftTime = Date.parse(text(left?.created_at));
  const rightTime = Date.parse(text(right?.created_at));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return positiveInteger(left?.id) - positiveInteger(right?.id);
}

function sameOrLaterGithubTimestamp(runCreatedAt, requestedAtUtc) {
  const createdAt = Date.parse(text(runCreatedAt));
  const requestedAt = Date.parse(text(requestedAtUtc));
  return Number.isFinite(createdAt)
    && Number.isFinite(requestedAt)
    && Math.floor(createdAt / GITHUB_TIMESTAMP_PRECISION_MS)
      >= Math.floor(requestedAt / GITHUB_TIMESTAMP_PRECISION_MS);
}

function exactDispatchRun(run, receipt) {
  const runName = text(run?.name);
  const exactAllowedRunName = runName === receipt.workflowName || runName === receipt.runName;
  return positiveInteger(run?.id) > 0
    && positiveInteger(run?.workflow_id) === receipt.workflowId
    && exactAllowedRunName
    && text(run?.path) === receipt.workflowPath
    && text(run?.event) === 'workflow_dispatch'
    && normalizedRepository(run?.repository?.full_name) === normalizedRepository(receipt.repository)
    && text(run?.head_branch) === 'main'
    && text(run?.head_sha).toLowerCase() === receipt.baseSha
    && text(run?.display_title) === receipt.runName
    && sameOrLaterGithubTimestamp(run?.created_at, receipt.requestedAtUtc);
}

export function discoverIndependentReviewWorkflowDispatchRunV1(input = {}) {
  const receipt = validateIndependentReviewWorkflowDispatchLaunchReceiptV1(input.launchReceipt);
  const candidates = (Array.isArray(input.runs) ? input.runs : [])
    .filter((run) => exactDispatchRun(run, receipt))
    .sort(compareRuns);

  if (candidates.length > 1) {
    return Object.freeze({
      schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_DISCOVERY_SCHEMA,
      verdict: 'AMBIGUOUS_DISPATCH_RUNS',
      launchKeySha256: receipt.launchKeySha256,
      runId: null,
      runAttempt: null,
      status: null,
      conclusion: null,
      blockers: Object.freeze(['multiple exact workflow-dispatch runs match one launch receipt']),
    });
  }
  const run = candidates[0] || null;
  if (!run) {
    return Object.freeze({
      schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_DISCOVERY_SCHEMA,
      verdict: 'DISPATCH_RUN_NOT_YET_OBSERVED',
      launchKeySha256: receipt.launchKeySha256,
      runId: null,
      runAttempt: null,
      status: null,
      conclusion: null,
      blockers: Object.freeze([]),
    });
  }

  const status = text(run.status).toLowerCase();
  const conclusion = text(run.conclusion).toLowerCase() || null;
  if (!RUNNING.has(status) && !TERMINAL.has(status)) {
    return Object.freeze({
      schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_DISCOVERY_SCHEMA,
      verdict: 'DISPATCH_RUN_STATE_BLOCKED',
      launchKeySha256: receipt.launchKeySha256,
      runId: positiveInteger(run.id),
      runAttempt: positiveInteger(run.run_attempt) || null,
      status,
      conclusion,
      blockers: Object.freeze([`unsupported workflow-dispatch run status: ${status || 'unknown'}`]),
    });
  }

  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_RUN_DISCOVERY_SCHEMA,
    verdict: status === 'completed' ? 'DISPATCH_RUN_TERMINAL' : 'DISPATCH_RUN_RUNNING',
    launchKeySha256: receipt.launchKeySha256,
    runId: positiveInteger(run.id),
    runAttempt: positiveInteger(run.run_attempt) || null,
    status,
    conclusion,
    blockers: Object.freeze([]),
  });
}
