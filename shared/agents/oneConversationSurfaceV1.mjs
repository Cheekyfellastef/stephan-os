import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const ONE_CONVERSATION_SURFACE_SCHEMA_VERSION = 'stephanos.one-conversation-surface.v1';
export const ONE_CONVERSATION_PARTICIPANT_ID = 'stephanos';

export const ONE_CONVERSATION_SURFACES = Object.freeze([
  'CHATGPT_WEB',
  'BATTLE_BRIDGE_DESKTOP',
  'CHATGPT_WORK',
  'CODEX',
  'OPENCLAW_LOCAL',
  'PHONE',
  'TABLET',
  'WHATSAPP',
  'VOICE',
  'QUEST_3',
]);

export const ONE_CONVERSATION_STATUSES = Object.freeze([
  'CURRENT',
  'STALE',
  'EVIDENCE_CONFLICTING',
  'UNKNOWN',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,120}$/i;
const AUTHORITY_KEYS = Object.freeze([
  'sourceMutationAllowed',
  'commandExecutionAllowed',
  'approvalAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function safeId(value) {
  const result = text(value);
  return SAFE_ID.test(result) ? result : '';
}

function isTimestamp(value) {
  return Number.isFinite(Date.parse(text(value)));
}

function unique(values = []) {
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    authoritySource: 'EXISTING_GOVERNED_TASK_AND_APPROVAL_CONTRACTS_ONLY',
  });
}

function normalizeObservation(observation = {}) {
  return Object.freeze({
    surface: text(observation.surface),
    surfaceThreadRef: safeId(observation.surfaceThreadRef),
    stephanosIdentityVersion: safeId(observation.stephanosIdentityVersion),
    intentId: safeId(observation.intentId),
    missionId: safeId(observation.missionId),
    operatorRelationshipContextRef: safeId(observation.operatorRelationshipContextRef),
    memoryAuthorityRef: safeId(observation.memoryAuthorityRef),
    timestampUtc: text(observation.timestampUtc),
    evidenceRefs: unique(observation.evidenceRefs),
    underlyingMind: text(observation.underlyingMind),
    executionSurface: text(observation.executionSurface),
  });
}

export function validateOneConversationInputV1(input = {}) {
  const errors = [];
  const stephanosIdentityVersion = safeId(input.stephanosIdentityVersion);
  const operatorRelationshipContextRef = safeId(input.operatorRelationshipContextRef);
  const intentId = safeId(input.intentId);
  const missionId = safeId(input.missionId);
  const memoryAuthorityRef = safeId(input.memoryAuthorityRef);
  const timestampUtc = text(input.timestampUtc);
  const observations = Array.isArray(input.surfaceObservations)
    ? input.surfaceObservations.map(normalizeObservation)
    : [];

  if (!stephanosIdentityVersion) errors.push('invalid-stephanos-identity-version');
  if (!operatorRelationshipContextRef) errors.push('invalid-operator-relationship-context-ref');
  if (!intentId) errors.push('invalid-intent-id');
  if (!missionId) errors.push('invalid-mission-id');
  if (!memoryAuthorityRef) errors.push('invalid-memory-authority-ref');
  if (!isTimestamp(timestampUtc)) errors.push('invalid-timestamp-utc');
  if (observations.length === 0) errors.push('missing-surface-observations');

  for (const [index, observation] of observations.entries()) {
    if (!ONE_CONVERSATION_SURFACES.includes(observation.surface)) errors.push(`unsupported-surface:${index}`);
    if (!observation.surfaceThreadRef) errors.push(`invalid-surface-thread-ref:${index}`);
    if (!isTimestamp(observation.timestampUtc)) errors.push(`invalid-observation-timestamp:${index}`);
    if (observation.evidenceRefs.length === 0) errors.push(`missing-observation-evidence:${index}`);
    if (observation.stephanosIdentityVersion && observation.stephanosIdentityVersion !== stephanosIdentityVersion) errors.push(`identity-conflict:${index}`);
    if (observation.intentId && observation.intentId !== intentId) errors.push(`intent-conflict:${index}`);
    if (observation.missionId && observation.missionId !== missionId) errors.push(`mission-conflict:${index}`);
    if (observation.operatorRelationshipContextRef && observation.operatorRelationshipContextRef !== operatorRelationshipContextRef) errors.push(`relationship-context-conflict:${index}`);
    if (observation.memoryAuthorityRef && observation.memoryAuthorityRef !== memoryAuthorityRef) errors.push(`memory-authority-conflict:${index}`);
  }

  for (const key of AUTHORITY_KEYS) {
    if (input[key] === true) errors.push(`authority-widening-forbidden:${key}`);
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    normalized: Object.freeze({
      stephanosIdentityVersion,
      operatorRelationshipContextRef,
      intentId,
      missionId,
      memoryAuthorityRef,
      timestampUtc,
      surfaceObservations: Object.freeze(observations),
    }),
  });
}

export function buildOneConversationProjectionV1(input = {}, options = {}) {
  const validation = validateOneConversationInputV1(input);
  if (!validation.valid) {
    const conflict = validation.errors.some((error) => error.includes('conflict'));
    return Object.freeze({
      schemaVersion: ONE_CONVERSATION_SURFACE_SCHEMA_VERSION,
      projectionKind: 'stephanos.one-conversation.projection',
      status: conflict ? 'EVIDENCE_CONFLICTING' : 'UNKNOWN',
      reason: validation.errors[0] || 'INVALID_INPUT',
      validation,
      operatorNeeded: false,
      authority: authorityBoundary(),
    });
  }

  const normalized = validation.normalized;
  const bySurface = new Map();
  for (const observation of normalized.surfaceObservations) {
    const current = bySurface.get(observation.surface);
    if (!current || Date.parse(observation.timestampUtc) > Date.parse(current.timestampUtc)) {
      bySurface.set(observation.surface, observation);
    }
  }

  const observations = [...bySurface.values()].sort((left, right) => left.surface.localeCompare(right.surface));
  const newestObservationMs = Math.max(...observations.map((observation) => Date.parse(observation.timestampUtc)));
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.parse(normalized.timestampUtc);
  const staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : 60 * 60 * 1000;
  const status = nowMs - newestObservationMs > staleAfterMs ? 'STALE' : 'CURRENT';

  const projection = {
    schemaVersion: ONE_CONVERSATION_SURFACE_SCHEMA_VERSION,
    projectionKind: 'stephanos.one-conversation.projection',
    status,
    stephanosIdentityVersion: normalized.stephanosIdentityVersion,
    operatorRelationshipContextRef: normalized.operatorRelationshipContextRef,
    intentId: normalized.intentId,
    missionId: normalized.missionId,
    memoryAuthorityRef: normalized.memoryAuthorityRef,
    surfaceThreadRefs: Object.freeze(Object.fromEntries(observations.map((observation) => [observation.surface, observation.surfaceThreadRef]))),
    activeSurfaces: Object.freeze(observations.map((observation) => observation.surface)),
    evidenceRefs: Object.freeze(unique(observations.flatMap((observation) => observation.evidenceRefs))),
    routeVisibility: options.includeRouteAudit === true ? 'AUDIT_VISIBLE' : 'HIDDEN_BY_DEFAULT',
    operatorNeeded: false,
    operatorAction: 'NO_OPERATOR_ACTION_REQUIRED',
    authority: authorityBoundary(),
  };

  if (options.includeRouteAudit === true) {
    projection.routeAudit = Object.freeze(observations.map((observation) => Object.freeze({
      surface: observation.surface,
      underlyingMind: observation.underlyingMind || 'UNSPECIFIED',
      executionSurface: observation.executionSurface || 'UNSPECIFIED',
    })));
  }

  return Object.freeze(projection);
}

export function planCrossSurfaceContinuationV1(projection = {}, input = {}) {
  const fromSurface = text(input.fromSurface);
  const toSurface = text(input.toSurface);
  if (!ONE_CONVERSATION_SURFACES.includes(fromSurface) || !ONE_CONVERSATION_SURFACES.includes(toSurface)) {
    return Object.freeze({ ok: false, verdict: 'CONTINUATION_BLOCKED_UNSUPPORTED_SURFACE', operatorNeeded: false });
  }
  if (projection.status === 'EVIDENCE_CONFLICTING') {
    return Object.freeze({ ok: false, verdict: 'CONTINUATION_BLOCKED_EVIDENCE_CONFLICTING', operatorNeeded: false });
  }
  if (projection.status !== 'CURRENT') {
    return Object.freeze({ ok: false, verdict: 'CONTINUATION_BLOCKED_STALE_OR_UNKNOWN', operatorNeeded: false });
  }
  if (!safeId(projection.stephanosIdentityVersion) || !safeId(projection.intentId) || !safeId(projection.missionId)) {
    return Object.freeze({ ok: false, verdict: 'CONTINUATION_BLOCKED_IDENTITY_INCOMPLETE', operatorNeeded: false });
  }
  if (!projection.surfaceThreadRefs?.[fromSurface]) {
    return Object.freeze({ ok: false, verdict: 'CONTINUATION_BLOCKED_SOURCE_THREAD_UNPROVEN', operatorNeeded: false });
  }

  return Object.freeze({
    ok: true,
    verdict: 'ONE_CONVERSATION_CONTINUATION_READY',
    fromSurface,
    toSurface,
    stephanosIdentityVersion: projection.stephanosIdentityVersion,
    operatorRelationshipContextRef: projection.operatorRelationshipContextRef,
    intentId: projection.intentId,
    missionId: projection.missionId,
    memoryAuthorityRef: projection.memoryAuthorityRef,
    sourceThreadRef: projection.surfaceThreadRefs[fromSurface],
    destinationThreadRef: projection.surfaceThreadRefs[toSurface] || '',
    destinationThreadCreationRequired: !projection.surfaceThreadRefs[toSurface],
    carryOnlyBoundedContext: true,
    operatorNeeded: false,
    authority: authorityBoundary(),
  });
}

export function projectOneConversationWorkspaceMessageV1(projection = {}, input = {}) {
  if (projection.status !== 'CURRENT') {
    return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_PROJECTION_NOT_CURRENT' });
  }
  const timestampUtc = text(input.timestampUtc);
  const correlationId = safeId(input.correlationId || projection.intentId);
  const messageId = safeId(input.messageId || `one-conversation-${projection.intentId}`);
  const relatedIssue = text(input.relatedIssue, '#1630');
  const proofRefs = unique(input.proofRefs?.length ? input.proofRefs : projection.evidenceRefs);
  if (!isTimestamp(timestampUtc) || !correlationId || !messageId || proofRefs.length === 0) {
    return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_MESSAGE_IDENTITY_INCOMPLETE' });
  }

  const record = {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId,
    participantId: ONE_CONVERSATION_PARTICIPANT_ID,
    timestampUtc,
    correlationId,
    relatedIssue,
    proofRefs,
    channel: 'one-conversation-surface',
    summary: `Stephanos conversation continuity for ${projection.intentId}`,
    body: JSON.stringify({
      schemaVersion: ONE_CONVERSATION_SURFACE_SCHEMA_VERSION,
      status: projection.status,
      stephanosIdentityVersion: projection.stephanosIdentityVersion,
      operatorRelationshipContextRef: projection.operatorRelationshipContextRef,
      intentId: projection.intentId,
      missionId: projection.missionId,
      memoryAuthorityRef: projection.memoryAuthorityRef,
      surfaceThreadRefs: projection.surfaceThreadRefs,
      activeSurfaces: projection.activeSurfaces,
      operatorNeeded: false,
      authority: authorityBoundary(),
    }),
  };

  const workspaceValidation = validateSharedWorkspaceRecord(record, input.workspaceValidationOptions);
  if (!workspaceValidation.valid) {
    return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_WORKSPACE_RECORD_INVALID', record, workspaceValidation });
  }
  return Object.freeze({ ok: true, reason: 'ONE_CONVERSATION_WORKSPACE_MESSAGE_READY', record, workspaceValidation });
}
