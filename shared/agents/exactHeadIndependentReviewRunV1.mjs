import {
  validateIndependentReviewWorkflowRun,
} from './operatorMergeApprovalGate.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER,
  parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';
import {
  discoverIndependentReviewWorkflowDispatchRunV1,
} from './independentReviewWorkflowDispatchRunDiscoveryV1.mjs';
import {
  validateIndependentReviewWorkflowDispatchExecutionV1,
} from './independentReviewWorkflowDispatchExecutionV1.mjs';

export const EXACT_HEAD_INDEPENDENT_REVIEW_RUN_SCHEMA = 'stephanos.exact-head-independent-review-run.v1';

const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  type: 'bot',
  id: 41898282,
});

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function mapGitHubIndependentReviewRunV1(run = {}) {
  return Object.freeze({
    id: run?.id ?? null,
    run_attempt: Number(run?.run_attempt ?? 0),
    workflow_id: Number(run?.workflow_id ?? 0),
    name: text(run?.name),
    display_title: text(run?.display_title),
    path: text(run?.path),
    event: text(run?.event),
    repository: Object.freeze({ full_name: text(run?.repository?.full_name) }),
    head_branch: text(run?.head_branch),
    head_sha: text(run?.head_sha),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    created_at: run?.created_at ?? null,
    updated_at: run?.updated_at ?? null,
    run_started_at: run?.run_started_at ?? null,
    pull_requests: Object.freeze(Array.isArray(run?.pull_requests)
      ? run.pull_requests.map((pullRequest) => Object.freeze({
        number: positiveInteger(pullRequest?.number),
        head: Object.freeze({
          sha: text(pullRequest?.head?.sha),
          ref: text(pullRequest?.head?.ref),
        }),
        base: Object.freeze({
          sha: text(pullRequest?.base?.sha),
          ref: text(pullRequest?.base?.ref),
        }),
      }))
      : []),
  });
}

export function mapGitHubIndependentReviewJobV1(job = {}) {
  return Object.freeze({
    id: job?.id ?? null,
    name: text(job?.name),
    run_attempt: Number(job?.run_attempt ?? 0),
    run_url: text(job?.run_url),
    status: text(job?.status),
    conclusion: text(job?.conclusion),
  });
}

function actorMatches(item, expected = TRUSTED_GITHUB_ACTIONS_REVIEWER) {
  const actor = item?.user ?? item?.author ?? {};
  return text(actor?.login).toLowerCase() === expected.login
    && text(actor?.type).toLowerCase() === expected.type
    && Number(actor?.id) === expected.id;
}

function exactLaunchReceipt(receipt, input) {
  return text(receipt?.repository) === text(input.repository)
    && positiveInteger(receipt?.prNumber) === positiveInteger(input.prNumber)
    && text(receipt?.sourceHead).toLowerCase() === text(input.expectedHead).toLowerCase()
    && text(receipt?.baseSha).toLowerCase() === text(input.expectedBaseSha).toLowerCase()
    && text(receipt?.branch) === text(input.expectedBranch)
    && positiveInteger(receipt?.workflowId) === positiveInteger(input.expectedWorkflowId);
}

function selectExactWorkflowDispatchLaunchReceipt(input = {}) {
  const receipts = [];
  let malformedTrustedReceipt = false;
  for (const comment of Array.isArray(input.comments) ? input.comments : []) {
    const body = text(comment?.body);
    if (!actorMatches(comment) || !body.includes(INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_LAUNCH_MARKER)) continue;
    try {
      const receipt = parseIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(body);
      if (exactLaunchReceipt(receipt, input)) receipts.push(receipt);
    } catch {
      malformedTrustedReceipt = true;
    }
  }
  if (malformedTrustedReceipt) {
    return Object.freeze({ receipt: null, blocker: 'dispatch-review-launch-receipt-malformed' });
  }
  if (receipts.length !== 1) {
    return Object.freeze({
      receipt: null,
      blocker: receipts.length > 1
        ? 'dispatch-review-launch-receipt-ambiguous'
        : 'dispatch-review-launch-receipt-missing',
    });
  }
  return Object.freeze({ receipt: receipts[0], blocker: '' });
}

function blocked(blockers = []) {
  return Object.freeze({
    schemaVersion: EXACT_HEAD_INDEPENDENT_REVIEW_RUN_SCHEMA,
    valid: false,
    mode: 'blocked',
    blockers: Object.freeze([...new Set(blockers.filter(Boolean))]),
    finalVerdict: 'EXACT_HEAD_INDEPENDENT_REVIEW_RUN_BLOCKED',
  });
}

function ready(mode) {
  return Object.freeze({
    schemaVersion: EXACT_HEAD_INDEPENDENT_REVIEW_RUN_SCHEMA,
    valid: true,
    mode,
    blockers: Object.freeze([]),
    finalVerdict: 'EXACT_HEAD_INDEPENDENT_REVIEW_RUN_READY',
  });
}

export function validateExactHeadIndependentReviewRunV1(input = {}) {
  const run = input.run && typeof input.run === 'object' && !Array.isArray(input.run) ? input.run : {};
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const event = text(run?.event);

  if (event !== 'workflow_dispatch') {
    const legacy = validateIndependentReviewWorkflowRun(run, jobs, {
      repository: text(input.repository),
      prNumber: positiveInteger(input.prNumber),
      expectedHead: text(input.expectedHead).toLowerCase(),
      expectedBranch: text(input.expectedBranch),
      expectedBaseBranch: text(input.expectedBaseBranch),
      expectedBaseSha: text(input.expectedBaseSha).toLowerCase(),
      expectedWorkflowId: positiveInteger(input.expectedWorkflowId),
      workflowRunId: positiveInteger(input.workflowRunId),
      workflowRunAttempt: positiveInteger(input.workflowRunAttempt),
    });
    return legacy.valid ? ready('pull_request_target') : blocked(legacy.blockers || ['legacy-review-run-invalid']);
  }

  const launchSelection = selectExactWorkflowDispatchLaunchReceipt(input);
  if (!launchSelection.receipt) return blocked([launchSelection.blocker]);
  const launchReceipt = launchSelection.receipt;

  const discovery = discoverIndependentReviewWorkflowDispatchRunV1({
    launchReceipt,
    runs: Array.isArray(input.allRuns) ? input.allRuns : [],
  });
  if (discovery.verdict !== 'DISPATCH_RUN_TERMINAL'
    || positiveInteger(discovery.runId) !== positiveInteger(input.workflowRunId)
    || positiveInteger(discovery.runAttempt) !== positiveInteger(input.workflowRunAttempt)) {
    return blocked([
      `dispatch-review-run-discovery:${text(discovery.verdict, 'UNKNOWN')}`,
      ...(Array.isArray(discovery.blockers) ? discovery.blockers : []),
    ]);
  }

  const dispatch = validateIndependentReviewWorkflowDispatchExecutionV1(run, jobs, {
    repository: text(input.repository),
    prNumber: positiveInteger(input.prNumber),
    expectedHead: text(input.expectedHead).toLowerCase(),
    expectedBranch: text(input.expectedBranch),
    expectedBaseSha: text(input.expectedBaseSha).toLowerCase(),
    expectedWorkflowId: positiveInteger(input.expectedWorkflowId),
    workflowRunId: positiveInteger(input.workflowRunId),
    workflowRunAttempt: positiveInteger(input.workflowRunAttempt),
    expectedHandoffBindingSha256: text(launchReceipt.handoffBindingSha256).toLowerCase(),
  });
  if (!dispatch.valid) return blocked(dispatch.blockers || ['dispatch-review-run-invalid']);
  if (text(run?.display_title) !== text(launchReceipt.runName)) {
    return blocked(['dispatch-review-launch-run-name-mismatch']);
  }
  return ready('workflow_dispatch');
}
