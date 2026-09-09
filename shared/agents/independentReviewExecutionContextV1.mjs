import {
  CANONICAL_REPOSITORY,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';
import {
  INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_SCHEMA,
} from './independentReviewWorkflowDispatchPreflightV1.mjs';

export const INDEPENDENT_REVIEW_EXECUTION_CONTEXT_SCHEMA = 'stephanos.independent-review-execution-context.v1';

const INPUT_KEYS = Object.freeze([
  'eventName',
  'repository',
  'job',
  'legacyEvent',
  'dispatchPreflight',
]);
const PREFLIGHT_KEYS = Object.freeze([
  'schemaVersion',
  'verdict',
  'repository',
  'prNumber',
  'sourceHead',
  'baseSha',
  'branch',
  'workflowName',
  'workflowPath',
  'workflowJob',
  'handoffBindingSha256',
  'handoffRunReceiptSha256',
  'coordinatorWorkflowRunId',
  'coordinatorWorkflowRunAttempt',
  'handoffCommentId',
  'pullRequest',
  'authority',
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
const FULL_SHA = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
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
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha(value) {
  const normalized = text(value).toLowerCase();
  return FULL_SHA.test(normalized) ? normalized : '';
}

function safeReviewAuthority(authority) {
  return exactKeys(authority, AUTHORITY_KEYS)
    && authority.reviewExecutionAllowed === true
    && authority.sourceMutationAllowed === false
    && authority.approvalAllowed === false
    && authority.mergeAllowed === false
    && authority.deploymentAllowed === false
    && authority.runtimeMutationAllowed === false
    && authority.providerQualificationAllowed === false
    && authority.leaseSeizureAllowed === false
    && authority.arbitraryCommandAllowed === false;
}

function frozenAuthority() {
  return Object.freeze({
    reviewExecutionAllowed: true,
    sourceMutationAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    providerQualificationAllowed: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function snapshotPullRequest(pullRequest, { prNumber, sourceHead, baseSha, branch }) {
  const headRepository = text(pullRequest?.head?.repo?.full_name);
  const baseRepository = text(pullRequest?.base?.repo?.full_name);
  if (!isPlainRecord(pullRequest)
    || positiveInteger(pullRequest.number) !== prNumber
    || text(pullRequest?.head?.ref) !== branch
    || sha(pullRequest?.head?.sha) !== sourceHead
    || text(pullRequest?.base?.ref) !== 'main'
    || sha(pullRequest?.base?.sha) !== baseSha
    || headRepository !== CANONICAL_REPOSITORY
    || baseRepository !== CANONICAL_REPOSITORY) {
    throw new Error('independent review pull request identity is incomplete, cross-repository or mismatched');
  }
  return Object.freeze({
    number: prNumber,
    head: Object.freeze({
      ref: branch,
      sha: sourceHead,
      repo: Object.freeze({ full_name: CANONICAL_REPOSITORY }),
    }),
    base: Object.freeze({
      ref: 'main',
      sha: baseSha,
      repo: Object.freeze({ full_name: CANONICAL_REPOSITORY }),
    }),
  });
}

function legacyContext(input) {
  if (!isPlainRecord(input.legacyEvent) || input.dispatchPreflight !== null) {
    throw new Error('pull_request_target review requires only the legacy event payload');
  }
  const event = input.legacyEvent;
  const prNumber = positiveInteger(event?.pull_request?.number);
  const sourceHead = sha(event?.pull_request?.head?.sha);
  const baseSha = sha(event?.pull_request?.base?.sha);
  const branch = text(event?.pull_request?.head?.ref);
  const baseBranch = text(event?.pull_request?.base?.ref);
  const eventRepository = text(event?.repository?.full_name);
  if (!prNumber || !sourceHead || !baseSha || !branch || baseBranch !== 'main'
    || eventRepository !== CANONICAL_REPOSITORY) {
    throw new Error('legacy independent review event identity is incomplete or unsafe');
  }
  const pullRequest = snapshotPullRequest(event.pull_request, {
    prNumber,
    sourceHead,
    baseSha,
    branch,
  });
  return Object.freeze({
    source: 'pull_request_target',
    repository: CANONICAL_REPOSITORY,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    baseBranch: 'main',
    pullRequest,
    handoffBindingSha256: null,
    handoffRunReceiptSha256: null,
    coordinatorWorkflowRunId: null,
    coordinatorWorkflowRunAttempt: null,
    handoffCommentId: null,
  });
}

function workflowDispatchContext(input) {
  if (input.legacyEvent !== null || !isPlainRecord(input.dispatchPreflight)) {
    throw new Error('workflow_dispatch review requires only the validated dispatch preflight');
  }
  const preflight = input.dispatchPreflight;
  const prNumber = positiveInteger(preflight.prNumber);
  const sourceHead = sha(preflight.sourceHead);
  const baseSha = sha(preflight.baseSha);
  const branch = text(preflight.branch);
  if (!exactKeys(preflight, PREFLIGHT_KEYS)
    || text(preflight.schemaVersion) !== INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_SCHEMA
    || text(preflight.verdict) !== 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PASS'
    || text(preflight.repository) !== CANONICAL_REPOSITORY
    || text(preflight.workflowName) !== 'Independent Merge Security Review'
    || text(preflight.workflowPath) !== '.github/workflows/independent-merge-security-review.yml'
    || text(preflight.workflowJob) !== 'independent-security-review'
    || text(preflight.pullRequest?.state).toLowerCase() !== 'open'
    || typeof preflight.pullRequest?.draft !== 'boolean'
    || !prNumber || !sourceHead || !baseSha || !branch
    || !safeReviewAuthority(preflight.authority)
    || !/^[0-9a-f]{64}$/i.test(text(preflight.handoffBindingSha256))
    || !/^[0-9a-f]{64}$/i.test(text(preflight.handoffRunReceiptSha256))
    || !positiveInteger(preflight.coordinatorWorkflowRunId)
    || !positiveInteger(preflight.coordinatorWorkflowRunAttempt)
    || !positiveInteger(preflight.handoffCommentId)) {
    throw new Error('workflow-dispatch preflight is not a complete trusted review identity');
  }
  const pullRequest = snapshotPullRequest(preflight.pullRequest, {
    prNumber,
    sourceHead,
    baseSha,
    branch,
  });
  return Object.freeze({
    source: 'workflow_dispatch',
    repository: CANONICAL_REPOSITORY,
    prNumber,
    sourceHead,
    baseSha,
    branch,
    baseBranch: 'main',
    pullRequest,
    handoffBindingSha256: text(preflight.handoffBindingSha256).toLowerCase(),
    handoffRunReceiptSha256: text(preflight.handoffRunReceiptSha256).toLowerCase(),
    coordinatorWorkflowRunId: positiveInteger(preflight.coordinatorWorkflowRunId),
    coordinatorWorkflowRunAttempt: positiveInteger(preflight.coordinatorWorkflowRunAttempt),
    handoffCommentId: positiveInteger(preflight.handoffCommentId),
  });
}

export function buildIndependentReviewExecutionContextV1(input = {}) {
  if (!exactKeys(input, INPUT_KEYS)) {
    throw new Error('independent review execution-context input must use the exact closed-world schema');
  }
  if (text(input.repository) !== CANONICAL_REPOSITORY || text(input.job) !== 'independent-security-review') {
    throw new Error('independent review execution context requires the canonical repository and job');
  }
  const eventName = text(input.eventName);
  const selected = eventName === 'pull_request_target'
    ? legacyContext(input)
    : eventName === 'workflow_dispatch'
      ? workflowDispatchContext(input)
      : null;
  if (!selected) {
    throw new Error(`independent review event ${eventName || 'unknown'} is not allowlisted`);
  }
  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_EXECUTION_CONTEXT_SCHEMA,
    ...selected,
    authority: frozenAuthority(),
  });
}
