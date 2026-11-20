import { CANONICAL_MAILBOX_ISSUE, RETIRED_CANONICAL_MAILBOX_ISSUES,
  evaluateCanonicalMailboxCapacity } from './canonicalMailboxAuthorityV1.mjs';

export const CONTROL_TOWER_BUILD_SCHEMA = 'stephanos.control-tower-build-request.v1';
export const CONTROL_TOWER_OWNER_COMMENT_SCHEMA = 'stephanos.control-tower-owner-comment-request.v1';
export const CONTROL_TOWER_OWNER_COMMAND_SCHEMA = 'stephanos.control-tower-owner-command.v1';
export const CONTROL_TOWER_OWNER_COMMENT_MARKER = '<!-- stephanos-control-tower-owner-command-v1 -->';
export const CONTROL_TOWER_BUILD_WORKFLOW = '.github/workflows/stephanos-control-tower-build.yml';
export const CONTROL_TOWER_BUILD_FILE = 'control-tower-build-request.json';
export const CONTROL_TOWER_BUILD_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const CONTROL_TOWER_BUILD_OPERATION = 'BUILD_NEXT_ELIGIBLE_GOAL';
export const CONTROL_TOWER_OBSERVE_OPERATION = 'OBSERVE_CONTROL_SYSTEM';
export const CONTROL_TOWER_OPERATIONS_V1 = Object.freeze([
  CONTROL_TOWER_BUILD_OPERATION, CONTROL_TOWER_OBSERVE_OPERATION,
]);
export const CONTROL_TOWER_BUILD_KEYS = Object.freeze([
  'schemaVersion', 'requestId', 'operation', 'repository', 'repositoryId', 'operatorId',
  'runId', 'runAttempt', 'sourceHead', 'createdAtUtc', 'expiresAtUtc',
  'admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed',
]);
export const CONTROL_TOWER_OWNER_COMMENT_KEYS = Object.freeze([
  ...CONTROL_TOWER_BUILD_KEYS, 'ownerCommentId', 'ownerCommentIssueNumber', 'ownerCommentSha256',
]);
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const API = 'https://api.github.com/repos/' + CONTROL_TOWER_BUILD_REPOSITORY;
const positive = n => Number.isSafeInteger(n) && n > 0;
const utc = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)
  && Number.isFinite(Date.parse(s));
const denied = blocker => Object.freeze({ ok: false, blocker });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const owner = value => value?.login === 'Cheekyfellastef' && value.id === 267490109 && value.type === 'User';

// Both variants use the ORIGINAL create-once execution ledger. Comment identity
// is independent of run identity: a redelivery through a different run cannot
// acquire a new reservation for the same owner command.
export function parseControlTowerRequestIdV1(value) {
  const match = typeof value === 'string' ? /^control-tower-(build|comment)-([1-9][0-9]{0,15})-1$/.exec(value) : null;
  if (!match || !positive(Number(match[2]))) return null;
  return Object.freeze({ requestId: value, runId: match[1] === 'build' ? Number(match[2]) : null,
    ownerCommentId: match[1] === 'comment' ? Number(match[2]) : null });
}
export function controlTowerRequestIdentityValidV1(value) {
  const identity = parseControlTowerRequestIdV1(value?.requestId);
  return Boolean(identity && positive(value?.runId) && (identity.ownerCommentId
    ? value.ownerCommentId === identity.ownerCommentId
    : value.runId === identity.runId && value.ownerCommentId === undefined));
}
export function formatControlTowerOwnerCommandV1(command) {
  return CONTROL_TOWER_OWNER_COMMENT_MARKER + '\n```json\n' + JSON.stringify({
    schemaVersion: command?.schemaVersion, operation: command?.operation, expectedMain: command?.expectedMain,
  }, null, 2) + '\n```';
}

// Pure validation is not authentication. Only the fixed Actions producer and
// native authenticated GitHub reader supply these independent API observations.
export function validateControlTowerOwnerCommentV1(comment, issue, mainHead, nowUtc) {
  if (!positive(comment?.id) || !owner(comment.user)
    || comment.issue_url !== API + '/issues/' + CANONICAL_MAILBOX_ISSUE
    || !utc(comment.created_at) || comment.updated_at !== comment.created_at || !utc(nowUtc)
    || Date.parse(comment.created_at) > Date.parse(nowUtc)
    || Date.parse(nowUtc) - Date.parse(comment.created_at) >= 600000)
    return denied('CONTROL_TOWER_OWNER_COMMENT_IDENTITY_OR_FRESHNESS_INVALID');
  const capacity = evaluateCanonicalMailboxCapacity({ issueNumber: issue?.number, commentCount: issue?.comments });
  if (issue?.number !== CANONICAL_MAILBOX_ISSUE || issue.repository_url !== API
    || issue.url !== comment.issue_url || issue.pull_request != null || issue.state !== 'open' || issue.locked !== false
    || !Number.isSafeInteger(issue.comments) || issue.comments < 0
    || !capacity.ok || capacity.rotationRequired)
    return denied('CONTROL_TOWER_OWNER_COMMENT_MAILBOX_INVALID');
  const body = comment.body;
  if (typeof body !== 'string' || body.length > 1024 || !body.startsWith(CONTROL_TOWER_OWNER_COMMENT_MARKER + '\n```json\n')
    || !body.endsWith('\n```')) return denied('CONTROL_TOWER_OWNER_COMMENT_COMMAND_INVALID');
  let command;
  try { command = JSON.parse(body.slice((CONTROL_TOWER_OWNER_COMMENT_MARKER + '\n```json\n').length, -4)); }
  catch { return denied('CONTROL_TOWER_OWNER_COMMENT_COMMAND_INVALID'); }
  if (!exactKeys(command, ['schemaVersion', 'operation', 'expectedMain'])
    || command.schemaVersion !== CONTROL_TOWER_OWNER_COMMAND_SCHEMA
    || !CONTROL_TOWER_OPERATIONS_V1.includes(command.operation) || !SHA.test(mainHead || '')
    || command.expectedMain !== mainHead || body !== formatControlTowerOwnerCommandV1(command))
    return denied('CONTROL_TOWER_OWNER_COMMENT_COMMAND_INVALID');
  return Object.freeze({ ok: true, blocker: '', operation: command.operation,
    createdAtUtc: comment.created_at, expiresAtUtc: new Date(Date.parse(comment.created_at) + 600000).toISOString() });
}

function ownerCommentMetadataValid(request, historical = false) {
  return positive(request.ownerCommentId) && typeof request.ownerCommentSha256 === 'string'
    && HASH.test(request.ownerCommentSha256)
    && (historical ? [CANONICAL_MAILBOX_ISSUE, ...RETIRED_CANONICAL_MAILBOX_ISSUES].includes(request.ownerCommentIssueNumber)
      : request.ownerCommentIssueNumber === CANONICAL_MAILBOX_ISSUE);
}
function requestScopeValid(request, historical = false) {
  const comment = request?.schemaVersion === CONTROL_TOWER_OWNER_COMMENT_SCHEMA;
  return exactKeys(request, comment ? CONTROL_TOWER_OWNER_COMMENT_KEYS : CONTROL_TOWER_BUILD_KEYS)
    && (comment || request.schemaVersion === CONTROL_TOWER_BUILD_SCHEMA)
    && CONTROL_TOWER_OPERATIONS_V1.includes(request.operation)
    && request.repository === CONTROL_TOWER_BUILD_REPOSITORY && request.repositoryId === 1179385578
    && request.operatorId === 267490109 && request.runAttempt === 1 && controlTowerRequestIdentityValidV1(request)
    && (!comment || ownerCommentMetadataValid(request, historical))
    && ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed']
      .every(key => request[key] === false);
}
function requestRunEventValid(request, run) {
  return request.schemaVersion === CONTROL_TOWER_OWNER_COMMENT_SCHEMA
    ? run.event === 'issue_comment' : ['workflow_dispatch', 'push'].includes(run.event)
      && (run.event !== 'push' || request.operation === CONTROL_TOWER_BUILD_OPERATION);
}
function requestOriginTimeValid(request, run) {
  return request.schemaVersion === CONTROL_TOWER_OWNER_COMMENT_SCHEMA
    ? Date.parse(request.createdAtUtc) <= Date.parse(run.created_at)
      && Date.parse(run.created_at) < Date.parse(request.expiresAtUtc)
    : Date.parse(request.createdAtUtc) >= Date.parse(run.created_at);
}

export function createControlTowerBuildRequestV1(event, env, mainHead, nowUtc, readback = null) {
  // A protected-main push by the exact owner is a bounded standing intent to
  // wake the ORIGINAL scheduler. It is not source, runtime or merge authority.
  // Manual workflow_dispatch remains available as the explicit fallback.
  const manual = env?.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && ['main', 'refs/heads/main'].includes(event?.ref);
  const ownerMainPush = env?.GITHUB_EVENT_NAME === 'push'
    && event?.ref === 'refs/heads/main' && event?.after === mainHead
    && SHA.test(event?.before || '') && event.before !== mainHead
    && event?.head_commit?.id === mainHead
    && event?.created === false && event?.deleted === false && event?.forced === false
    && event?.inputs == null;
  const ownerComment = env?.GITHUB_EVENT_NAME === 'issue_comment'
    && event?.action === 'created' && event?.issue?.number === CANONICAL_MAILBOX_ISSUE
    && event.issue.pull_request == null && owner(event?.comment?.user) && event?.inputs == null;
  if (env?.GITHUB_ACTIONS !== 'true' || (!manual && !ownerMainPush && !ownerComment)
    || env.GITHUB_JOB !== 'request-build' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REPOSITORY !== CONTROL_TOWER_BUILD_REPOSITORY
    || env.GITHUB_WORKFLOW_REF !== CONTROL_TOWER_BUILD_REPOSITORY + '/' + CONTROL_TOWER_BUILD_WORKFLOW + '@refs/heads/main'
    || env.GITHUB_WORKFLOW_SHA !== mainHead
    || event?.repository?.full_name !== CONTROL_TOWER_BUILD_REPOSITORY || event.repository.id !== 1179385578
    || event.repository.owner?.login !== 'Cheekyfellastef'
    || env.GITHUB_ACTOR !== 'Cheekyfellastef' || env.GITHUB_ACTOR_ID !== '267490109'
    || env.GITHUB_TRIGGERING_ACTOR !== 'Cheekyfellastef'
    || event.sender?.login !== 'Cheekyfellastef' || event.sender?.id !== 267490109 || event.sender?.type !== 'User')
    return denied('AUTHENTICATED_BUILD_DISPATCH_INVALID');
  let commentProof = null;
  if (ownerComment) {
    commentProof = validateControlTowerOwnerCommentV1(readback?.comment, readback?.issue, mainHead, nowUtc);
    const originalProof = validateControlTowerOwnerCommentV1(event.comment, event.issue, mainHead, nowUtc);
    if (!commentProof.ok || !originalProof.ok || event.comment.id !== readback?.comment?.id
      || event.comment.body !== readback.comment.body || event.comment.created_at !== readback.comment.created_at
      || !HASH.test(readback.bodySha256 || '')) return denied('CONTROL_TOWER_OWNER_COMMENT_READBACK_INVALID');
  } else if (readback != null) return denied('BUILD_DISPATCH_INPUTS_FORBIDDEN');
  // The existing authenticated carrier has two fixed operations. An observation
  // never enters the maintenance executor. Neither accepts free text, a path,
  // a command, a goal grant, or any mailbox-rotation authority.
  if (event.inputs != null && (typeof event.inputs !== 'object' || Array.isArray(event.inputs)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(event.inputs))
    || Object.keys(event.inputs).some(key => key !== 'operation')))
    return denied('BUILD_DISPATCH_INPUTS_FORBIDDEN');
  const operation = commentProof ? commentProof.operation
    : manual && event.inputs != null && Object.hasOwn(event.inputs, 'operation')
      ? event.inputs.operation : CONTROL_TOWER_BUILD_OPERATION;
  if (!CONTROL_TOWER_OPERATIONS_V1.includes(operation)) return denied('BUILD_DISPATCH_INPUTS_FORBIDDEN');
  if (!SHA.test(mainHead || '') || env.GITHUB_SHA !== mainHead || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^[1-9][0-9]{0,15}$/.test(env.GITHUB_RUN_ID || '') || !positive(Number(env.GITHUB_RUN_ID)) || !utc(nowUtc))
    return denied('BUILD_DISPATCH_SOURCE_RUN_OR_CLOCK_INVALID');
  return Object.freeze({ ok: true, blocker: '', request: Object.freeze({
    schemaVersion: ownerComment ? CONTROL_TOWER_OWNER_COMMENT_SCHEMA : CONTROL_TOWER_BUILD_SCHEMA,
    requestId: ownerComment ? 'control-tower-comment-' + readback.comment.id + '-1'
      : 'control-tower-build-' + env.GITHUB_RUN_ID + '-1',
    operation, repository: CONTROL_TOWER_BUILD_REPOSITORY,
    repositoryId: 1179385578, operatorId: 267490109, runId: Number(env.GITHUB_RUN_ID), runAttempt: 1,
    sourceHead: mainHead, createdAtUtc: commentProof?.createdAtUtc || nowUtc,
    expiresAtUtc: commentProof?.expiresAtUtc || new Date(Date.parse(nowUtc) + 600000).toISOString(),
    ...(ownerComment ? { ownerCommentId: readback.comment.id, ownerCommentIssueNumber: CANONICAL_MAILBOX_ISSUE,
      ownerCommentSha256: readback.bodySha256 } : {}),
    admissionGranted: false, mergeAuthority: false, runtimeMutationAuthority: false,
    leaseSeizureAllowed: false, arbitraryShellAllowed: false,
  }) });
}

export function validateHistoricalControlTowerBuildRequestV1(request, run, sourceHead, nowUtc) {
  if (!requestScopeValid(request, true)) return denied('BUILD_REQUEST_SCOPE_INVALID');
  if (!SHA.test(sourceHead || '') || request.sourceHead !== sourceHead || run?.head_sha !== sourceHead
    || run.id !== request.runId || run.head_branch !== 'main' || run.run_attempt !== 1
    || !requestRunEventValid(request, run)
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== CONTROL_TOWER_BUILD_WORKFLOW || run.repository?.full_name !== CONTROL_TOWER_BUILD_REPOSITORY
    || run.repository?.id !== 1179385578 || !owner(run.actor) || !owner(run.triggering_actor))
    return denied('BUILD_REQUEST_AUTHENTICATED_RUN_INVALID');
  if (![request.createdAtUtc, request.expiresAtUtc, run.created_at, run.updated_at, nowUtc].every(utc)
    || Date.parse(run.updated_at) < Date.parse(run.created_at)
    || !requestOriginTimeValid(request, run)
    || Date.parse(request.createdAtUtc) > Date.parse(run.updated_at) + 5000
    || Date.parse(request.createdAtUtc) > Date.parse(nowUtc) + 5000
    || Date.parse(run.updated_at) > Date.parse(nowUtc) + 5000
    || Date.parse(request.expiresAtUtc) - Date.parse(request.createdAtUtc) !== 600000
    || Date.parse(request.expiresAtUtc) > Date.parse(nowUtc))
    return denied('BUILD_REQUEST_HISTORICAL_WINDOW_UNPROVEN');
  return Object.freeze({ ok: true, blocker: '' });
}

export function validateControlTowerBuildRequestV1(request, run, mainHead, nowUtc) {
  if (!requestScopeValid(request)) return denied('BUILD_REQUEST_SCOPE_INVALID');
  if (!SHA.test(mainHead || '') || request.sourceHead !== mainHead || run?.head_sha !== mainHead
    || run.id !== request.runId || run.head_branch !== 'main' || run.run_attempt !== 1
    || !requestRunEventValid(request, run)
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== CONTROL_TOWER_BUILD_WORKFLOW || run.repository?.full_name !== CONTROL_TOWER_BUILD_REPOSITORY
    || run.repository?.id !== 1179385578 || !owner(run.actor) || !owner(run.triggering_actor))
    return denied('BUILD_REQUEST_AUTHENTICATED_RUN_INVALID');
  if (![request.createdAtUtc, request.expiresAtUtc, run.created_at, run.updated_at, nowUtc].every(utc)
    || Date.parse(run.updated_at) < Date.parse(run.created_at)
    || !requestOriginTimeValid(request, run)
    || Date.parse(request.createdAtUtc) > Date.parse(run.updated_at) + 5000
    || Date.parse(request.createdAtUtc) > Date.parse(nowUtc) + 5000
    || Date.parse(run.updated_at) > Date.parse(nowUtc) + 5000
    || Date.parse(request.expiresAtUtc) - Date.parse(request.createdAtUtc) !== 600000
    || Date.parse(request.expiresAtUtc) <= Date.parse(nowUtc)) return denied('BUILD_REQUEST_EXPIRED_OR_CLOCK_INVALID');
  return Object.freeze({ ok: true, blocker: '' });
}
