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
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
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
  if (typeof value !== 'string') return '';
  const result = value.trim();
  return SAFE_ID.test(result) ? result : '';
}

function isTimestamp(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value.trim()));
}

function strictStringList(values) {
  if (!Array.isArray(values)) return Object.freeze({ valid: false, values: Object.freeze([]) });
  const normalized = [];
  for (const value of values) {
    if (typeof value !== 'string') return Object.freeze({ valid: false, values: Object.freeze([]) });
    const candidate = value.trim();
    if (!candidate) return Object.freeze({ valid: false, values: Object.freeze([]) });
    normalized.push(candidate);
  }
  if (new Set(normalized).size !== normalized.length) return Object.freeze({ valid: false, values: Object.freeze([]) });
  return Object.freeze({ valid: true, values: Object.freeze(normalized) });
}

function strictProofRefList(values) {
  const parsed = strictStringList(values);
  if (!parsed.valid) return parsed;
  if (parsed.values.some((value) => !SAFE_PROOF_REF.test(value) || value.includes('..'))) {
    return Object.freeze({ valid: false, values: Object.freeze([]) });
  }
  return parsed;
}

function boundedDuration(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function retainedDuration(value, fallback) {
  return Math.min(boundedDuration(value, fallback), fallback);
}

function sameStringSet(left, right) {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
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

function continuityIdentityComplete(value = {}) {
  return Boolean(
    safeId(value.stephanosIdentityVersion)
    && safeId(value.operatorRelationshipContextRef)
    && safeId(value.intentId)
    && safeId(value.missionId)
    && safeId(value.memoryAuthorityRef)
  );
}

function normalizeObservation(observation) {
  const observationWasRecord = Boolean(observation && typeof observation === 'object' && !Array.isArray(observation));
  const candidate = observationWasRecord ? observation : {};
  const evidence = strictProofRefList(candidate.evidenceRefs);
  return Object.freeze({
    observationWasRecord,
    surface: text(candidate.surface),
    surfaceThreadRef: safeId(candidate.surfaceThreadRef),
    stephanosIdentityVersion: safeId(candidate.stephanosIdentityVersion),
    intentId: safeId(candidate.intentId),
    missionId: safeId(candidate.missionId),
    operatorRelationshipContextRef: safeId(candidate.operatorRelationshipContextRef),
    memoryAuthorityRef: safeId(candidate.memoryAuthorityRef),
    timestampUtc: typeof candidate.timestampUtc === 'string' ? candidate.timestampUtc.trim() : '',
    evidenceRefs: evidence.values,
    evidenceRefsWasArray: Array.isArray(candidate.evidenceRefs),
    evidenceRefsValid: evidence.valid,
    underlyingMind: text(candidate.underlyingMind),
    executionSurface: text(candidate.executionSurface),
  });
}

function classifyObservedAt(observedAt = {}, nowMs, staleAfterMs, maxFutureSkewMs) {
  const freshness = {};
  const invalid = [];
  const future = [];
  for (const [surface, timestampUtc] of Object.entries(observedAt || {})) {
    if (!ONE_CONVERSATION_SURFACES.includes(surface) || !isTimestamp(timestampUtc)) {
      invalid.push(surface || 'unknown');
      continue;
    }
    const observationMs = Date.parse(timestampUtc);
    if (observationMs > nowMs + maxFutureSkewMs) {
      freshness[surface] = 'UNKNOWN';
      future.push(surface);
    } else if (nowMs - observationMs > staleAfterMs) {
      freshness[surface] = 'STALE';
    } else {
      freshness[surface] = 'CURRENT';
    }
  }
  return Object.freeze({
    freshness: Object.freeze(freshness),
    invalid: Object.freeze(invalid),
    future: Object.freeze(future),
    currentCount: Object.values(freshness).filter((value) => value === 'CURRENT').length,
  });
}

function validateRetainedSurfaceSet(projection, observedAt) {
  const active = strictStringList(projection.activeSurfaces);
  if (!active.valid || active.values.length === 0 || active.values.some((surface) => !ONE_CONVERSATION_SURFACES.includes(surface))) return false;
  if (!projection.surfaceThreadRefs || typeof projection.surfaceThreadRefs !== 'object' || Array.isArray(projection.surfaceThreadRefs)) return false;
  const observedSurfaces = Object.keys(observedAt);
  const threadSurfaces = Object.keys(projection.surfaceThreadRefs);
  if (!sameStringSet([...active.values], observedSurfaces) || !sameStringSet([...active.values], threadSurfaces)) return false;
  return active.values.every((surface) => Boolean(safeId(projection.surfaceThreadRefs[surface])));
}

function evaluateRetainedProjection(projection = {}, options = {}) {
  if (!continuityIdentityComplete(projection)) {
    return Object.freeze({ ok: false, reason: 'IDENTITY_INCOMPLETE', freshness: null });
  }
  const evidence = strictProofRefList(projection.evidenceRefs);
  if (!evidence.valid || evidence.values.length === 0) {
    return Object.freeze({ ok: false, reason: 'PROOF_REFS_INVALID', freshness: null });
  }
  const observedAt = projection.surfaceObservedAt;
  if (!observedAt || typeof observedAt !== 'object' || Array.isArray(observedAt) || Object.keys(observedAt).length === 0) {
    return Object.freeze({ ok: false, reason: 'FRESHNESS_EVIDENCE_INCOMPLETE', freshness: null });
  }
  if (!validateRetainedSurfaceSet(projection, observedAt)) {
    return Object.freeze({ ok: false, reason: 'SURFACE_SET_INCONSISTENT', freshness: null });
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleAfterMs = retainedDuration(options.staleAfterMs ?? projection.staleAfterMs, DEFAULT_STALE_AFTER_MS);
  const maxFutureSkewMs = retainedDuration(options.maxFutureSkewMs ?? projection.maxFutureSkewMs, DEFAULT_MAX_FUTURE_SKEW_MS);
  const freshness = classifyObservedAt(observedAt, nowMs, staleAfterMs, maxFutureSkewMs);
  if (freshness.invalid.length > 0) return Object.freeze({ ok: false, reason: 'FRESHNESS_EVIDENCE_INVALID', freshness });
  if (freshness.future.length > 0) return Object.freeze({ ok: false, reason: 'EVIDENCE_FUTURE_DATED', freshness });
  if (freshness.currentCount === 0) return Object.freeze({ ok: false, reason: 'EVIDENCE_STALE', freshness });
  return Object.freeze({
    ok: true,
    reason: 'CURRENT',
    freshness,
    evidenceRefs: evidence.values,
    nowMs,
    staleAfterMs,
    maxFutureSkewMs,
  });
}

export function validateOneConversationInputV1(input = {}) {
  const errors = [];
  const stephanosIdentityVersion = safeId(input.stephanosIdentityVersion);
  const operatorRelationshipContextRef = safeId(input.operatorRelationshipContextRef);
  const intentId = safeId(input.intentId);
  const missionId = safeId(input.missionId);
  const memoryAuthorityRef = safeId(input.memoryAuthorityRef);
  const timestampUtc = typeof input.timestampUtc === 'string' ? input.timestampUtc.trim() : '';
  const observations = Array.isArray(input.surfaceObservations)
    ? input.surfaceObservations.map(normalizeObservation)
    : [];

  if (!stephanosIdentityVersion) errors.push('invalid-stephanos-identity-version');
  if (!operatorRelationshipContextRef) errors.push('invalid-operator-relationship-context-ref');
  if (!intentId) errors.push('invalid-intent-id');
  if (!missionId) errors.push('invalid-mission-id');
  if (!memoryAuthorityRef) errors.push('invalid-memory-authority-ref');
  if (!isTimestamp(timestampUtc)) errors.push('invalid-timestamp-utc');
  if (!Array.isArray(input.surfaceObservations)) errors.push('surface-observations-must-be-array');
  if (observations.length === 0) errors.push('missing-surface-observations');

  for (const [index, observation] of observations.entries()) {
    if (!observation.observationWasRecord) errors.push(`observation-must-be-record:${index}`);
    if (!ONE_CONVERSATION_SURFACES.includes(observation.surface)) errors.push(`unsupported-surface:${index}`);
    if (!observation.surfaceThreadRef) errors.push(`invalid-surface-thread-ref:${index}`);
    if (!observation.stephanosIdentityVersion) errors.push(`missing-observation-stephanos-identity-version:${index}`);
    if (!observation.intentId) errors.push(`missing-observation-intent-id:${index}`);
    if (!observation.missionId) errors.push(`missing-observation-mission-id:${index}`);
    if (!observation.operatorRelationshipContextRef) errors.push(`missing-observation-relationship-context-ref:${index}`);
    if (!observation.memoryAuthorityRef) errors.push(`missing-observation-memory-authority-ref:${index}`);
    if (!isTimestamp(observation.timestampUtc)) errors.push(`invalid-observation-timestamp:${index}`);
    if (!observation.evidenceRefsWasArray) errors.push(`observation-evidenceRefs-must-be-array:${index}`);
    else if (!observation.evidenceRefsValid) errors.push(`observation-evidenceRefs-invalid:${index}`);
    else if (observation.evidenceRefs.length === 0) errors.push(`missing-observation-evidence:${index}`);
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
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleAfterMs = boundedDuration(options.staleAfterMs, DEFAULT_STALE_AFTER_MS);
  const maxFutureSkewMs = boundedDuration(options.maxFutureSkewMs, DEFAULT_MAX_FUTURE_SKEW_MS);
  const surfaceObservedAt = Object.freeze(Object.fromEntries(
    observations.map((observation) => [observation.surface, observation.timestampUtc]),
  ));
  const freshnessEvaluation = classifyObservedAt(surfaceObservedAt, nowMs, staleAfterMs, maxFutureSkewMs);
  const status = freshnessEvaluation.future.length > 0
    ? 'UNKNOWN'
    : (freshnessEvaluation.currentCount > 0 ? 'CURRENT' : 'STALE');

  const projection = {
    schemaVersion: ONE_CONVERSATION_SURFACE_SCHEMA_VERSION,
    projectionKind: 'stephanos.one-conversation.projection',
    status,
    reason: freshnessEvaluation.future.length > 0
      ? 'FUTURE_DATED_OBSERVATION'
      : (status === 'STALE' ? 'ALL_SURFACE_EVIDENCE_STALE' : 'CURRENT_SURFACE_EVIDENCE_PROVEN'),
    stephanosIdentityVersion: normalized.stephanosIdentityVersion,
    operatorRelationshipContextRef: normalized.operatorRelationshipContextRef,
    intentId: normalized.intentId,
    missionId: normalized.missionId,
    memoryAuthorityRef: normalized.memoryAuthorityRef,
    surfaceThreadRefs: Object.freeze(Object.fromEntries(observations.map((observation) => [observation.surface, observation.surfaceThreadRef]))),
    surfaceObservedAt,
    surfaceFreshness: freshnessEvaluation.freshness,
    evaluatedAtUtc: new Date(nowMs).toISOString(),
    staleAfterMs,
    maxFutureSkewMs,
    activeSurfaces: Object.freeze(observations.map((observation) => observation.surface)),
    evidenceRefs: Object.freeze([...new Set(observations.flatMap((observation) => observation.evidenceRefs))]),
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

export function planCrossSurfaceContinuationV1(projection = {}, input = {}, options = {}) {
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
  const retained = evaluateRetainedProjection(projection, options);
  if (!retained.ok) {
    const verdictByReason = {
      IDENTITY_INCOMPLETE: 'CONTINUATION_BLOCKED_IDENTITY_INCOMPLETE',
      PROOF_REFS_INVALID: 'CONTINUATION_BLOCKED_PROOF_EVIDENCE_INVALID',
      FRESHNESS_EVIDENCE_INCOMPLETE: 'CONTINUATION_BLOCKED_FRESHNESS_EVIDENCE_INCOMPLETE',
      SURFACE_SET_INCONSISTENT: 'CONTINUATION_BLOCKED_SURFACE_SET_INCONSISTENT',
      FRESHNESS_EVIDENCE_INVALID: 'CONTINUATION_BLOCKED_FRESHNESS_EVIDENCE_INVALID',
      EVIDENCE_FUTURE_DATED: 'CONTINUATION_BLOCKED_STALE_OR_UNKNOWN',
      EVIDENCE_STALE: 'CONTINUATION_BLOCKED_STALE_OR_UNKNOWN',
    };
    return Object.freeze({ ok: false, verdict: verdictByReason[retained.reason] || 'CONTINUATION_BLOCKED_STALE_OR_UNKNOWN', operatorNeeded: false });
  }
  if (!projection.surfaceThreadRefs?.[fromSurface]) {
    return Object.freeze({ ok: false, verdict: 'CONTINUATION_BLOCKED_SOURCE_THREAD_UNPROVEN', operatorNeeded: false });
  }
  if (retained.freshness.freshness?.[fromSurface] !== 'CURRENT') {
    return Object.freeze({ ok: false, verdict: 'CONTINUATION_BLOCKED_SOURCE_THREAD_STALE_OR_UNKNOWN', operatorNeeded: false });
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

  const nowMs = Number.isFinite(input.workspaceValidationOptions?.nowMs)
    ? input.workspaceValidationOptions.nowMs
    : Date.now();
  const retained = evaluateRetainedProjection(projection, {
    nowMs,
    staleAfterMs: input.workspaceValidationOptions?.staleAfterMs,
    maxFutureSkewMs: input.maxFutureSkewMs,
  });
  if (!retained.ok) {
    const reasonByFailure = {
      IDENTITY_INCOMPLETE: 'ONE_CONVERSATION_PROJECTION_IDENTITY_INCOMPLETE',
      PROOF_REFS_INVALID: 'ONE_CONVERSATION_PROJECTION_PROOF_REFS_INVALID',
      FRESHNESS_EVIDENCE_INCOMPLETE: 'ONE_CONVERSATION_PROJECTION_FRESHNESS_EVIDENCE_INCOMPLETE',
      SURFACE_SET_INCONSISTENT: 'ONE_CONVERSATION_PROJECTION_SURFACE_SET_INCONSISTENT',
      FRESHNESS_EVIDENCE_INVALID: 'ONE_CONVERSATION_PROJECTION_FRESHNESS_EVIDENCE_INVALID',
      EVIDENCE_FUTURE_DATED: 'ONE_CONVERSATION_PROJECTION_EVIDENCE_FUTURE_DATED',
      EVIDENCE_STALE: 'ONE_CONVERSATION_PROJECTION_EVIDENCE_STALE_AT_PUBLICATION',
    };
    return Object.freeze({ ok: false, reason: reasonByFailure[retained.reason] || 'ONE_CONVERSATION_PROJECTION_NOT_CURRENT' });
  }

  const timestampUtc = typeof input.timestampUtc === 'string' ? input.timestampUtc.trim() : '';
  const timestampMs = Date.parse(timestampUtc);
  if (!isTimestamp(timestampUtc)) {
    return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_MESSAGE_IDENTITY_INCOMPLETE' });
  }
  if (timestampMs > nowMs + retained.maxFutureSkewMs) {
    return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_WORKSPACE_RECORD_FUTURE_DATED' });
  }
  const correlationId = safeId(input.correlationId || projection.intentId);
  const messageId = safeId(input.messageId || `one-conversation-${projection.intentId}`);
  const relatedIssue = text(input.relatedIssue, '#1630');
  let suppliedProofRefs = Object.freeze({ valid: true, values: Object.freeze([]) });
  if (input.proofRefs !== undefined) {
    suppliedProofRefs = strictProofRefList(input.proofRefs);
    if (!suppliedProofRefs.valid) {
      return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_MESSAGE_PROOF_REFS_INVALID' });
    }
  }
  const proofRefs = suppliedProofRefs.values.length > 0 ? [...suppliedProofRefs.values] : [...retained.evidenceRefs];
  if (!correlationId || !messageId || proofRefs.length === 0) {
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
      status: 'CURRENT',
      stephanosIdentityVersion: projection.stephanosIdentityVersion,
      operatorRelationshipContextRef: projection.operatorRelationshipContextRef,
      intentId: projection.intentId,
      missionId: projection.missionId,
      memoryAuthorityRef: projection.memoryAuthorityRef,
      surfaceThreadRefs: projection.surfaceThreadRefs,
      surfaceObservedAt: projection.surfaceObservedAt,
      surfaceFreshness: retained.freshness.freshness,
      evaluatedAtUtc: new Date(nowMs).toISOString(),
      activeSurfaces: projection.activeSurfaces,
      operatorNeeded: false,
      authority: authorityBoundary(),
    }),
  };

  const workspaceValidationOptions = { ...(input.workspaceValidationOptions || {}), nowMs };
  const workspaceValidation = validateSharedWorkspaceRecord(record, workspaceValidationOptions);
  if (!workspaceValidation.valid) {
    return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_WORKSPACE_RECORD_INVALID', record, workspaceValidation });
  }
  if (workspaceValidation.stale) {
    return Object.freeze({ ok: false, reason: 'ONE_CONVERSATION_WORKSPACE_RECORD_STALE', record, workspaceValidation });
  }
  return Object.freeze({ ok: true, reason: 'ONE_CONVERSATION_WORKSPACE_MESSAGE_READY', record, workspaceValidation });
}
