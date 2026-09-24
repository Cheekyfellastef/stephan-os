export const OPERATOR_LANE_CONTAINMENT_SCHEMA = 'stephanos.operator-lane-containment.v1';
export const OPERATOR_LANE_CONTAINMENT_MARKER = 'stephanos-operator-lane-containment-v1';

export const OPERATOR_LANE_CONTAINMENT_ACTION = Object.freeze({
  STOP: 'STOP',
  RESUME: 'RESUME',
});

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,180}$/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,240}$/;
const SHA40 = /^[0-9a-f]{40}$/i;
const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'commandId',
  'action',
  'repository',
  'prNumber',
  'issueNumber',
  'branch',
  'frozenHead',
  'resourceIds',
  'reason',
  'createdAtUtc',
]);

function text(value, limit = 500) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function actorLogin(comment = {}) {
  return text(comment?.user?.login ?? comment?.authorLogin ?? comment?.author?.login, 80).toLowerCase();
}

function authorAssociation(comment = {}) {
  return text(comment?.author_association ?? comment?.authorAssociation, 40).toUpperCase();
}

function createdAt(comment = {}) {
  return text(comment?.createdAt ?? comment?.created_at, 80);
}

function commentId(comment = {}) {
  const value = Number(comment?.id ?? 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function exactTarget(payload = {}, target = {}) {
  const payloadRepository = text(payload.repository, 180).toLowerCase();
  const targetRepository = text(target.repository, 180).toLowerCase();
  if (!REPOSITORY.test(payloadRepository) || payloadRepository !== targetRepository) return false;

  const targetPr = positiveInteger(target.prNumber);
  const targetIssue = positiveInteger(target.issueNumber);
  const payloadPr = positiveInteger(payload.prNumber);
  const payloadIssue = positiveInteger(payload.issueNumber);

  if (targetPr !== null && payloadPr !== targetPr) return false;
  if (targetIssue !== null && payloadIssue !== targetIssue) return false;
  if (targetPr === null && targetIssue === null) return false;

  const targetBranch = text(target.branch, 180);
  if (targetBranch && text(payload.branch, 180) !== targetBranch) return false;
  return true;
}

function parseFenceCandidates(body = '') {
  const fence = String.fromCharCode(96).repeat(3);
  const pattern = new RegExp(fence + OPERATOR_LANE_CONTAINMENT_MARKER + '\\s*([\\s\\S]*?)' + fence, 'gi');
  return [...String(body ?? '').matchAll(pattern)].map((match) => match[1].trim());
}

export function validateOperatorLaneContainmentCommandV1(payload = {}, {
  repository = '',
  prNumber = null,
  issueNumber = null,
  branch = '',
} = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_PAYLOAD_INVALID' });
  }
  const unexpected = Object.keys(payload).find((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected) return Object.freeze({ valid: false, blocker: 'CONTAINMENT_FIELD_NOT_ALLOWED', field: unexpected });
  if (payload.schemaVersion !== OPERATOR_LANE_CONTAINMENT_SCHEMA) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_SCHEMA_INVALID' });
  }

  const commandId = text(payload.commandId, 121);
  if (!COMMAND_ID.test(commandId)) return Object.freeze({ valid: false, blocker: 'CONTAINMENT_COMMAND_ID_INVALID' });

  const action = text(payload.action, 20).toUpperCase();
  if (!Object.values(OPERATOR_LANE_CONTAINMENT_ACTION).includes(action)) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_ACTION_INVALID' });
  }

  const normalizedRepository = text(payload.repository, 180);
  if (!REPOSITORY.test(normalizedRepository)) return Object.freeze({ valid: false, blocker: 'CONTAINMENT_REPOSITORY_INVALID' });

  const payloadPr = positiveInteger(payload.prNumber);
  const payloadIssue = positiveInteger(payload.issueNumber);
  if ((payloadPr === null) === (payloadIssue === null)) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_EXACTLY_ONE_TARGET_REQUIRED' });
  }

  const normalizedBranch = text(payload.branch, 180);
  if (!normalizedBranch || !BRANCH.test(normalizedBranch) || normalizedBranch.includes('..')) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_BRANCH_INVALID' });
  }

  const frozenHead = text(payload.frozenHead, 40).toLowerCase();
  if (action === OPERATOR_LANE_CONTAINMENT_ACTION.STOP && !SHA40.test(frozenHead)) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_FROZEN_HEAD_REQUIRED' });
  }
  if (frozenHead && !SHA40.test(frozenHead)) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_FROZEN_HEAD_INVALID' });
  }

  if (!Array.isArray(payload.resourceIds) || payload.resourceIds.length === 0) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_RESOURCE_SCOPE_REQUIRED' });
  }
  const resourceIds = [...new Set(payload.resourceIds.map((item) => text(item, 241)).filter(Boolean))];
  if (resourceIds.length !== payload.resourceIds.length || resourceIds.some((item) => !RESOURCE_ID.test(item) || item.includes('..'))) {
    return Object.freeze({ valid: false, blocker: 'CONTAINMENT_RESOURCE_SCOPE_INVALID' });
  }

  const reason = text(payload.reason, 500);
  if (!reason) return Object.freeze({ valid: false, blocker: 'CONTAINMENT_REASON_REQUIRED' });

  const createdAtUtc = text(payload.createdAtUtc, 80);
  const createdAtMs = Date.parse(createdAtUtc);
  if (!Number.isFinite(createdAtMs)) return Object.freeze({ valid: false, blocker: 'CONTAINMENT_TIMESTAMP_INVALID' });

  const target = { repository, prNumber, issueNumber, branch };
  if (!exactTarget(payload, target)) return Object.freeze({ valid: false, blocker: 'CONTAINMENT_TARGET_MISMATCH' });

  return Object.freeze({
    valid: true,
    blocker: '',
    command: Object.freeze({
      schemaVersion: OPERATOR_LANE_CONTAINMENT_SCHEMA,
      commandId,
      action,
      repository: normalizedRepository,
      prNumber: payloadPr,
      issueNumber: payloadIssue,
      branch: normalizedBranch,
      frozenHead,
      resourceIds: Object.freeze(resourceIds.sort()),
      reason,
      createdAtUtc: new Date(createdAtMs).toISOString(),
    }),
  });
}

export function evaluateOperatorLaneContainmentV1({
  comments = [],
  repository = '',
  prNumber = null,
  issueNumber = null,
  branch = '',
  trustedOperatorLogin = '',
} = {}) {
  const trustedLogin = text(trustedOperatorLogin, 80).toLowerCase();
  const candidates = [];
  const invalidTrustedEvidence = [];

  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!trustedLogin || actorLogin(comment) !== trustedLogin) continue;
    const association = authorAssociation(comment);
    if (association && association !== 'OWNER') continue;

    const body = String(comment?.body ?? '');
    if (!body.includes(OPERATOR_LANE_CONTAINMENT_MARKER)) continue;
    const fences = parseFenceCandidates(body);
    if (fences.length !== 1) {
      invalidTrustedEvidence.push({ commentId: commentId(comment), blocker: 'CONTAINMENT_FENCE_INVALID' });
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(fences[0]);
    } catch {
      invalidTrustedEvidence.push({ commentId: commentId(comment), blocker: 'CONTAINMENT_JSON_INVALID' });
      continue;
    }

    const validation = validateOperatorLaneContainmentCommandV1(payload, {
      repository,
      prNumber,
      issueNumber,
      branch,
    });
    if (!validation.valid) {
      if (validation.blocker !== 'CONTAINMENT_TARGET_MISMATCH') {
        invalidTrustedEvidence.push({ commentId: commentId(comment), blocker: validation.blocker });
      }
      continue;
    }

    const commandMs = Date.parse(validation.command.createdAtUtc);
    const observedMs = Date.parse(createdAt(comment));
    if (Number.isFinite(observedMs) && commandMs > observedMs + 5 * 60 * 1000) {
      invalidTrustedEvidence.push({ commentId: commentId(comment), blocker: 'CONTAINMENT_TIMESTAMP_FUTURE' });
      continue;
    }

    candidates.push({
      ...validation.command,
      commentId: commentId(comment),
      commentCreatedAtUtc: createdAt(comment),
      commandMs,
      observedMs: Number.isFinite(observedMs) ? observedMs : commandMs,
    });
  }

  if (invalidTrustedEvidence.length > 0) {
    return Object.freeze({
      schemaVersion: OPERATOR_LANE_CONTAINMENT_SCHEMA,
      evaluated: true,
      active: true,
      action: 'SAFE_HOLD',
      commandId: '',
      repository: text(repository, 180),
      prNumber: positiveInteger(prNumber),
      issueNumber: positiveInteger(issueNumber),
      branch: text(branch, 180),
      frozenHead: '',
      resourceIds: Object.freeze([]),
      reason: 'Trusted operator containment evidence is malformed or ambiguous.',
      commandCreatedAtUtc: '',
      sourceCommentId: invalidTrustedEvidence.at(-1)?.commentId || 0,
      evidenceBlockers: Object.freeze(invalidTrustedEvidence.map((item) => item.blocker)),
      sourceMutationAllowed: false,
      reconciliationAllowed: false,
      reviewDispatchAllowed: false,
      eventContinuationAllowed: false,
      providerDispatchAllowed: false,
      mergeAllowed: false,
      unrelatedWorkAllowed: true,
      finalVerdict: 'OPERATOR_LANE_CONTAINMENT_EVIDENCE_INVALID_SAFE_HOLD',
    });
  }

  candidates.sort((left, right) => (
    left.observedMs - right.observedMs
    || left.commentId - right.commentId
    || left.commandMs - right.commandMs
  ));
  const latest = candidates.at(-1) || null;
  const active = latest?.action === OPERATOR_LANE_CONTAINMENT_ACTION.STOP;

  return Object.freeze({
    schemaVersion: OPERATOR_LANE_CONTAINMENT_SCHEMA,
    evaluated: true,
    active,
    action: latest?.action || '',
    commandId: latest?.commandId || '',
    repository: text(repository, 180),
    prNumber: positiveInteger(prNumber),
    issueNumber: positiveInteger(issueNumber),
    branch: text(branch, 180),
    frozenHead: latest?.frozenHead || '',
    resourceIds: Object.freeze(latest?.resourceIds ? [...latest.resourceIds] : []),
    reason: latest?.reason || '',
    commandCreatedAtUtc: latest?.createdAtUtc || '',
    sourceCommentId: latest?.commentId || 0,
    sourceMutationAllowed: false,
    reconciliationAllowed: false,
    reviewDispatchAllowed: false,
    eventContinuationAllowed: false,
    providerDispatchAllowed: false,
    mergeAllowed: false,
    unrelatedWorkAllowed: true,
    finalVerdict: active ? 'OPERATOR_LANE_CONTAINED' : 'OPERATOR_LANE_NOT_CONTAINED',
  });
}
