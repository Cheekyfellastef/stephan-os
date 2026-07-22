export const OPERATOR_MERGE_HEAD_STATUS_CONTEXT = 'operator-approval-gate';
export const OPERATOR_MERGE_HEAD_STATUS_PENDING_JOB = 'operator-approval-head-status-pending';
export const OPERATOR_MERGE_HEAD_STATUS_SUCCESS_JOB = 'operator-approval-head-status-success';
export const OPERATOR_MERGE_HEAD_STATUS_GATE_JOB = 'operator-approval-gate';

const SHA_PATTERN = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, ...details });
}

function expectedJob(mode) {
  if (mode === 'pending') return OPERATOR_MERGE_HEAD_STATUS_PENDING_JOB;
  if (mode === 'success') return OPERATOR_MERGE_HEAD_STATUS_SUCCESS_JOB;
  return '';
}

export function validateOperatorMergeHeadStatusExecution(input = {}) {
  const mode = text(input.mode).toLowerCase();
  const job = text(input.job);
  const repository = text(input.repository);
  const eventName = text(input.eventName);
  const runId = integer(input.runId);
  const runAttempt = integer(input.runAttempt);
  const event = input.event || {};
  const pullRequest = input.pullRequest || {};
  const mainRef = input.mainRef || {};

  if (!['pending', 'success'].includes(mode)) return fail('HEAD_STATUS_MODE_INVALID');
  if (job !== expectedJob(mode)) return fail('HEAD_STATUS_JOB_IDENTITY_MISMATCH', { expectedJob: expectedJob(mode), job });
  if (eventName !== 'pull_request_target') return fail('HEAD_STATUS_EVENT_INVALID');
  if (!repository || repository !== text(event?.repository?.full_name)) return fail('HEAD_STATUS_REPOSITORY_MISMATCH');
  if (!runId || !runAttempt) return fail('HEAD_STATUS_RUN_IDENTITY_MISSING');

  const prNumber = integer(event?.pull_request?.number);
  const sourceHead = text(event?.pull_request?.head?.sha).toLowerCase();
  const baseSha = text(event?.pull_request?.base?.sha).toLowerCase();
  const branch = text(event?.pull_request?.head?.ref);
  const baseBranch = text(event?.pull_request?.base?.ref);
  const headRepository = text(event?.pull_request?.head?.repo?.full_name);
  if (!prNumber || !SHA_PATTERN.test(sourceHead) || !SHA_PATTERN.test(baseSha)
    || !branch || baseBranch !== 'main' || headRepository !== repository) {
    return fail('HEAD_STATUS_EVENT_IDENTITY_INVALID');
  }

  if (integer(pullRequest?.number) !== prNumber
    || text(pullRequest?.state).toLowerCase() !== 'open'
    || text(pullRequest?.head?.sha).toLowerCase() !== sourceHead
    || text(pullRequest?.head?.ref) !== branch
    || text(pullRequest?.head?.repo?.full_name) !== repository
    || text(pullRequest?.base?.sha).toLowerCase() !== baseSha
    || text(pullRequest?.base?.ref) !== 'main') {
    return fail('HEAD_STATUS_PULL_REQUEST_IDENTITY_CHANGED');
  }
  if (text(mainRef?.object?.sha).toLowerCase() !== baseSha) {
    return fail('HEAD_STATUS_LIVE_BASE_CHANGED');
  }

  if (mode === 'success') {
    const gateJob = (Array.isArray(input.jobs) ? input.jobs : [])
      .find((candidate) => text(candidate?.name) === OPERATOR_MERGE_HEAD_STATUS_GATE_JOB);
    if (!gateJob || text(gateJob?.status) !== 'completed' || text(gateJob?.conclusion) !== 'success') {
      return fail('HEAD_STATUS_PROTECTED_GATE_NOT_SUCCESSFUL');
    }
  }

  return Object.freeze({
    ok: true,
    mode,
    repository,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    baseBranch: 'main',
    runId,
    runAttempt,
  });
}

export function buildOperatorMergeHeadStatusPayload({ mode, runUrl } = {}) {
  const normalizedMode = text(mode).toLowerCase();
  const targetUrl = text(runUrl);
  if (!['pending', 'success'].includes(normalizedMode) || !/^https:\/\//.test(targetUrl)) {
    return fail('HEAD_STATUS_PAYLOAD_INPUT_INVALID');
  }
  return Object.freeze({
    ok: true,
    state: normalizedMode,
    context: OPERATOR_MERGE_HEAD_STATUS_CONTEXT,
    description: normalizedMode === 'pending'
      ? 'Waiting for protected operator environment approval.'
      : 'Protected exact-head operator approval completed.',
    target_url: targetUrl,
  });
}

export function validateOperatorMergeHeadStatusReadback(statuses = [], {
  expectedState,
  expectedSha,
  expectedRunUrl,
} = {}) {
  const state = text(expectedState).toLowerCase();
  const sha = text(expectedSha).toLowerCase();
  const runUrl = text(expectedRunUrl);
  if (!['pending', 'success'].includes(state) || !SHA_PATTERN.test(sha) || !runUrl) {
    return fail('HEAD_STATUS_READBACK_EXPECTATION_INVALID');
  }
  const status = (Array.isArray(statuses) ? statuses : [])
    .find((candidate) => text(candidate?.context) === OPERATOR_MERGE_HEAD_STATUS_CONTEXT);
  if (!status) return fail('HEAD_STATUS_CONTEXT_MISSING');
  if (text(status?.state).toLowerCase() !== state) return fail('HEAD_STATUS_STATE_MISMATCH');
  if (text(status?.sha).toLowerCase() !== sha) return fail('HEAD_STATUS_SHA_MISMATCH');
  if (text(status?.target_url) !== runUrl) return fail('HEAD_STATUS_RUN_IDENTITY_MISMATCH');
  return Object.freeze({
    ok: true,
    context: OPERATOR_MERGE_HEAD_STATUS_CONTEXT,
    state,
    sha,
    targetUrl: runUrl,
  });
}
