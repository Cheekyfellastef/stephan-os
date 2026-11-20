const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const APPROVAL_ENVIRONMENT = 'operator-merge-approval';
const APPROVAL_REVIEWER = 'Cheekyfellastef';
const APPROVAL_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
const APPROVAL_EXECUTION_AUTHORITY = 'github-actions-protected-environment-only';
export const MERGE_QUEUE_REQUIRED_CHECK = 'operator-merge-queue-boundary';
export const MERGE_QUEUE_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const MERGE_QUEUE_WORKFLOW_NAME = 'Protected Operator Merge Queue Boundary';
export const MERGE_QUEUE_APPROVAL_ENVIRONMENT = 'operator-merge-approval';

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function strictPositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function exactSha(value, label) {
  const normalized = text(value).toLowerCase();
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be an exact 40-character SHA.`);
  return normalized;
}

function unique(values) {
  return [...new Set(values)];
}

export function independentReviewBaseProofRef(baseSha) {
  return `proofs/independent-review/base-${exactSha(baseSha, 'baseSha')}`;
}

export function bindIndependentReviewReceiptToBase(receipt = {}, baseSha) {
  const expectedBase = exactSha(baseSha, 'baseSha');
  return Object.freeze({
    ...receipt,
    reviewScope: Object.freeze(unique([
      ...(Array.isArray(receipt.reviewScope) ? receipt.reviewScope : []),
      'exact-base-sha-binding',
    ])),
    proofRefs: Object.freeze(unique([
      ...(Array.isArray(receipt.proofRefs) ? receipt.proofRefs : []),
      independentReviewBaseProofRef(expectedBase),
    ])),
  });
}

export function validateIndependentReviewBaseBinding(receipt = {}, expectedBaseSha) {
  const blockers = [];
  let expectedBase = '';
  try {
    expectedBase = exactSha(expectedBaseSha, 'expectedBaseSha');
  } catch {
    blockers.push('invalid-expected-base-sha');
  }
  const proofRefs = Array.isArray(receipt.proofRefs) ? receipt.proofRefs.map(text) : [];
  const reviewScope = Array.isArray(receipt.reviewScope) ? receipt.reviewScope.map(text) : [];
  if (expectedBase && !proofRefs.includes(independentReviewBaseProofRef(expectedBase))) {
    blockers.push('independent-review-base-proof-missing');
  }
  if (!reviewScope.includes('exact-base-sha-binding')) {
    blockers.push('independent-review-base-scope-missing');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    expectedBaseSha: expectedBase,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'INDEPENDENT_REVIEW_BASE_BLOCKED' : 'INDEPENDENT_REVIEW_BASE_READY',
  });
}

export function validatePullRequestBaseBinding(pullRequest = {}, expectedBaseSha) {
  const blockers = [];
  let expectedBase = '';
  try {
    expectedBase = exactSha(expectedBaseSha, 'expectedBaseSha');
  } catch {
    blockers.push('invalid-expected-base-sha');
  }
  const observedBase = text(pullRequest?.base?.sha).toLowerCase();
  if (!SHA_PATTERN.test(observedBase)) blockers.push('pull-request-base-sha-missing');
  if (expectedBase && observedBase !== expectedBase) blockers.push('pull-request-base-sha-mismatch');
  return Object.freeze({
    valid: blockers.length === 0,
    expectedBaseSha: expectedBase,
    observedBaseSha: observedBase,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'PULL_REQUEST_BASE_BLOCKED' : 'PULL_REQUEST_BASE_READY',
  });
}

export function validateMainRefBaseBinding(baseRef = {}, expectedBaseSha) {
  const blockers = [];
  let expectedBase = '';
  try {
    expectedBase = exactSha(expectedBaseSha, 'expectedBaseSha');
  } catch {
    blockers.push('invalid-expected-base-sha');
  }
  const observedBase = text(baseRef?.object?.sha ?? baseRef?.sha).toLowerCase();
  if (!SHA_PATTERN.test(observedBase)) blockers.push('main-ref-sha-missing');
  if (expectedBase && observedBase !== expectedBase) blockers.push('main-ref-sha-mismatch');
  return Object.freeze({
    valid: blockers.length === 0,
    expectedBaseSha: expectedBase,
    observedBaseSha: observedBase,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'MAIN_REF_BASE_BLOCKED' : 'MAIN_REF_BASE_READY',
  });
}

export function validateIndependentWorkflowBaseBinding(run = {}, prNumber, expectedBaseSha) {
  const blockers = [];
  let expectedBase = '';
  try {
    expectedBase = exactSha(expectedBaseSha, 'expectedBaseSha');
  } catch {
    blockers.push('invalid-expected-base-sha');
  }
  const pullRequests = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  const boundPr = pullRequests.length === 1 && integer(pullRequests[0]?.number) === integer(prNumber)
    ? pullRequests[0]
    : null;
  const observedBase = text(boundPr?.base?.sha).toLowerCase();
  if (pullRequests.length !== 1) blockers.push('independent-review-pr-binding-count-not-one');
  if (!boundPr) blockers.push('independent-review-pr-binding-missing');
  if (!SHA_PATTERN.test(observedBase)) blockers.push('independent-review-base-sha-missing');
  if (expectedBase && observedBase !== expectedBase) blockers.push('independent-review-base-sha-mismatch');
  return Object.freeze({
    valid: blockers.length === 0,
    expectedBaseSha: expectedBase,
    observedBaseSha: observedBase,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'INDEPENDENT_WORKFLOW_BASE_BLOCKED' : 'INDEPENDENT_WORKFLOW_BASE_READY',
  });
}

export function buildBaseBoundApprovalReceipt(receipt = {}, baseSha) {
  const expectedBase = exactSha(baseSha, 'baseSha');
  return Object.freeze({
    ...receipt,
    schemaVersion: 'stephanos.protected-operator-approval.v2',
    baseSha: expectedBase,
    reusableAcrossBases: false,
  });
}

export function validateBaseBoundApprovalReceipt(receipt = {}, options = {}) {
  const blockers = [];
  const receiptIsObject = Boolean(receipt && typeof receipt === 'object' && !Array.isArray(receipt));
  receipt = receiptIsObject ? receipt : {};
  let expectedHead = '';
  let expectedBase = '';
  try {
    expectedHead = exactSha(options.expectedHead, 'expectedHead');
  } catch {
    blockers.push('invalid-expected-head-sha');
  }
  try {
    expectedBase = exactSha(options.expectedBaseSha, 'expectedBaseSha');
  } catch {
    blockers.push('invalid-expected-base-sha');
  }
  const expectedRepository = typeof options.repository === 'string' ? options.repository.trim() : '';
  const expectedBranch = typeof options.branch === 'string' ? options.branch.trim() : '';
  const expectedRepositoryValid = REPOSITORY_PATTERN.test(expectedRepository);
  const expectedBranchValid = BRANCH_PATTERN.test(expectedBranch) && !expectedBranch.includes('..');
  const receiptRepository = typeof receipt.repository === 'string' ? receipt.repository.trim() : '';
  const receiptBranch = typeof receipt.branch === 'string' ? receipt.branch.trim() : '';
  const approvedAtUtc = typeof receipt.approvedAtUtc === 'string' ? receipt.approvedAtUtc.trim() : '';
  const approvedAtMs = EXPLICIT_TIMEZONE.test(approvedAtUtc) ? Date.parse(approvedAtUtc) : Number.NaN;
  const nowUtc = typeof options.nowUtc === 'string' ? options.nowUtc.trim() : '';
  const nowMs = EXPLICIT_TIMEZONE.test(nowUtc) ? Date.parse(nowUtc) : Number.NaN;
  const artifactExpectationSupplied = [
    'independentReviewWorkflowRunId',
    'independentReviewWorkflowRunAttempt',
    'independentReviewArtifactId',
    'independentReviewArtifactDigest',
    'independentReviewPayloadSha256',
  ].some((key) => Object.prototype.hasOwnProperty.call(options, key));
  const receiptArtifactIdentitySupplied = [
    'independentReviewWorkflowRunId',
    'independentReviewWorkflowRunAttempt',
    'independentReviewArtifactId',
    'independentReviewArtifactDigest',
    'independentReviewPayloadSha256',
  ].some((key) => Object.prototype.hasOwnProperty.call(receipt, key));
  const expectedReviewRunId = options.independentReviewWorkflowRunId;
  const expectedReviewRunAttempt = options.independentReviewWorkflowRunAttempt;
  const expectedArtifactId = options.independentReviewArtifactId;
  const expectedArtifactDigest = typeof options.independentReviewArtifactDigest === 'string'
    ? options.independentReviewArtifactDigest.trim().toLowerCase()
    : '';
  const expectedPayloadSha256 = typeof options.independentReviewPayloadSha256 === 'string'
    ? options.independentReviewPayloadSha256.trim().toLowerCase()
    : '';
  if (!receiptIsObject) blockers.push('approval-receipt-invalid');
  if (receipt.schemaVersion !== 'stephanos.protected-operator-approval.v2') blockers.push('approval-schema-not-base-bound');
  if (receipt.kind !== 'stephanos.protected-operator-approval') blockers.push('approval-kind-mismatch');
  if (typeof receipt.repository !== 'string' || !REPOSITORY_PATTERN.test(receipt.repository.trim())) {
    blockers.push('approval-repository-invalid');
  }
  if (!expectedRepositoryValid) blockers.push('approval-expected-repository-invalid');
  if (expectedRepositoryValid && receiptRepository !== expectedRepository) blockers.push('approval-repository-mismatch');
  if (typeof receipt.prNumber !== 'number' || !Number.isSafeInteger(receipt.prNumber) || receipt.prNumber <= 0) {
    blockers.push('approval-pr-invalid');
  }
  if (receipt.prNumber !== options.prNumber) blockers.push('approval-pr-mismatch');
  if (expectedHead && text(receipt.sourceHead).toLowerCase() !== expectedHead) blockers.push('approval-head-mismatch');
  if (typeof receipt.sourceHead !== 'string') blockers.push('approval-head-invalid-type');
  if (typeof receipt.branch !== 'string' || !BRANCH_PATTERN.test(receipt.branch.trim()) || receipt.branch.includes('..')) {
    blockers.push('approval-branch-invalid');
  }
  if (!expectedBranchValid) blockers.push('approval-expected-branch-invalid');
  if (expectedBranchValid && receiptBranch !== expectedBranch) blockers.push('approval-branch-mismatch');
  if (expectedBase && text(receipt.baseSha).toLowerCase() !== expectedBase) blockers.push('approval-base-mismatch');
  if (typeof receipt.baseSha !== 'string') blockers.push('approval-base-invalid-type');
  if (receipt.environment !== APPROVAL_ENVIRONMENT) blockers.push('approval-environment-mismatch');
  if (receipt.requiredReviewer !== APPROVAL_REVIEWER) blockers.push('approval-reviewer-mismatch');
  if (receipt.workflowPath !== APPROVAL_WORKFLOW_PATH) blockers.push('approval-workflow-path-mismatch');
  if (typeof receipt.workflowRunId !== 'number' || !Number.isSafeInteger(receipt.workflowRunId) || receipt.workflowRunId <= 0) {
    blockers.push('approval-run-invalid');
  }
  if (
    typeof receipt.workflowRunAttempt !== 'number'
    || !Number.isSafeInteger(receipt.workflowRunAttempt)
    || receipt.workflowRunAttempt <= 0
  ) {
    blockers.push('approval-attempt-invalid');
  }
  if (options.workflowRunId !== undefined && receipt.workflowRunId !== options.workflowRunId) blockers.push('approval-run-mismatch');
  if (options.workflowRunAttempt !== undefined && receipt.workflowRunAttempt !== options.workflowRunAttempt) {
    blockers.push('approval-attempt-mismatch');
  }
  if (artifactExpectationSupplied || receiptArtifactIdentitySupplied) {
    if (
      typeof receipt.independentReviewWorkflowRunId !== 'number'
      || !Number.isSafeInteger(receipt.independentReviewWorkflowRunId)
      || receipt.independentReviewWorkflowRunId <= 0
    ) {
      blockers.push('approval-independent-review-run-invalid');
    }
    if (
      typeof receipt.independentReviewWorkflowRunAttempt !== 'number'
      || !Number.isSafeInteger(receipt.independentReviewWorkflowRunAttempt)
      || receipt.independentReviewWorkflowRunAttempt <= 0
    ) {
      blockers.push('approval-independent-review-attempt-invalid');
    }
    if (
      typeof receipt.independentReviewArtifactId !== 'number'
      || !Number.isSafeInteger(receipt.independentReviewArtifactId)
      || receipt.independentReviewArtifactId <= 0
    ) {
      blockers.push('approval-independent-review-artifact-id-invalid');
    }
    if (
      typeof receipt.independentReviewArtifactDigest !== 'string'
      || !ARTIFACT_DIGEST_PATTERN.test(receipt.independentReviewArtifactDigest)
    ) {
      blockers.push('approval-independent-review-artifact-digest-invalid');
    }
    if (
      typeof receipt.independentReviewPayloadSha256 !== 'string'
      || !SHA256_PATTERN.test(receipt.independentReviewPayloadSha256)
    ) {
      blockers.push('approval-independent-review-payload-digest-invalid');
    }
  }
  if (artifactExpectationSupplied) {
    if (
      typeof expectedReviewRunId !== 'number'
      || !Number.isSafeInteger(expectedReviewRunId)
      || expectedReviewRunId <= 0
    ) {
      blockers.push('approval-expected-independent-review-run-invalid');
    } else if (receipt.independentReviewWorkflowRunId !== expectedReviewRunId) {
      blockers.push('approval-independent-review-run-mismatch');
    }
    if (
      typeof expectedReviewRunAttempt !== 'number'
      || !Number.isSafeInteger(expectedReviewRunAttempt)
      || expectedReviewRunAttempt <= 0
    ) {
      blockers.push('approval-expected-independent-review-attempt-invalid');
    } else if (receipt.independentReviewWorkflowRunAttempt !== expectedReviewRunAttempt) {
      blockers.push('approval-independent-review-attempt-mismatch');
    }
    if (
      typeof expectedArtifactId !== 'number'
      || !Number.isSafeInteger(expectedArtifactId)
      || expectedArtifactId <= 0
    ) {
      blockers.push('approval-expected-independent-review-artifact-id-invalid');
    } else if (receipt.independentReviewArtifactId !== expectedArtifactId) {
      blockers.push('approval-independent-review-artifact-id-mismatch');
    }
    if (!ARTIFACT_DIGEST_PATTERN.test(expectedArtifactDigest)) {
      blockers.push('approval-expected-independent-review-artifact-digest-invalid');
    } else if (receipt.independentReviewArtifactDigest !== expectedArtifactDigest) {
      blockers.push('approval-independent-review-artifact-digest-mismatch');
    }
    if (!SHA256_PATTERN.test(expectedPayloadSha256)) {
      blockers.push('approval-expected-independent-review-payload-digest-invalid');
    } else if (receipt.independentReviewPayloadSha256 !== expectedPayloadSha256) {
      blockers.push('approval-independent-review-payload-digest-mismatch');
    }
  }
  if (!Number.isFinite(approvedAtMs)) blockers.push('approval-time-invalid');
  if (!Number.isFinite(nowMs)) blockers.push('approval-observation-time-invalid');
  if (Number.isFinite(approvedAtMs) && Number.isFinite(nowMs) && approvedAtMs - nowMs > 60_000) {
    blockers.push('approval-time-in-future');
  }
  if (receipt.mergeExecutionAuthority !== APPROVAL_EXECUTION_AUTHORITY) {
    blockers.push('approval-execution-authority-mismatch');
  }
  if (receipt.reusableAcrossHeads !== false) blockers.push('approval-reusable-across-heads');
  if (receipt.reusableAcrossBases !== false) blockers.push('approval-reusable-across-bases');
  return Object.freeze({
    valid: blockers.length === 0,
    expectedHead,
    expectedBaseSha: expectedBase,
    blockers: Object.freeze(blockers),
    finalVerdict: blockers.length ? 'BASE_BOUND_APPROVAL_BLOCKED' : 'BASE_BOUND_APPROVAL_READY',
  });
}

export function validateMergeCommitBaseAndHeadBinding(
  commit = {},
  expectedMergeSha,
  expectedBaseSha,
  expectedHeadSha,
  expectedTreeSha,
) {
  const blockers = [];
  let expectedMerge = '';
  let expectedBase = '';
  let expectedHead = '';
  let expectedTree = '';
  for (const [value, label, assign, blocker] of [
    [expectedMergeSha, 'expectedMergeSha', (sha) => { expectedMerge = sha; }, 'invalid-expected-merge-sha'],
    [expectedBaseSha, 'expectedBaseSha', (sha) => { expectedBase = sha; }, 'invalid-expected-base-sha'],
    [expectedHeadSha, 'expectedHeadSha', (sha) => { expectedHead = sha; }, 'invalid-expected-head-sha'],
    [expectedTreeSha, 'expectedTreeSha', (sha) => { expectedTree = sha; }, 'invalid-expected-tree-sha'],
  ]) {
    try {
      assign(exactSha(value, label));
    } catch {
      blockers.push(blocker);
    }
  }
  const observedMerge = text(commit?.sha).toLowerCase();
  const observedTree = text(commit?.tree?.sha ?? commit?.tree).toLowerCase();
  const parents = Array.isArray(commit?.parents) ? commit.parents : [];
  const parentShas = parents.map((parent) => text(parent?.sha ?? parent).toLowerCase());
  if (!SHA_PATTERN.test(observedMerge)) blockers.push('merge-commit-sha-missing');
  if (expectedMerge && observedMerge !== expectedMerge) blockers.push('merge-commit-sha-mismatch');
  if (!SHA_PATTERN.test(observedTree)) blockers.push('merge-commit-tree-sha-missing');
  if (expectedTree && observedTree !== expectedTree) blockers.push('merge-commit-tree-sha-mismatch');
  if (!Array.isArray(commit?.parents)) blockers.push('merge-commit-parents-missing');
  if (parents.length !== 2) blockers.push('merge-commit-parent-count-not-exact');
  if (parentShas.some((sha) => !SHA_PATTERN.test(sha))) blockers.push('merge-commit-parent-sha-invalid');
  if (
    expectedBase
    && expectedHead
    && (
      parentShas.length !== 2
      || parentShas[0] !== expectedBase
      || parentShas[1] !== expectedHead
    )
  ) {
    blockers.push('merge-commit-parent-order-mismatch');
  }
  if (expectedBase && expectedHead && expectedBase === expectedHead) blockers.push('merge-head-equals-base');
  if (expectedMerge && [expectedBase, expectedHead].includes(expectedMerge)) {
    blockers.push('merge-commit-not-distinct');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    expectedMergeSha: expectedMerge,
    observedMergeSha: observedMerge,
    expectedBaseSha: expectedBase,
    expectedHeadSha: expectedHead,
    expectedTreeSha: expectedTree,
    observedTreeSha: observedTree,
    observedParentShas: Object.freeze(parentShas),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'MERGE_COMMIT_BASE_AND_HEAD_BLOCKED'
      : 'MERGE_COMMIT_BASE_AND_HEAD_READY',
  });
}

export function buildAtomicMergeRefUpdatePlan({
  candidateCommit = {},
  liveMainRef = {},
  expectedMergeSha,
  expectedBaseSha,
  expectedHeadSha,
  expectedTreeSha,
} = {}) {
  const candidate = validateMergeCommitBaseAndHeadBinding(
    candidateCommit,
    expectedMergeSha,
    expectedBaseSha,
    expectedHeadSha,
    expectedTreeSha,
  );
  const liveBase = validateMainRefBaseBinding(liveMainRef, expectedBaseSha);
  const blockers = [
    ...candidate.blockers.map((blocker) => `candidate:${blocker}`),
    ...liveBase.blockers.map((blocker) => `live-base:${blocker}`),
  ];
  const valid = blockers.length === 0;
  return Object.freeze({
    valid,
    candidate,
    liveBase,
    update: valid
      ? Object.freeze({
        ref: 'refs/heads/main',
        sha: candidate.expectedMergeSha,
        expectedOldSha: candidate.expectedBaseSha,
        force: false,
      })
      : null,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: valid
      ? 'ATOMIC_MERGE_REF_UPDATE_READY'
      : 'ATOMIC_MERGE_REF_UPDATE_BLOCKED',
  });
}

export function validateMergeGroupEvidence(input = {}, expected = {}) {
  const blockers = [];
  const repository = text(input.repository);
  const mergeGroup = input.mergeGroup && typeof input.mergeGroup === 'object'
    ? input.mergeGroup
    : {};
  const associatedPullRequests = Array.isArray(input.associatedPullRequests)
    ? input.associatedPullRequests
    : [];
  const associatedPullRequest = associatedPullRequests.length === 1
    ? associatedPullRequests[0]
    : null;
  const pullRequest = input.pullRequest && typeof input.pullRequest === 'object'
    ? input.pullRequest
    : {};
  const mergeGroupSha = text(mergeGroup.head_sha).toLowerCase();
  const baseSha = text(mergeGroup.base_sha).toLowerCase();
  const sourceHead = text(pullRequest?.head?.sha).toLowerCase();
  const branch = text(pullRequest?.head?.ref);
  const prNumber = strictPositiveInteger(pullRequest?.number);
  const associatedPrNumber = strictPositiveInteger(associatedPullRequest?.number);
  const workflowRunId = strictPositiveInteger(input.workflowRunId);
  const workflowRunAttempt = strictPositiveInteger(input.workflowRunAttempt);
  const mainRef = text(input?.liveMainRef?.object?.sha ?? input?.liveMainRef?.sha).toLowerCase();
  const reviewDecisionObserved = Object.hasOwn(input, 'reviewDecision');
  const reviewDecision = text(input.reviewDecision).toUpperCase();
  const mergeable = text(input.mergeable).toUpperCase();
  const unresolvedThreadCount = input.unresolvedThreadCount;

  if (!REPOSITORY_PATTERN.test(repository)) blockers.push('merge-group-repository-invalid');
  if (input.eventName !== 'merge_group') blockers.push('merge-group-event-not-exact');
  if (input.action !== 'checks_requested') blockers.push('merge-group-action-not-checks-requested');
  if (!workflowRunId) blockers.push('merge-group-workflow-run-invalid');
  if (!workflowRunAttempt) blockers.push('merge-group-workflow-attempt-invalid');
  if (!SHA_PATTERN.test(mergeGroupSha)) blockers.push('merge-group-sha-invalid');
  if (!SHA_PATTERN.test(baseSha)) blockers.push('merge-group-base-sha-invalid');
  if (text(mergeGroup.base_ref) !== 'refs/heads/main') blockers.push('merge-group-base-ref-not-main');
  if (associatedPullRequests.length !== 1) blockers.push('merge-group-associated-pr-count-not-one');
  if (!associatedPrNumber) blockers.push('merge-group-associated-pr-invalid');
  if (!prNumber || prNumber !== associatedPrNumber) blockers.push('merge-group-associated-pr-mismatch');
  if (text(pullRequest.state).toLowerCase() !== 'open') blockers.push('merge-group-pr-not-open');
  if (pullRequest.draft !== false) blockers.push('merge-group-pr-draft');
  if (!SHA_PATTERN.test(sourceHead)) blockers.push('merge-group-source-head-invalid');
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..')) blockers.push('merge-group-source-branch-invalid');
  if (text(pullRequest?.base?.ref) !== 'main') blockers.push('merge-group-pr-base-ref-not-main');
  if (text(pullRequest?.base?.sha).toLowerCase() !== baseSha) blockers.push('merge-group-pr-base-sha-mismatch');
  if (text(associatedPullRequest?.head?.sha).toLowerCase() !== sourceHead) {
    blockers.push('merge-group-associated-pr-head-mismatch');
  }
  if (text(associatedPullRequest?.base?.sha).toLowerCase() !== baseSha) {
    blockers.push('merge-group-associated-pr-base-mismatch');
  }
  if (!SHA_PATTERN.test(mainRef) || mainRef !== baseSha) blockers.push('merge-group-live-main-base-mismatch');
  if ([baseSha, sourceHead].includes(mergeGroupSha)) blockers.push('merge-group-sha-not-synthetic');
  if (baseSha && sourceHead && baseSha === sourceHead) blockers.push('merge-group-head-equals-base');
  if (!reviewDecisionObserved) blockers.push('merge-group-review-decision-missing');
  if (reviewDecision === 'CHANGES_REQUESTED') blockers.push('merge-group-changes-requested');
  else if (!['', 'APPROVED'].includes(reviewDecision)) {
    blockers.push('merge-group-review-decision-unsupported');
  }
  if (mergeable !== 'MERGEABLE') blockers.push('merge-group-pr-not-mergeable');
  if (typeof unresolvedThreadCount !== 'number'
    || !Number.isSafeInteger(unresolvedThreadCount)
    || unresolvedThreadCount !== 0) {
    blockers.push('merge-group-conversations-not-resolved');
  }

  const comparisons = [
    ['repository', repository, text(expected.repository), 'merge-group-expected-repository-mismatch'],
    ['prNumber', prNumber, strictPositiveInteger(expected.prNumber), 'merge-group-expected-pr-mismatch'],
    ['sourceHead', sourceHead, text(expected.sourceHead).toLowerCase(), 'merge-group-expected-head-mismatch'],
    ['baseSha', baseSha, text(expected.baseSha).toLowerCase(), 'merge-group-expected-base-mismatch'],
    ['mergeGroupSha', mergeGroupSha, text(expected.mergeGroupSha).toLowerCase(), 'merge-group-expected-sha-mismatch'],
    ['workflowRunId', workflowRunId, strictPositiveInteger(expected.workflowRunId), 'merge-group-expected-run-mismatch'],
    ['workflowRunAttempt', workflowRunAttempt, strictPositiveInteger(expected.workflowRunAttempt), 'merge-group-expected-attempt-mismatch'],
  ];
  for (const [key, observed, expectedValue, blocker] of comparisons) {
    if (Object.hasOwn(expected, key) && (!expectedValue || observed !== expectedValue)) blockers.push(blocker);
  }

  return Object.freeze({
    valid: blockers.length === 0,
    identity: Object.freeze({
      repository,
      prNumber,
      branch,
      sourceHead,
      baseSha,
      mergeGroupSha,
      workflowRunId,
      workflowRunAttempt,
    }),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length ? 'MERGE_GROUP_EVIDENCE_BLOCKED' : 'MERGE_GROUP_EVIDENCE_READY',
  });
}

function rulesOfType(activeRules, type) {
  return activeRules.filter((rule) => text(rule?.type).toLowerCase() === type);
}

function configurationNotProved(blockers, detail) {
  blockers.push(`CONFIGURATION_NOT_PROVED:${detail}`);
}

export function validateMergeQueueConfiguration(input = {}, options = {}) {
  const blockers = [];
  const activeRules = Array.isArray(input.activeRules) ? input.activeRules : null;
  const rulesets = Array.isArray(input.rulesets) ? input.rulesets : null;
  const requiredCheck = text(options.requiredCheck || MERGE_QUEUE_REQUIRED_CHECK);
  const expectedIntegrationId = strictPositiveInteger(options.expectedIntegrationId);
  if (!activeRules) configurationNotProved(blockers, 'active-main-rules');
  if (!rulesets) configurationNotProved(blockers, 'active-rulesets');
  if (!requiredCheck) configurationNotProved(blockers, 'required-check-identity');
  if (!expectedIntegrationId) configurationNotProved(blockers, 'required-check-integration');
  const rules = activeRules || [];
  const pullRequestRules = rulesOfType(rules, 'pull_request');
  const statusCheckRules = rulesOfType(rules, 'required_status_checks');
  const mergeQueueRules = rulesOfType(rules, 'merge_queue');
  const nonFastForwardRules = rulesOfType(rules, 'non_fast_forward');

  if (pullRequestRules.length !== 1) configurationNotProved(blockers, 'pull-request-rule-not-exact');
  if (statusCheckRules.length !== 1) configurationNotProved(blockers, 'required-status-check-rule-not-exact');
  if (mergeQueueRules.length !== 1) configurationNotProved(blockers, 'merge-queue-rule-not-exact');
  if (nonFastForwardRules.length < 1) configurationNotProved(blockers, 'non-fast-forward-rule-missing');

  const pullRequestParameters = pullRequestRules[0]?.parameters || {};
  if (!Number.isSafeInteger(pullRequestParameters.required_approving_review_count)
    || pullRequestParameters.required_approving_review_count !== 0) {
    blockers.push('merge-queue-native-approval-count-not-zero');
  }
  if (pullRequestParameters.required_review_thread_resolution !== true) {
    blockers.push('merge-queue-conversation-resolution-not-enforced');
  }
  if (pullRequestParameters.dismiss_stale_reviews_on_push !== true) {
    blockers.push('merge-queue-stale-review-dismissal-not-enforced');
  }
  if (pullRequestParameters.require_last_push_approval !== false) {
    blockers.push('merge-queue-last-push-native-approval-not-disabled');
  }
  if (pullRequestParameters.require_code_owner_review !== false) {
    blockers.push('merge-queue-code-owner-native-approval-not-disabled');
  }

  const statusParameters = statusCheckRules[0]?.parameters || {};
  const requiredStatusChecks = Array.isArray(statusParameters.required_status_checks)
    ? statusParameters.required_status_checks
    : null;
  if (!requiredStatusChecks) {
    configurationNotProved(blockers, 'required-status-check-list');
  } else {
    const exactChecks = requiredStatusChecks.filter((check) => (
      text(check?.context) === requiredCheck
      && strictPositiveInteger(check?.integration_id) === expectedIntegrationId
    ));
    if (exactChecks.length !== 1) blockers.push('merge-queue-required-check-not-exact');
  }
  if (statusParameters.strict_required_status_checks_policy !== true) {
    blockers.push('merge-queue-strict-status-policy-not-enforced');
  }

  const mergeQueueParameters = mergeQueueRules[0]?.parameters || {};
  if (mergeQueueParameters.max_entries_to_build !== 1
    || mergeQueueParameters.max_entries_to_merge !== 1
    || mergeQueueParameters.min_entries_to_merge !== 1) {
    blockers.push('merge-queue-not-one-entry');
  }
  if (text(mergeQueueParameters.merge_method).toUpperCase() !== 'MERGE') {
    blockers.push('merge-queue-method-not-merge');
  }

  const activeRulesetIds = unique(rules.map((rule) => strictPositiveInteger(rule?.ruleset_id)).filter(Boolean));
  if (!rules.length || activeRulesetIds.length === 0
    || rules.some((rule) => !strictPositiveInteger(rule?.ruleset_id))) {
    configurationNotProved(blockers, 'active-rule-ruleset-identities');
  }
  const suppliedRulesets = rulesets || [];
  const suppliedRulesetIds = suppliedRulesets.map((ruleset) => strictPositiveInteger(ruleset?.id));
  if (suppliedRulesetIds.some((id) => !id)
    || suppliedRulesetIds.length !== activeRulesetIds.length
    || activeRulesetIds.some((id) => !suppliedRulesetIds.includes(id))) {
    configurationNotProved(blockers, 'ruleset-evidence-not-exact');
  }
  for (const ruleset of suppliedRulesets) {
    const rulesetId = strictPositiveInteger(ruleset?.id);
    if (text(ruleset?.enforcement).toLowerCase() !== 'active') {
      blockers.push(`merge-queue-ruleset-not-active:${rulesetId || 'unknown'}`);
    }
    if (!Array.isArray(ruleset?.bypass_actors)) {
      configurationNotProved(blockers, `ruleset-bypass-actors:${rulesetId || 'unknown'}`);
    } else if (ruleset.bypass_actors.length !== 0) {
      blockers.push(`merge-queue-bypass-present:${rulesetId || 'unknown'}`);
    }
  }

  return Object.freeze({
    valid: blockers.length === 0,
    requiredCheck,
    requiredCheckIntegrationId: expectedIntegrationId,
    activeRulesetIds: Object.freeze(activeRulesetIds),
    queue: Object.freeze({
      mergeMethod: text(mergeQueueParameters.merge_method).toUpperCase(),
      maxEntriesToBuild: mergeQueueParameters.max_entries_to_build ?? null,
      maxEntriesToMerge: mergeQueueParameters.max_entries_to_merge ?? null,
      minEntriesToMerge: mergeQueueParameters.min_entries_to_merge ?? null,
    }),
    pullRequest: Object.freeze({
      requiredApprovingReviewCount: pullRequestParameters.required_approving_review_count ?? null,
      requireConversationResolution: pullRequestParameters.required_review_thread_resolution === true,
      dismissStaleReviews: pullRequestParameters.dismiss_stale_reviews_on_push === true,
      requireLastPushApproval: pullRequestParameters.require_last_push_approval === true,
      requireCodeOwnerReview: pullRequestParameters.require_code_owner_review === true,
    }),
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'MERGE_QUEUE_CONFIGURATION_BLOCKED'
      : 'MERGE_QUEUE_CONFIGURATION_READY',
  });
}

const MERGE_QUEUE_APPROVAL_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'repository',
  'prNumber',
  'branch',
  'sourceHead',
  'baseSha',
  'mergeGroupSha',
  'workflowPath',
  'workflowRunId',
  'workflowRunAttempt',
  'requiredCheck',
  'environment',
  'independentReviewWorkflowRunId',
  'independentReviewWorkflowRunAttempt',
  'independentReviewArtifactId',
  'independentReviewArtifactDigest',
  'independentReviewPayloadSha256',
  'evidenceSha256',
  'approvedAtUtc',
  'authority',
  'reusableAcrossHeads',
  'reusableAcrossBases',
  'reusableAcrossMergeGroups',
]);

function sameKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const observed = Object.keys(value).sort();
  const expected = [...keys].sort();
  return observed.length === expected.length
    && observed.every((key, index) => key === expected[index]);
}

export function buildMergeQueueApprovalReceipt(input = {}) {
  if (input?.groupEvidence?.finalVerdict !== 'MERGE_GROUP_EVIDENCE_READY'
    || input?.configuration?.finalVerdict !== 'MERGE_QUEUE_CONFIGURATION_READY') {
    throw new Error('Merge queue approval requires ready exact-group and configuration evidence.');
  }
  const identity = input.groupEvidence.identity;
  const approvedAtUtc = text(input.approvedAtUtc);
  if (!EXPLICIT_TIMEZONE.test(approvedAtUtc) || !Number.isFinite(Date.parse(approvedAtUtc))) {
    throw new Error('Merge queue approval requires an explicit valid UTC approval time.');
  }
  const receipt = {
    schemaVersion: 'stephanos.merge-queue-approval.v1',
    kind: 'stephanos.merge-queue.required-check-approval',
    repository: identity.repository,
    prNumber: identity.prNumber,
    branch: identity.branch,
    sourceHead: identity.sourceHead,
    baseSha: identity.baseSha,
    mergeGroupSha: identity.mergeGroupSha,
    workflowPath: MERGE_QUEUE_WORKFLOW_PATH,
    workflowRunId: identity.workflowRunId,
    workflowRunAttempt: identity.workflowRunAttempt,
    requiredCheck: MERGE_QUEUE_REQUIRED_CHECK,
    environment: MERGE_QUEUE_APPROVAL_ENVIRONMENT,
    independentReviewWorkflowRunId: strictPositiveInteger(input.independentReviewWorkflowRunId),
    independentReviewWorkflowRunAttempt: strictPositiveInteger(input.independentReviewWorkflowRunAttempt),
    independentReviewArtifactId: strictPositiveInteger(input.independentReviewArtifactId),
    independentReviewArtifactDigest: text(input.independentReviewArtifactDigest).toLowerCase(),
    independentReviewPayloadSha256: text(input.independentReviewPayloadSha256).toLowerCase(),
    evidenceSha256: text(input.evidenceSha256).toLowerCase(),
    approvedAtUtc,
    authority: 'github-merge-queue-required-check-only',
    reusableAcrossHeads: false,
    reusableAcrossBases: false,
    reusableAcrossMergeGroups: false,
  };
  const validation = validateMergeQueueApprovalReceipt(receipt, receipt);
  if (!validation.valid) {
    throw new Error(`Merge queue approval identity is invalid: ${validation.blockers.join(', ')}`);
  }
  return Object.freeze(receipt);
}

export function validateMergeQueueApprovalReceipt(receipt = {}, expected = {}) {
  const blockers = [];
  if (!sameKeys(receipt, MERGE_QUEUE_APPROVAL_KEYS)) blockers.push('merge-queue-approval-schema-unbounded');
  if (receipt.schemaVersion !== 'stephanos.merge-queue-approval.v1') blockers.push('merge-queue-approval-schema-mismatch');
  if (receipt.kind !== 'stephanos.merge-queue.required-check-approval') blockers.push('merge-queue-approval-kind-mismatch');
  if (!REPOSITORY_PATTERN.test(text(receipt.repository))) blockers.push('merge-queue-approval-repository-invalid');
  if (!strictPositiveInteger(receipt.prNumber)) blockers.push('merge-queue-approval-pr-invalid');
  if (!BRANCH_PATTERN.test(text(receipt.branch)) || text(receipt.branch).includes('..')) {
    blockers.push('merge-queue-approval-branch-invalid');
  }
  for (const [key, blocker] of [
    ['sourceHead', 'merge-queue-approval-head-invalid'],
    ['baseSha', 'merge-queue-approval-base-invalid'],
    ['mergeGroupSha', 'merge-queue-approval-group-invalid'],
  ]) {
    if (!SHA_PATTERN.test(text(receipt[key]).toLowerCase())) blockers.push(blocker);
  }
  if (receipt.workflowPath !== MERGE_QUEUE_WORKFLOW_PATH) blockers.push('merge-queue-approval-workflow-path-mismatch');
  if (!strictPositiveInteger(receipt.workflowRunId)) blockers.push('merge-queue-approval-run-invalid');
  if (!strictPositiveInteger(receipt.workflowRunAttempt)) blockers.push('merge-queue-approval-attempt-invalid');
  if (receipt.requiredCheck !== MERGE_QUEUE_REQUIRED_CHECK) blockers.push('merge-queue-approval-required-check-mismatch');
  if (receipt.environment !== MERGE_QUEUE_APPROVAL_ENVIRONMENT) blockers.push('merge-queue-approval-environment-mismatch');
  if (!strictPositiveInteger(receipt.independentReviewWorkflowRunId)) blockers.push('merge-queue-approval-review-run-invalid');
  if (!strictPositiveInteger(receipt.independentReviewWorkflowRunAttempt)) blockers.push('merge-queue-approval-review-attempt-invalid');
  if (!strictPositiveInteger(receipt.independentReviewArtifactId)) blockers.push('merge-queue-approval-artifact-id-invalid');
  if (!ARTIFACT_DIGEST_PATTERN.test(text(receipt.independentReviewArtifactDigest))) {
    blockers.push('merge-queue-approval-artifact-digest-invalid');
  }
  if (!SHA256_PATTERN.test(text(receipt.independentReviewPayloadSha256))) {
    blockers.push('merge-queue-approval-payload-digest-invalid');
  }
  if (!SHA256_PATTERN.test(text(receipt.evidenceSha256))) blockers.push('merge-queue-approval-evidence-digest-invalid');
  const approvedAtUtc = text(receipt.approvedAtUtc);
  if (!EXPLICIT_TIMEZONE.test(approvedAtUtc) || !Number.isFinite(Date.parse(approvedAtUtc))) {
    blockers.push('merge-queue-approval-time-invalid');
  }
  if (receipt.authority !== 'github-merge-queue-required-check-only') {
    blockers.push('merge-queue-approval-authority-mismatch');
  }
  if (receipt.reusableAcrossHeads !== false) blockers.push('merge-queue-approval-reusable-across-heads');
  if (receipt.reusableAcrossBases !== false) blockers.push('merge-queue-approval-reusable-across-bases');
  if (receipt.reusableAcrossMergeGroups !== false) blockers.push('merge-queue-approval-reusable-across-groups');

  for (const [key, blocker] of [
    ['repository', 'merge-queue-approval-repository-mismatch'],
    ['prNumber', 'merge-queue-approval-pr-mismatch'],
    ['branch', 'merge-queue-approval-branch-mismatch'],
    ['sourceHead', 'merge-queue-approval-head-mismatch'],
    ['baseSha', 'merge-queue-approval-base-mismatch'],
    ['mergeGroupSha', 'merge-queue-approval-group-mismatch'],
    ['workflowRunId', 'merge-queue-approval-run-mismatch'],
    ['workflowRunAttempt', 'merge-queue-approval-attempt-mismatch'],
    ['independentReviewWorkflowRunId', 'merge-queue-approval-review-run-mismatch'],
    ['independentReviewWorkflowRunAttempt', 'merge-queue-approval-review-attempt-mismatch'],
    ['independentReviewArtifactId', 'merge-queue-approval-artifact-id-mismatch'],
    ['independentReviewArtifactDigest', 'merge-queue-approval-artifact-digest-mismatch'],
    ['independentReviewPayloadSha256', 'merge-queue-approval-payload-digest-mismatch'],
    ['evidenceSha256', 'merge-queue-approval-evidence-digest-mismatch'],
  ]) {
    if (Object.hasOwn(expected, key) && receipt[key] !== expected[key]) blockers.push(blocker);
  }

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'MERGE_QUEUE_APPROVAL_BLOCKED'
      : 'MERGE_QUEUE_APPROVAL_READY',
  });
}
