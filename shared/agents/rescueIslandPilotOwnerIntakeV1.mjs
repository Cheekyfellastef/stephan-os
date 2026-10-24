// #3109: Island-owned, read-only intake classifier. Caller data is never
// an authenticated GitHub read or an independent ownership/OS observation.
// Do not pass any result from this file as approvalAuthenticated to #3105.
import { createHash } from 'node:crypto';

export const RESCUE_ISLAND_INTAKE_SCHEMA = 'stephanos.rescue-island-owner-intake.v1';
const REPO = 'Cheekyfellastef/stephan-os';
const ISSUE = 3109;
const ISSUE_TITLE = 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)';
const OWNER = 'Cheekyfellastef';
const OWNER_ID = 267490109;
const HEAD = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const TASK = /^[a-z0-9][a-z0-9-]{7,63}$/;
const SUPERVISED_INTAKE = Symbol('supervised-cooperative-intake');
const SUPERVISED_COMMAND = /^\/rescue-island-01 supervised-cooperative ([a-f0-9]{40}) ([a-z0-9][a-z0-9-]{7,63}) ([a-f0-9]{64})$/;
const COMMAND = /^\/rescue-island-01 pilot ([a-f0-9]{40}) ([a-z0-9][a-z0-9-]{7,63}) ([a-f0-9]{64})$/;
const MAX_AGE = 10 * 60 * 1000;
const COMMENT_URL = 'https://api.github.com/repos/' + REPO + '/issues/comments/';
const ISSUE_URL = 'https://api.github.com/repos/' + REPO + '/issues/' + ISSUE;

function primitive(value, pattern) { return typeof value === 'string' && pattern.test(value); }
function parseTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return NaN;
  return Date.parse(value);
}
function exactObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function matchesCommentIdentity(comment, requestedCommentId) {
  return exactObject(comment)
    && comment.id === requestedCommentId
    && comment.url === COMMENT_URL + requestedCommentId
    && comment.issue_url === ISSUE_URL
    && comment.user?.login === OWNER
    && comment.user?.type === 'User'
    && comment.user?.id === OWNER_ID
    && comment.author_association === 'OWNER'
    && typeof comment.body === 'string'
    && !comment.body.includes('\r')
    && Buffer.byteLength(comment.body, 'utf8') <= 256;
}

/**
 * Structural admission is NOT source authority. In production, GitHub event,
 * owner identity, comment ID and current main must be independently fetched
 * by a reviewed trusted host. Ownership inventory, filesystem/physical paths,
 * gaming idle and process head must then be re-observed outside this function.
 */
export function inspectRescueIslandPilotOwnerIntakeV1({
  issue, comment, commentId, mainHead, nowUtc, task, consumedCommentIds = [],
  [SUPERVISED_INTAKE]: supervised = false,
} = {}) {
  const blockers = [];
  const now = parseTimestamp(nowUtc);
  const created = parseTimestamp(comment?.created_at);
  const updated = parseTimestamp(comment?.updated_at);
  const expires = parseTimestamp(task?.expiresAtUtc);
  if (!Number.isSafeInteger(commentId) || commentId <= 0
      || !matchesCommentIdentity(comment, commentId)) blockers.push('OWNER_COMMENT_IDENTITY_UNPROVEN');
  if (!exactObject(issue) || issue.number !== ISSUE
      || issue.title !== ISSUE_TITLE || issue.state !== 'open'
      || issue.url !== ISSUE_URL || issue.pull_request) blockers.push('PILOT_ISSUE_IDENTITY_UNPROVEN');
  if (!Number.isFinite(now) || !Number.isFinite(created) || !Number.isFinite(updated)
      || created !== updated || created > now || now - created > MAX_AGE)
    blockers.push('OWNER_COMMENT_FRESHNESS_UNPROVEN');
  if (!primitive(mainHead, HEAD)) blockers.push('CURRENT_MAIN_UNPROVEN');
  if (!Array.isArray(consumedCommentIds)
      || consumedCommentIds.some(v => !Number.isSafeInteger(v) || v <= 0)
      || new Set(consumedCommentIds).size !== consumedCommentIds.length
      || consumedCommentIds.includes(commentId)) blockers.push('COMMENT_ALREADY_OWNED_OR_INVENTORY_INVALID');
  if (!exactObject(task) || task.schemaVersion !== 'stephanos.rescue-island-pilot-task.v1'
      || task.repository !== REPO || task.issueNumber !== ISSUE
      || task.issueTitle !== ISSUE_TITLE || task.workerId !== 'rescue-island-01'
      || !primitive(task.taskId, TASK) || !primitive(task.baseHead, HEAD)
      || !primitive(task.targetPath, /^docs\/architecture\/rescue-island-pilot-[a-z0-9-]+\.md$/)
      || task.targetPath !== 'docs/architecture/rescue-island-pilot-' + task.taskId + '.md'
      || task.testPath !== 'shared/agents/rescueIslandPreflightV1.test.mjs'
      || task.approvalSource !== 'EXTERNAL_OWNER_ATTESTATION_REQUIRED'
      || typeof task.content !== 'string' || !task.content.startsWith('# Rescue Island pilot\n')
      || Buffer.byteLength(task.content || '', 'utf8') > 8192
      || (typeof task.content === 'string' && task.content.length < 40)
      || task.content?.includes?.('\0') === true
      || !Number.isFinite(expires) || expires <= now || expires - now > MAX_AGE)
    blockers.push('TASK_IDENTITY_SCOPE_OR_EXPIRY_INVALID');
  if (task?.baseHead !== mainHead) blockers.push('TASK_HEAD_NOT_CURRENT_MAIN');
  const match = typeof comment?.body === 'string' ? comment.body.match(supervised ? SUPERVISED_COMMAND : COMMAND) : null;
  const hash = typeof task?.content === 'string'
    ? createHash('sha256').update(task.content, 'utf8').digest('hex') : '';
  if (!match || match[1] !== mainHead || match[2] !== task?.taskId
      || !primitive(hash, HASH) || match[3] !== hash)
    blockers.push('OWNER_COMMAND_CONTENT_BINDING_INVALID');

  return Object.freeze({
    schemaVersion: RESCUE_ISLAND_INTAKE_SCHEMA,
    ...(supervised ? { assuranceProfile: 'SUPERVISED_COOPERATIVE_V1' } : {}),
    issueNumber: ISSUE,
    workerId: 'rescue-island-01',
    taskId: primitive(task?.taskId, TASK) ? task.taskId : '',
    requestedSourceHead: primitive(mainHead, HEAD) ? mainHead : '',
    commentId: Number.isSafeInteger(commentId) && commentId > 0 ? commentId : null,
    disposition: blockers.length ? 'HELD' : 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED',
    blockers: Object.freeze([...new Set(blockers)]),
    approvalAuthenticated: false,
    ownershipAuthenticated: false,
    productionAdmissionAllowed: false,
    physicalPickupAllowed: false,
    sourceMutationAllowed: false,
    canonicalLeaseAccessAllowed: false,
    seedForgeQueueAccessAllowed: false,
    mergeAllowed: false,
    unattendedRefillAllowed: false,
  });
}

// A distinct owner command explicitly accepts the reduced assurance profile.
// Like the ordinary intake, this parser alone grants no execution authority.
export function inspectRescueIslandSupervisedOwnerIntakeV1(input = {}) {
  return inspectRescueIslandPilotOwnerIntakeV1({ ...input, [SUPERVISED_INTAKE]: true });
}
