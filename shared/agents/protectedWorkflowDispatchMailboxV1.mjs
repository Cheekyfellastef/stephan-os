import { validatePersonalRepositoryReadOnlyPriorFailure, PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX } from './protectedMergeReadOnlyPriorFailureV1.mjs';
import { createHash } from 'node:crypto';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';

export const PROTECTED_WORKFLOW_DISPATCH_SCHEMA = 'stephanos.protected-workflow-dispatch.v1';
export const PROTECTED_WORKFLOW_DISPATCH_MARKER = 'stephanos-protected-workflow-dispatch';
export const PROTECTED_WORKFLOW_DISPATCH_OPERATION = 'DISPATCH_PROTECTED_OPERATOR_MERGE';
export const PROTECTED_WORKFLOW_READY_OPERATION = 'MARK_PROTECTED_PR_READY';
export const PROTECTED_WORKFLOW_DISPATCH_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const PROTECTED_WORKFLOW_DISPATCH_ISSUE = CANONICAL_MAILBOX_ISSUE;
export const PROTECTED_WORKFLOW_DISPATCH_AUTHOR = 'Cheekyfellastef';
export const PROTECTED_WORKFLOW_DISPATCH_AUTHOR_ID = 267490109;
export const PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR = 'github-actions[bot]';
export const PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR_ID = 41898282;
export const PROTECTED_WORKFLOW_DISPATCH_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const PROTECTED_WORKFLOW_DISPATCH_WORKFLOW_ID = 'operator-merge-approval-gate.yml';
export const PROTECTED_WORKFLOW_DISPATCH_MODE = 'user-owned-protected-squash';
export const PROTECTED_WORKFLOW_READY_MODE = 'user-owned-pr-ready';
export const PROTECTED_WORKFLOW_DISPATCH_MAX_WINDOW_MS = 10 * 60 * 1000;

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST = /^sha256:[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const OPERATION_MODE = new Map([
  [PROTECTED_WORKFLOW_DISPATCH_OPERATION, PROTECTED_WORKFLOW_DISPATCH_MODE],
  [PROTECTED_WORKFLOW_READY_OPERATION, PROTECTED_WORKFLOW_READY_MODE],
]);
const ALLOWED_FIELDS = new Set([
  'schemaVersion', 'requestId', 'operation', 'repository', 'issueNumber', 'operatorApproval', 'expiresAt',
  'mode', 'prNumber', 'expectedBranch', 'expectedHead', 'expectedHeadTree', 'expectedBase',
  'authorizationHead', 'authorizationHeadTree', 'authorizationBase',
  'independentReviewRunId', 'independentReviewRunAttempt', 'independentReviewArtifactId',
  'independentReviewArtifactDigest', 'independentReviewPayloadSha256',
]);
const READY_AUTHORIZATION_IDENTITY_FIELDS = Object.freeze([
  'operation', 'repository', 'issueNumber', 'operatorApproval', 'mode', 'prNumber', 'expectedBranch',
  'expectedHead', 'expectedHeadTree', 'expectedBase',
]);
const MERGE_STABLE_AUTHORIZATION_IDENTITY_FIELDS = Object.freeze([
  'operation', 'repository', 'issueNumber', 'operatorApproval', 'mode', 'prNumber', 'expectedBranch',
]);
const MERGE_MATERIAL_AUTHORIZATION_IDENTITY_FIELDS = Object.freeze([
  ...MERGE_STABLE_AUTHORIZATION_IDENTITY_FIELDS,
  'authorizationHead', 'authorizationHeadTree', 'authorizationBase',
]);
const MATERIAL_AUTHORIZATION_EXPECTATION_FIELDS = Object.freeze([
  'authorizationHead', 'authorizationHeadTree', 'authorizationBase',
]);
const AUTHORIZATION_COMMENT_ISSUE_URL = `https://api.github.com/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/issues/${PROTECTED_WORKFLOW_DISPATCH_ISSUE}`;

export function protectedWorkflowAuthorizationCommentSha256(comment = {}) {
  return createHash('sha256').update(String(comment.body ?? ''), 'utf8').digest('hex');
}

// The carrier never becomes the operator. This proof is created only from a
// trusted GitHub comment read; callers cannot supply an operator identity.
export function validateProtectedWorkflowActorHandoff(comment = {}, expected = {}, {
  transportActor = '', transportActorId = 0, expectedCommentId = 0, expectedCommentSha256 = '', now = new Date(),
} = {}) {
  if (![PROTECTED_WORKFLOW_DISPATCH_AUTHOR, PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR].includes(transportActor)) {
    return fail('PROTECTED_WORKFLOW_TRANSPORT_ACTOR_NOT_ALLOWED');
  }
  const expectedActorId = transportActor === PROTECTED_WORKFLOW_DISPATCH_AUTHOR
    ? PROTECTED_WORKFLOW_DISPATCH_AUTHOR_ID : PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR_ID;
  if (transportActorId !== expectedActorId) return fail('PROTECTED_WORKFLOW_TRANSPORT_ACTOR_ID_MISMATCH');
  if (comment.user?.id !== PROTECTED_WORKFLOW_DISPATCH_AUTHOR_ID || comment.user?.type !== 'User') {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_AUTHOR_MISMATCH');
  }
  const authoredAtMs = Date.parse(comment.created_at);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(authoredAtMs) || !Number.isFinite(nowMs) || authoredAtMs > nowMs
    || comment.updated_at !== comment.created_at) {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_NOT_IMMUTABLE');
  }
  if (!positiveInteger(expectedCommentId)) return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_ID_MISMATCH');
  const commentSha256 = protectedWorkflowAuthorizationCommentSha256(comment);
  if (expectedCommentSha256 && (!SHA256.test(expectedCommentSha256) || commentSha256 !== expectedCommentSha256)) {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_DIGEST_MISMATCH');
  }
  const validation = validateProtectedWorkflowAuthorizationComment(comment, expected, { now, expectedCommentId });
  if (!validation.ok) return validation;
  // Material authorization may remain durable after admission, but the carrier
  // must have started within the original dispatch window with the exact packet.
  const freshness = validateProtectedWorkflowDispatch(validation.command, {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    now, authoredAt: new Date(authoredAtMs),
  });
  if (!freshness.ok) return freshness;
  const normalized = normalizeAuthorizationExpected(expected);
  for (const field of [...READY_AUTHORIZATION_IDENTITY_FIELDS,
    'independentReviewRunId', 'independentReviewRunAttempt', 'independentReviewArtifactId',
    'independentReviewArtifactDigest', 'independentReviewPayloadSha256']) {
    if (validation.command[field] !== normalized[field]) {
      return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_IDENTITY_MISMATCH', { field });
    }
  }
  return Object.freeze({
    ...validation,
    authorization: Object.freeze({
      commentId: validation.commentId, commentSha256, requestId: validation.command.requestId,
      operatorAuthor: PROTECTED_WORKFLOW_DISPATCH_AUTHOR, transportActor,
      authorizedAtUtc: validation.authoredAtUtc,
    }),
  });
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, details: Object.freeze(details) });
}

function positiveInteger(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  const text = String(value ?? '');
  return POSITIVE_INTEGER.test(text) ? Number(text) : 0;
}

function normalizeAuthorizationExpected(expected = {}) {
  const expectedHead = String(expected.expectedHead || '').toLowerCase();
  const expectedHeadTree = String(expected.expectedHeadTree || '').toLowerCase();
  const expectedBase = String(expected.expectedBase || '').toLowerCase();
  return Object.freeze({
    operation: String(expected.operation || ''),
    repository: String(expected.repository || ''),
    issueNumber: positiveInteger(expected.issueNumber),
    operatorApproval: String(expected.operatorApproval || ''),
    mode: String(expected.mode || ''),
    prNumber: positiveInteger(expected.prNumber),
    expectedBranch: String(expected.expectedBranch || ''),
    expectedHead,
    expectedHeadTree,
    expectedBase,
    authorizationHead: String(expected.authorizationHead || expectedHead).toLowerCase(),
    authorizationHeadTree: String(expected.authorizationHeadTree || expectedHeadTree).toLowerCase(),
    authorizationBase: String(expected.authorizationBase || expectedBase).toLowerCase(),
    independentReviewRunId: positiveInteger(expected.independentReviewRunId),
    independentReviewRunAttempt: positiveInteger(expected.independentReviewRunAttempt),
    independentReviewArtifactId: positiveInteger(expected.independentReviewArtifactId),
    independentReviewArtifactDigest: String(expected.independentReviewArtifactDigest || '').toLowerCase(),
    independentReviewPayloadSha256: String(expected.independentReviewPayloadSha256 || '').toLowerCase(),
  });
}

function materialAuthorizationIdentity(command = {}) {
  const expectedHead = String(command.expectedHead || '').toLowerCase();
  const expectedHeadTree = String(command.expectedHeadTree || '').toLowerCase();
  const expectedBase = String(command.expectedBase || '').toLowerCase();
  return Object.freeze({
    ...command,
    authorizationHead: String(command.authorizationHead || expectedHead).toLowerCase(),
    authorizationHeadTree: String(command.authorizationHeadTree || expectedHeadTree).toLowerCase(),
    authorizationBase: String(command.authorizationBase || expectedBase).toLowerCase(),
  });
}


/**
 * Refuse overlapping source-identical protected merge dispatches, even if an
 * earlier GitHub environment approval is still pending. This is a read-only
 * early guard. The protected executor retains its independently checked
 * replay fence. A failed evidence job is retryable only after the same shared
 * all-attempt job-envelope proof shows both later authority jobs were skipped.
 * This result can never confer merge authority.
 *
 * The caller MUST retrieve the entire bounded workflow-specific,
 * exact-base GitHub run inventory, not trust an owner-supplied list.
 */
export function inspectProtectedWorkflowDuplicateDispatchRuns(runs, command = {}, { priorRunJobSets = [] } = {}) {
  const sourceHead = command.expectedHead;
  const baseSha = command.expectedBase;
  if (!Array.isArray(runs) || runs.length > 600
      || !Array.isArray(priorRunJobSets) || priorRunJobSets.length > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX
      || typeof sourceHead !== 'string' || !SHA40.test(sourceHead)
      || typeof baseSha !== 'string' || !SHA40.test(baseSha))
    return fail('PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
  const title = 'Protected operator merge ' + sourceHead;
  const collisions = [];
  const seen = new Set();
  for (const run of runs) {
    if (!run || typeof run !== 'object' || Array.isArray(run))
      return fail('PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
    if (run.name !== title && run.display_title !== title) continue;
    if (!Number.isSafeInteger(run.id) || run.id <= 0 || seen.has(run.id)
        || run.name !== title || run.display_title !== title
        || run.event !== 'workflow_dispatch'
        || run.head_sha !== baseSha || run.head_branch !== 'main')
      return fail('PROTECTED_WORKFLOW_DISPATCH_RUN_IDENTITY_UNVERIFIABLE');
    seen.add(run.id);
    collisions.push(run);
  }
  if (collisions.length > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX)
    return fail('PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD');
  const proofs = new Map();
  for (const item of priorRunJobSets) {
    if (!item || !seen.has(item.runId) || proofs.has(item.runId) || !Array.isArray(item.jobs))
      return fail('PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
    proofs.set(item.runId, item.jobs);
  }
  const receipts = [];
  let totalAttempts = 0;
  const missingJobProofIds = [];
  for (const run of collisions) {
    const actor = run.triggering_actor || run.actor;
    const path = run.path;
    const exactPath = path === PROTECTED_WORKFLOW_DISPATCH_PATH
      || path === PROTECTED_WORKFLOW_DISPATCH_REPOSITORY + '/' + PROTECTED_WORKFLOW_DISPATCH_PATH + '@refs/heads/main';
    const exactActor = (actor?.login === PROTECTED_WORKFLOW_DISPATCH_AUTHOR && actor?.id === PROTECTED_WORKFLOW_DISPATCH_AUTHOR_ID)
      || (actor?.login === PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR && actor?.id === PROTECTED_WORKFLOW_MAILBOX_TRANSPORT_ACTOR_ID);
    if (run.status !== 'completed' || run.conclusion !== 'failure'
        || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
        || run.run_attempt > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX
        || !Number.isSafeInteger(run.workflow_id) || run.workflow_id < 1
        || run.repository?.full_name !== PROTECTED_WORKFLOW_DISPATCH_REPOSITORY || !exactPath || !exactActor)
      return fail('PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD');
    totalAttempts += run.run_attempt;
    if (totalAttempts > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX)
      return fail('PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD');
    if (!proofs.has(run.id)) { missingJobProofIds.push(run.id); continue; }
    const proof = validatePersonalRepositoryReadOnlyPriorFailure(run, proofs.get(run.id));
    if (!proof.valid) return fail('PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD', { priorRunId: run.id, blockers: proof.blockers });
    receipts.push(proof.receipt);
  }
  if (missingJobProofIds.length)
    return fail('PROTECTED_WORKFLOW_DUPLICATE_SOURCE_ATTEMPT_HELD', { retryCandidateRunIds: missingJobProofIds });
  return Object.freeze({ ok: true, previousSourceAttemptFound: collisions.length > 0,
    retryablePriorFailures: Object.freeze(receipts), mergeAuthority: false });
}

export function extractProtectedWorkflowDispatch(body = '') {
  const text = String(body || '');
  const fence = '```';
  const match = text.match(new RegExp(`${fence}${PROTECTED_WORKFLOW_DISPATCH_MARKER}\\s*([\\s\\S]*?)${fence}`, 'i'));
  if (!match) return fail('PROTECTED_WORKFLOW_DISPATCH_MARKER_MISSING');
  try {
    const command = JSON.parse(match[1].trim());
    return Object.freeze({ ok: true, command });
  } catch (error) {
    return fail('PROTECTED_WORKFLOW_DISPATCH_JSON_INVALID', { error: error?.message || String(error) });
  }
}

export function validateProtectedWorkflowDispatch(command = {}, {
  authorLogin = '',
  issueNumber = 0,
  now = new Date(),
  authoredAt = now,
  allowExpiredMaterialAuthorization = false,
} = {}) {
  if (authorLogin !== PROTECTED_WORKFLOW_DISPATCH_AUTHOR) return fail('PROTECTED_WORKFLOW_DISPATCH_AUTHOR_NOT_ALLOWED');
  if (Number(issueNumber) !== PROTECTED_WORKFLOW_DISPATCH_ISSUE) return fail('PROTECTED_WORKFLOW_DISPATCH_ISSUE_MISMATCH');
  if (!command || typeof command !== 'object' || Array.isArray(command)) return fail('PROTECTED_WORKFLOW_DISPATCH_COMMAND_INVALID');
  const unexpected = Object.keys(command).find((field) => !ALLOWED_FIELDS.has(field));
  if (unexpected) return fail('PROTECTED_WORKFLOW_DISPATCH_FIELD_NOT_ALLOWED', { field: unexpected });
  if (command.schemaVersion !== PROTECTED_WORKFLOW_DISPATCH_SCHEMA) return fail('PROTECTED_WORKFLOW_DISPATCH_SCHEMA_MISMATCH');
  if (!REQUEST_ID.test(String(command.requestId || ''))) return fail('PROTECTED_WORKFLOW_DISPATCH_REQUEST_ID_INVALID');

  const operation = String(command.operation || '');
  const expectedMode = OPERATION_MODE.get(operation);
  if (!expectedMode) return fail('PROTECTED_WORKFLOW_DISPATCH_OPERATION_NOT_ALLOWED');
  if (command.mode !== expectedMode) return fail('PROTECTED_WORKFLOW_DISPATCH_MODE_INVALID');
  if (command.repository !== PROTECTED_WORKFLOW_DISPATCH_REPOSITORY) return fail('PROTECTED_WORKFLOW_DISPATCH_REPOSITORY_MISMATCH');
  if (Number(command.issueNumber) !== PROTECTED_WORKFLOW_DISPATCH_ISSUE) return fail('PROTECTED_WORKFLOW_DISPATCH_ISSUE_MISMATCH');
  if (command.operatorApproval !== 'operator-approved') return fail('PROTECTED_WORKFLOW_DISPATCH_OPERATOR_APPROVAL_REQUIRED');

  const prNumber = positiveInteger(command.prNumber);
  const expectedBranch = String(command.expectedBranch || '');
  const expectedHead = String(command.expectedHead || '').toLowerCase();
  const expectedHeadTree = String(command.expectedHeadTree || '').toLowerCase();
  const expectedBase = String(command.expectedBase || '').toLowerCase();
  const authorizationHead = String(command.authorizationHead || expectedHead).toLowerCase();
  const authorizationHeadTree = String(command.authorizationHeadTree || expectedHeadTree).toLowerCase();
  const authorizationBase = String(command.authorizationBase || expectedBase).toLowerCase();
  const independentReviewRunId = positiveInteger(command.independentReviewRunId);
  const independentReviewRunAttempt = positiveInteger(command.independentReviewRunAttempt);
  const independentReviewArtifactId = positiveInteger(command.independentReviewArtifactId);
  const independentReviewArtifactDigest = String(command.independentReviewArtifactDigest || '').toLowerCase();
  const independentReviewPayloadSha256 = String(command.independentReviewPayloadSha256 || '').toLowerCase();

  if (!prNumber) return fail('PROTECTED_WORKFLOW_DISPATCH_PR_NUMBER_INVALID');
  if (!BRANCH.test(expectedBranch) || expectedBranch.includes('..')) return fail('PROTECTED_WORKFLOW_DISPATCH_BRANCH_INVALID');
  if (!SHA40.test(expectedHead)) return fail('PROTECTED_WORKFLOW_DISPATCH_HEAD_INVALID');
  if (!SHA40.test(expectedHeadTree)) return fail('PROTECTED_WORKFLOW_DISPATCH_HEAD_TREE_INVALID');
  if (!SHA40.test(expectedBase)) return fail('PROTECTED_WORKFLOW_DISPATCH_BASE_INVALID');
  if (!SHA40.test(authorizationHead)) return fail('PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_HEAD_INVALID');
  if (!SHA40.test(authorizationHeadTree)) return fail('PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_HEAD_TREE_INVALID');
  if (!SHA40.test(authorizationBase)) return fail('PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_BASE_INVALID');
  if (operation === PROTECTED_WORKFLOW_READY_OPERATION
    && (authorizationHead !== expectedHead
      || authorizationHeadTree !== expectedHeadTree
      || authorizationBase !== expectedBase)) {
    return fail('PROTECTED_WORKFLOW_READY_AUTHORIZATION_MUST_BE_EXACT_EXECUTION_IDENTITY');
  }
  if (operation === PROTECTED_WORKFLOW_DISPATCH_OPERATION) {
    if (!independentReviewRunId || !independentReviewRunAttempt || !independentReviewArtifactId) {
      return fail('PROTECTED_WORKFLOW_DISPATCH_REVIEW_IDENTITY_INVALID');
    }
    if (!ARTIFACT_DIGEST.test(independentReviewArtifactDigest)) return fail('PROTECTED_WORKFLOW_DISPATCH_ARTIFACT_DIGEST_INVALID');
    if (!SHA256.test(independentReviewPayloadSha256)) return fail('PROTECTED_WORKFLOW_DISPATCH_PAYLOAD_DIGEST_INVALID');
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const authoredAtMs = authoredAt instanceof Date ? authoredAt.getTime() : Date.parse(String(authoredAt));
  const expiresAtMs = Date.parse(String(command.expiresAt || ''));
  if (!Number.isFinite(nowMs) || !Number.isFinite(authoredAtMs) || !Number.isFinite(expiresAtMs)) {
    return fail('PROTECTED_WORKFLOW_DISPATCH_EXPIRY_INVALID');
  }
  const historicalMaterialAuthorization = allowExpiredMaterialAuthorization === true
    && operation === PROTECTED_WORKFLOW_DISPATCH_OPERATION;
  if (expiresAtMs <= authoredAtMs) return fail('PROTECTED_WORKFLOW_DISPATCH_EXPIRED');
  if (expiresAtMs <= nowMs && !historicalMaterialAuthorization) {
    return fail('PROTECTED_WORKFLOW_DISPATCH_EXPIRED');
  }
  if (expiresAtMs - authoredAtMs > PROTECTED_WORKFLOW_DISPATCH_MAX_WINDOW_MS) {
    return fail('PROTECTED_WORKFLOW_DISPATCH_EXPIRY_TOO_FAR_AHEAD');
  }

  return Object.freeze({
    ok: true,
    command: Object.freeze({
      schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA,
      requestId: String(command.requestId),
      operation,
      repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
      issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
      operatorApproval: 'operator-approved',
      expiresAt: new Date(expiresAtMs).toISOString(),
      mode: expectedMode,
      prNumber,
      expectedBranch,
      expectedHead,
      expectedHeadTree,
      expectedBase,
      authorizationHead,
      authorizationHeadTree,
      authorizationBase,
      independentReviewRunId,
      independentReviewRunAttempt,
      independentReviewArtifactId,
      independentReviewArtifactDigest,
      independentReviewPayloadSha256,
    }),
  });
}

export function validateProtectedWorkflowAuthorizationComment(comment = {}, expectedCommand = {}, {
  now = new Date(),
  expectedCommentId = 0,
  allowExpiredMaterialAuthorization = false,
} = {}) {
  const commentId = positiveInteger(comment?.id);
  const requiredCommentId = positiveInteger(expectedCommentId);
  if (!commentId || (requiredCommentId && commentId !== requiredCommentId)) {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_ID_MISMATCH');
  }
  if (String(comment?.issue_url || '') !== AUTHORIZATION_COMMENT_ISSUE_URL) {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_ISSUE_MISMATCH');
  }
  const authorLogin = String(comment?.user?.login || '');
  if (authorLogin !== PROTECTED_WORKFLOW_DISPATCH_AUTHOR) {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_AUTHOR_MISMATCH');
  }
  const body = String(comment?.body || '');
  const marker = PROTECTED_WORKFLOW_DISPATCH_MARKER.toLowerCase();
  if (body.toLowerCase().split(marker).length - 1 !== 1) {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_COMMAND_COUNT_INVALID');
  }
  const extracted = extractProtectedWorkflowDispatch(body);
  if (!extracted.ok) return extracted;
  const explicitMaterialFields = MATERIAL_AUTHORIZATION_EXPECTATION_FIELDS
    .filter((field) => Object.hasOwn(expectedCommand, field));
  if (explicitMaterialFields.length !== 0
    && explicitMaterialFields.length !== MATERIAL_AUTHORIZATION_EXPECTATION_FIELDS.length) {
    return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_MATERIAL_EXPECTATION_INCOMPLETE');
  }
  const explicitMaterialAuthorization = explicitMaterialFields.length === MATERIAL_AUTHORIZATION_EXPECTATION_FIELDS.length;
  const historicalExecutionIdentity = extracted.command?.operation === PROTECTED_WORKFLOW_DISPATCH_OPERATION
    && explicitMaterialAuthorization === false;
  const authoredAt = new Date(comment?.created_at || 0);
  const validation = validateProtectedWorkflowDispatch(extracted.command, {
    authorLogin,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    now,
    authoredAt,
    allowExpiredMaterialAuthorization: allowExpiredMaterialAuthorization === true || historicalExecutionIdentity,
  });
  if (!validation.ok) return validation;
  const expected = normalizeAuthorizationExpected(expectedCommand);
  const observed = materialAuthorizationIdentity(validation.command);
  if (observed.operation === PROTECTED_WORKFLOW_DISPATCH_OPERATION) {
    const fields = explicitMaterialAuthorization
      ? MERGE_MATERIAL_AUTHORIZATION_IDENTITY_FIELDS
      : MERGE_STABLE_AUTHORIZATION_IDENTITY_FIELDS;
    for (const field of fields) {
      if (observed[field] !== expected[field]) {
        return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_IDENTITY_MISMATCH', { field });
      }
    }
  } else {
    for (const field of READY_AUTHORIZATION_IDENTITY_FIELDS) {
      if (observed[field] !== expected[field]) {
        return fail('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_IDENTITY_MISMATCH', { field });
      }
    }
  }
  return Object.freeze({
    ok: true,
    commentId,
    authoredAtUtc: authoredAt.toISOString(),
    historicalExecutionIdentity,
    command: observed,
    materialAuthorization: Object.freeze({
      authorizationHead: observed.authorizationHead,
      authorizationHeadTree: observed.authorizationHeadTree,
      authorizationBase: observed.authorizationBase,
    }),
  });
}

export function buildProtectedWorkflowDispatchRequest(command = {}, { authorizationCommentId = 0 } = {}) {
  if (command?.operation !== PROTECTED_WORKFLOW_DISPATCH_OPERATION) {
    return fail('PROTECTED_WORKFLOW_DISPATCH_REQUEST_NOT_MERGE_OPERATION');
  }
  const commentId = positiveInteger(authorizationCommentId);
  if (!commentId) return fail('PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_COMMENT_ID_INVALID');
  const validation = validateProtectedWorkflowDispatch(command, {
    authorLogin: PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    now: new Date(Date.parse(command.expiresAt || 0) - 1),
    authoredAt: new Date(Date.parse(command.expiresAt || 0) - 2),
  });
  if (!validation.ok) return validation;
  const c = validation.command;
  return Object.freeze({
    ok: true,
    path: `/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/actions/workflows/${PROTECTED_WORKFLOW_DISPATCH_WORKFLOW_ID}/dispatches`,
    method: 'POST',
    body: Object.freeze({
      ref: 'main',
      inputs: Object.freeze({
        mode: c.mode,
        pr_number: String(c.prNumber),
        expected_branch: c.expectedBranch,
        expected_head: c.expectedHead,
        expected_head_tree: c.expectedHeadTree,
        expected_base: c.expectedBase,
        independent_review_run_id: String(c.independentReviewRunId),
        independent_review_run_attempt: String(c.independentReviewRunAttempt),
        independent_review_artifact_id: String(c.independentReviewArtifactId),
        independent_review_artifact_digest: c.independentReviewArtifactDigest,
        independent_review_payload_sha256: c.independentReviewPayloadSha256,
        authorization_comment_id: String(commentId),
      }),
    }),
  });
}

export function buildProtectedWorkflowDispatchReceipt(command = {}, dispatchedAt = new Date(), lifecycleResult = '') {
  return Object.freeze({
    schemaVersion: 'stephanos.protected-workflow-dispatch-receipt.v2',
    requestId: String(command.requestId || ''),
    repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    operation: String(command.operation || ''),
    mode: String(command.mode || ''),
    workflow: PROTECTED_WORKFLOW_DISPATCH_PATH,
    workflowRef: 'main',
    prNumber: Number(command.prNumber || 0),
    expectedBranch: String(command.expectedBranch || ''),
    expectedHead: String(command.expectedHead || ''),
    expectedHeadTree: String(command.expectedHeadTree || ''),
    expectedBase: String(command.expectedBase || ''),
    authorizationHead: String(command.authorizationHead || command.expectedHead || ''),
    authorizationHeadTree: String(command.authorizationHeadTree || command.expectedHeadTree || ''),
    authorizationBase: String(command.authorizationBase || command.expectedBase || ''),
    lifecycleResult: String(lifecycleResult || ''),
    dispatchedAtUtc: (dispatchedAt instanceof Date ? dispatchedAt : new Date(dispatchedAt)).toISOString(),
    arbitraryWorkflowAllowed: false,
    arbitraryRefAllowed: false,
    arbitraryInputAllowed: false,
    arbitraryGraphqlAllowed: false,
    arbitraryShellAllowed: false,
    credentialExportAllowed: false,
    directMainWriteAllowed: false,
    mergeAuthorityByReadyOperation: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    providerQualificationAuthority: false,
  });
}
