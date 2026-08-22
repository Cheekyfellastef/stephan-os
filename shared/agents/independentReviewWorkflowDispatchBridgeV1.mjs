export const INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_BRIDGE_SCHEMA = 'stephanos.independent-review-workflow-dispatch-bridge.v1';

const PREFLIGHT_SCHEMA = 'stephanos.independent-review-workflow-dispatch-preflight.v1';
const PREFLIGHT_VERDICT = 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_PASS';
const CANONICAL_WORKFLOW_NAME = 'Independent Merge Security Review';
const CANONICAL_WORKFLOW_PATH = '.github/workflows/independent-merge-security-review.yml';
const CANONICAL_WORKFLOW_JOB = 'independent-security-review';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
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

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function plainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeAuthority(authority) {
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

function exactPullRequestSnapshot(pullRequest, expected) {
  if (!plainRecord(pullRequest)
    || !exactKeys(pullRequest, ['number', 'state', 'draft', 'head', 'base'])
    || positiveInteger(pullRequest.number) !== expected.prNumber
    || text(pullRequest.state).toLowerCase() !== 'open'
    || typeof pullRequest.draft !== 'boolean'
    || !exactKeys(pullRequest.head, ['sha', 'ref', 'repo'])
    || !exactKeys(pullRequest.base, ['sha', 'ref', 'repo'])
    || !exactKeys(pullRequest.head.repo, ['full_name'])
    || !exactKeys(pullRequest.base.repo, ['full_name'])
    || text(pullRequest.head.sha).toLowerCase() !== expected.sourceHead
    || text(pullRequest.head.ref) !== expected.branch
    || text(pullRequest.head.repo.full_name) !== expected.repository
    || text(pullRequest.base.sha).toLowerCase() !== expected.baseSha
    || text(pullRequest.base.ref) !== 'main'
    || text(pullRequest.base.repo.full_name) !== expected.repository) {
    return false;
  }
  return true;
}

export function validateIndependentReviewWorkflowDispatchBridgePreflightV1(preflight = {}, options = {}) {
  const expectedRepository = text(options.repository || 'Cheekyfellastef/stephan-os');
  const blockers = [];
  if (!exactKeys(preflight, PREFLIGHT_KEYS)) blockers.push('dispatch-bridge-preflight-schema-not-exact');
  if (preflight.schemaVersion !== PREFLIGHT_SCHEMA) blockers.push('dispatch-bridge-preflight-version-mismatch');
  if (preflight.verdict !== PREFLIGHT_VERDICT) blockers.push('dispatch-bridge-preflight-not-passed');
  if (text(preflight.repository) !== expectedRepository) blockers.push('dispatch-bridge-repository-mismatch');
  const prNumber = positiveInteger(preflight.prNumber);
  const sourceHead = text(preflight.sourceHead).toLowerCase();
  const baseSha = text(preflight.baseSha).toLowerCase();
  const branch = text(preflight.branch);
  if (!prNumber) blockers.push('dispatch-bridge-pr-invalid');
  if (!SHA40.test(sourceHead)) blockers.push('dispatch-bridge-head-invalid');
  if (!SHA40.test(baseSha)) blockers.push('dispatch-bridge-base-invalid');
  if (!branch || branch.includes('..')) blockers.push('dispatch-bridge-branch-invalid');
  if (text(preflight.workflowName) !== CANONICAL_WORKFLOW_NAME) blockers.push('dispatch-bridge-workflow-name-mismatch');
  if (text(preflight.workflowPath) !== CANONICAL_WORKFLOW_PATH) blockers.push('dispatch-bridge-workflow-path-mismatch');
  if (text(preflight.workflowJob) !== CANONICAL_WORKFLOW_JOB) blockers.push('dispatch-bridge-workflow-job-mismatch');
  if (!SHA256.test(text(preflight.handoffBindingSha256).toLowerCase())) blockers.push('dispatch-bridge-handoff-binding-invalid');
  if (!SHA256.test(text(preflight.handoffRunReceiptSha256).toLowerCase())) blockers.push('dispatch-bridge-handoff-receipt-invalid');
  if (!positiveInteger(preflight.coordinatorWorkflowRunId)) blockers.push('dispatch-bridge-coordinator-run-invalid');
  if (!positiveInteger(preflight.coordinatorWorkflowRunAttempt)) blockers.push('dispatch-bridge-coordinator-attempt-invalid');
  if (!positiveInteger(preflight.handoffCommentId)) blockers.push('dispatch-bridge-handoff-comment-invalid');
  if (!safeAuthority(preflight.authority)) blockers.push('dispatch-bridge-authority-not-read-only');
  const expected = { repository: expectedRepository, prNumber, sourceHead, baseSha, branch };
  if (!exactPullRequestSnapshot(preflight.pullRequest, expected)) blockers.push('dispatch-bridge-pr-snapshot-mismatch');
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    identity: Object.freeze(expected),
    finalVerdict: blockers.length
      ? 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_BRIDGE_BLOCKED'
      : 'INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_BRIDGE_READY',
  });
}

export function buildIndependentReviewWorkflowDispatchBridgeV1(preflight = {}, options = {}) {
  const validation = validateIndependentReviewWorkflowDispatchBridgePreflightV1(preflight, options);
  if (!validation.valid) {
    throw new Error(`Independent review dispatch bridge preflight is invalid: ${validation.blockers.join(', ')}`);
  }
  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_BRIDGE_SCHEMA,
    repository: validation.identity.repository,
    prNumber: validation.identity.prNumber,
    sourceHead: validation.identity.sourceHead,
    baseSha: validation.identity.baseSha,
    branch: validation.identity.branch,
    handoffBindingSha256: text(preflight.handoffBindingSha256).toLowerCase(),
    handoffRunReceiptSha256: text(preflight.handoffRunReceiptSha256).toLowerCase(),
    syntheticEventName: 'pull_request_target',
    syntheticEvent: Object.freeze({
      repository: Object.freeze({ full_name: validation.identity.repository }),
      pull_request: Object.freeze({
        number: preflight.pullRequest.number,
        state: preflight.pullRequest.state,
        draft: preflight.pullRequest.draft,
        head: Object.freeze({
          sha: preflight.pullRequest.head.sha,
          ref: preflight.pullRequest.head.ref,
          repo: Object.freeze({ full_name: preflight.pullRequest.head.repo.full_name }),
        }),
        base: Object.freeze({
          sha: preflight.pullRequest.base.sha,
          ref: preflight.pullRequest.base.ref,
          repo: Object.freeze({ full_name: preflight.pullRequest.base.repo.full_name }),
        }),
      }),
    }),
    authority: Object.freeze({
      reviewExecutionAllowed: true,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      arbitraryCommandAllowed: false,
    }),
  });
}
