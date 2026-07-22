const SHA_PATTERN = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
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
  const boundPr = pullRequests.find((item) => integer(item?.number) === integer(prNumber));
  const observedBase = text(boundPr?.base?.sha).toLowerCase();
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
  if (receipt.schemaVersion !== 'stephanos.protected-operator-approval.v2') blockers.push('approval-schema-not-base-bound');
  if (receipt.kind !== 'stephanos.protected-operator-approval') blockers.push('approval-kind-mismatch');
  if (integer(receipt.prNumber) !== integer(options.prNumber)) blockers.push('approval-pr-mismatch');
  if (expectedHead && text(receipt.sourceHead).toLowerCase() !== expectedHead) blockers.push('approval-head-mismatch');
  if (expectedBase && text(receipt.baseSha).toLowerCase() !== expectedBase) blockers.push('approval-base-mismatch');
  if (integer(receipt.workflowRunId) !== integer(options.workflowRunId)) blockers.push('approval-run-mismatch');
  if (integer(receipt.workflowRunAttempt) !== integer(options.workflowRunAttempt)) blockers.push('approval-attempt-mismatch');
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
