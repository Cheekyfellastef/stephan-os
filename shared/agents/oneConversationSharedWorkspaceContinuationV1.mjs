import { createHash } from 'node:crypto';

import {
  ONE_CONVERSATION_PARTICIPANT_ID,
  ONE_CONVERSATION_SURFACES,
  planCrossSurfaceContinuationV1,
} from './oneConversationSurfaceV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const ONE_CONVERSATION_SHARED_WORKSPACE_CONTINUATION_SCHEMA_VERSION = 'stephanos.one-conversation-shared-workspace-continuation.v1';
export const ONE_CONVERSATION_CONTINUATION_RECEIPT_SCHEMA_VERSION = 'stephanos.one-conversation-continuation-receipt.v1';
export const ONE_CONVERSATION_CONTINUATION_CHANNEL = 'one-conversation-continuation';
export const ONE_CONVERSATION_CONTINUATION_SUBTYPES = Object.freeze({
  REQUEST: 'continuation-request',
  ACCEPTANCE: 'continuation-acceptance',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const CONTINUITY_IDENTITY_KEYS = Object.freeze([
  'stephanosIdentityVersion',
  'operatorRelationshipContextRef',
  'intentId',
  'missionId',
  'memoryAuthorityRef',
]);
const AUTHORITY_KEYS = Object.freeze([
  'sourceMutationAllowed',
  'commandExecutionAllowed',
  'approvalAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'accountMutationAllowed',
  'providerMutationAllowed',
  'spendingAllowed',
]);
const AUTHORITY_SOURCE = 'EXISTING_GOVERNED_TASK_AND_APPROVAL_CONTRACTS_ONLY';
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 24;
const MAX_NODES = 4096;
const MAX_ARRAY = 256;
const MAX_STRING = 8192;
const MAX_SNAPSHOT_BYTES = 48 * 1024;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_RECORD_AGE_MS = 60 * 60 * 1000;
const REQUEST_INPUT_KEYS = Object.freeze([
  'projection',
  'fromSurface',
  'toSurface',
  'timestampUtc',
  'relatedIssue',
  'requestProofRefs',
]);
const ACCEPTANCE_INPUT_KEYS = Object.freeze([
  'requestRecord',
  'destinationThreadRef',
  'destinationObservedAtUtc',
  'proofRefs',
]);
const VALIDATION_INPUT_KEYS = Object.freeze(['requestRecord', 'acceptanceRecord']);
const FORBIDDEN_CONTEXT_KEY = /(?:^|_)(?:transcript|rawprompt|rawresponse|secret|token|credential|password|cookie|session|shell|commandtext|commandline|commandpayload|apikey|api_key|localpath|filesystempath)(?:$|_)/i;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|etc|var|tmp)\/)/;

class SnapshotError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function sameKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return Object.freeze([...new Set(values)]);
}

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    commandExecutionAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    accountMutationAllowed: false,
    providerMutationAllowed: false,
    spendingAllowed: false,
    authoritySource: AUTHORITY_SOURCE,
  });
}

function trustedNowMs(options = {}) {
  if (typeof process !== 'undefined' && process?.env?.NODE_TEST_CONTEXT && Number.isFinite(options.nowMs)) {
    const canonical = canonicalIsoFromMs(options.nowMs);
    if (canonical) return Date.parse(canonical);
  }
  return Date.now();
}

function canonicalIsoFromMs(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) return '';
  try {
    return new Date(value).toISOString();
  } catch {
    return '';
  }
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  const ms = Date.parse(normalized);
  const canonical = canonicalIsoFromMs(ms);
  return canonical && canonical === normalized ? canonical : '';
}

function timestampIsCurrent(value, nowMs) {
  const canonical = canonicalTimestamp(value);
  if (!canonical) return false;
  const ms = Date.parse(canonical);
  return ms <= nowMs + MAX_FUTURE_SKEW_MS && nowMs - ms <= MAX_RECORD_AGE_MS;
}

function snapshotDataOnly(value, state = { nodes: 0 }, depth = 0) {
  if (depth > MAX_DEPTH) throw new SnapshotError('input-too-deep');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) throw new SnapshotError('input-string-too-long');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SnapshotError('input-number-non-finite');
    return value;
  }
  if (typeof value !== 'object') throw new SnapshotError('input-must-be-data-only');

  state.nodes += 1;
  if (state.nodes > MAX_NODES) throw new SnapshotError('input-too-large');

  let prototype;
  let keys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new SnapshotError('input-uninspectable');
  }
  if (keys.some((key) => typeof key === 'symbol')) throw new SnapshotError('input-symbol-key-forbidden');

  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new SnapshotError('input-custom-array-prototype');
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) throw new SnapshotError('input-array-invalid');
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY) throw new SnapshotError('input-array-too-large');
    const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) throw new SnapshotError('input-array-must-be-dense');
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new SnapshotError('input-array-accessor-forbidden');
      }
      output.push(snapshotDataOnly(descriptor.value, state, depth + 1));
    }
    return Object.freeze(output);
  }

  if (prototype !== Object.prototype && prototype !== null) throw new SnapshotError('input-custom-prototype');
  const output = Object.create(null);
  for (const key of keys) {
    if (RESERVED_KEYS.has(key)) throw new SnapshotError('input-reserved-key');
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new SnapshotError('input-accessor-forbidden');
    }
    Object.defineProperty(output, key, {
      value: snapshotDataOnly(descriptor.value, state, depth + 1),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(output);
}

function capturePublicInput(value) {
  try {
    const snapshot = snapshotDataOnly(value);
    const encoded = JSON.stringify(snapshot);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_SNAPSHOT_BYTES) {
      return Object.freeze({ ok: false, reason: 'input-too-large', snapshot: null });
    }
    return Object.freeze({ ok: true, reason: 'input-captured', snapshot });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error instanceof SnapshotError ? error.code : 'input-uninspectable',
      snapshot: null,
    });
  }
}

function inspectSnapshot(value) {
  const violations = [];
  const walk = (node, path = []) => {
    if (typeof node === 'string') {
      if (ABSOLUTE_PATH.test(node)) violations.push(`absolute-path-forbidden:${path.join('.') || 'value'}`);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (AUTHORITY_KEYS.includes(key) && child !== false) violations.push(`authority-widening-forbidden:${key}`);
      if (!AUTHORITY_KEYS.includes(key) && FORBIDDEN_CONTEXT_KEY.test(key)) violations.push(`forbidden-context-field:${key}`);
      walk(child, [...path, key]);
    }
  };
  walk(value);
  return Object.freeze(violations);
}

function proofRefs(values) {
  if (!Array.isArray(values)) return Object.freeze({ valid: false, values: Object.freeze([]) });
  const normalized = [];
  for (const value of values) {
    const candidate = text(value);
    if (!candidate || candidate.includes('..') || !SAFE_PROOF_REF.test(candidate)) {
      return Object.freeze({ valid: false, values: Object.freeze([]) });
    }
    normalized.push(candidate);
  }
  if (new Set(normalized).size !== normalized.length) return Object.freeze({ valid: false, values: Object.freeze([]) });
  return Object.freeze({ valid: true, values: Object.freeze(normalized) });
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requestIdentityPayload(payload) {
  return Object.freeze({
    schemaVersion: payload.schemaVersion,
    subtype: payload.subtype,
    fromSurface: payload.fromSurface,
    toSurface: payload.toSurface,
    stephanosIdentityVersion: payload.stephanosIdentityVersion,
    operatorRelationshipContextRef: payload.operatorRelationshipContextRef,
    intentId: payload.intentId,
    missionId: payload.missionId,
    memoryAuthorityRef: payload.memoryAuthorityRef,
    sourceThreadRef: payload.sourceThreadRef,
    sourceProofRefs: payload.sourceProofRefs,
    knownDestinationThreadRef: payload.knownDestinationThreadRef,
    knownDestinationProofRefs: payload.knownDestinationProofRefs,
    destinationThreadCreationRequired: payload.destinationThreadCreationRequired,
    requestProofRefs: payload.requestProofRefs,
    requestedAtUtc: payload.requestedAtUtc,
  });
}

function acceptanceIdentityPayload(payload) {
  return Object.freeze({
    schemaVersion: payload.schemaVersion,
    subtype: payload.subtype,
    requestId: payload.requestId,
    requestCorrelationId: payload.requestCorrelationId,
    fromSurface: payload.fromSurface,
    toSurface: payload.toSurface,
    stephanosIdentityVersion: payload.stephanosIdentityVersion,
    operatorRelationshipContextRef: payload.operatorRelationshipContextRef,
    intentId: payload.intentId,
    missionId: payload.missionId,
    memoryAuthorityRef: payload.memoryAuthorityRef,
    sourceThreadRef: payload.sourceThreadRef,
    destinationThreadRef: payload.destinationThreadRef,
    destinationObservedAtUtc: payload.destinationObservedAtUtc,
    destinationProofRefs: payload.destinationProofRefs,
    destinationThreadCreationProven: payload.destinationThreadCreationProven,
    existingDestinationThreadBound: payload.existingDestinationThreadBound,
  });
}

function parseBody(record) {
  if (typeof record?.body !== 'string') return Object.freeze({ ok: false, reason: 'message-body-invalid', payload: null });
  try {
    const parsed = JSON.parse(record.body);
    const captured = capturePublicInput(parsed);
    if (!captured.ok) return Object.freeze({ ok: false, reason: captured.reason, payload: null });
    return Object.freeze({ ok: true, reason: 'message-body-valid', payload: captured.snapshot });
  } catch {
    return Object.freeze({ ok: false, reason: 'message-body-invalid-json', payload: null });
  }
}

function workspaceValidation(record, nowMs) {
  return validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs: MAX_RECORD_AGE_MS });
}

function requestFailure(reason, errors = []) {
  return Object.freeze({
    ok: false,
    reason,
    errors: Object.freeze(errors.length ? errors : [reason]),
    record: null,
  });
}

function receiptFailure(reason, errors = []) {
  return Object.freeze({
    ok: false,
    reason,
    errors: Object.freeze(errors.length ? errors : [reason]),
    receipt: null,
  });
}

function validateRequestRecordCaptured(record, nowMs) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return requestFailure('request-record-invalid');
  const authorityViolations = inspectSnapshot(record);
  errors.push(...authorityViolations);
  const workspace = workspaceValidation(record, nowMs);
  if (!workspace.valid) errors.push(...workspace.errors.map((error) => `workspace:${error}`));
  if (workspace.stale) errors.push('request-record-stale');
  if (!timestampIsCurrent(record.timestampUtc, nowMs)) errors.push('request-timestamp-stale-future-or-invalid');
  if (record.kind !== SHARED_WORKSPACE_RECORD_KINDS.MESSAGE) errors.push('request-kind-mismatch');
  if (record.schemaVersion !== SHARED_WORKSPACE_RECORD_SCHEMA_VERSION) errors.push('request-record-schema-mismatch');
  if (record.participantId !== ONE_CONVERSATION_PARTICIPANT_ID) errors.push('request-participant-mismatch');
  if (record.recipientParticipantId !== ONE_CONVERSATION_PARTICIPANT_ID) errors.push('request-recipient-mismatch');
  if (record.channel !== ONE_CONVERSATION_CONTINUATION_CHANNEL) errors.push('request-channel-mismatch');
  if (record.recordSubtype !== ONE_CONVERSATION_CONTINUATION_SUBTYPES.REQUEST) errors.push('request-subtype-mismatch');

  const parsed = parseBody(record);
  if (!parsed.ok) errors.push(parsed.reason);
  const payload = parsed.payload;
  if (payload) {
    if (payload.schemaVersion !== ONE_CONVERSATION_SHARED_WORKSPACE_CONTINUATION_SCHEMA_VERSION) errors.push('request-body-schema-mismatch');
    if (payload.subtype !== ONE_CONVERSATION_CONTINUATION_SUBTYPES.REQUEST) errors.push('request-body-subtype-mismatch');
    if (!ONE_CONVERSATION_SURFACES.includes(payload.fromSurface) || !ONE_CONVERSATION_SURFACES.includes(payload.toSurface) || payload.fromSurface === payload.toSurface) errors.push('request-surface-mismatch');
    for (const key of CONTINUITY_IDENTITY_KEYS) if (!safeId(payload[key])) errors.push(`request-${key}-invalid`);
    if (!safeId(payload.sourceThreadRef)) errors.push('request-source-thread-invalid');
    if (!canonicalTimestamp(payload.requestedAtUtc) || payload.requestedAtUtc !== record.timestampUtc) errors.push('request-timestamp-lineage-mismatch');
    const source = proofRefs(payload.sourceProofRefs);
    const knownDestination = proofRefs(payload.knownDestinationProofRefs);
    const requestRefs = proofRefs(payload.requestProofRefs);
    if (!source.valid || source.values.length === 0) errors.push('request-source-proof-invalid');
    if (!knownDestination.valid || !requestRefs.valid) errors.push('request-proof-invalid');
    if (payload.destinationThreadCreationRequired === true) {
      if (text(payload.knownDestinationThreadRef) || knownDestination.values.length !== 0) errors.push('request-destination-creation-state-invalid');
    } else if (payload.destinationThreadCreationRequired === false) {
      if (!safeId(payload.knownDestinationThreadRef) || knownDestination.values.length === 0) errors.push('request-known-destination-proof-incomplete');
    } else {
      errors.push('request-destination-creation-flag-invalid');
    }
    if (payload.authority?.authoritySource !== AUTHORITY_SOURCE || AUTHORITY_KEYS.some((key) => payload.authority?.[key] !== false)) errors.push('request-authority-invalid');
    if (payload.carryOnlyBoundedContext !== true) errors.push('request-context-boundary-invalid');
    const expectedId = `oneconv-req-${hash(requestIdentityPayload(payload)).slice(0, 32)}`;
    if (record.messageId !== expectedId || payload.requestId !== expectedId) errors.push('request-content-identity-mismatch');
    if (record.correlationId !== expectedId || payload.requestCorrelationId !== expectedId) errors.push('request-correlation-lineage-mismatch');
    const expectedRecordProofRefs = unique([...source.values, ...requestRefs.values]);
    if (!sameStringArray(record.proofRefs, expectedRecordProofRefs)) errors.push('request-record-proof-lineage-mismatch');
  }
  return Object.freeze({
    ok: errors.length === 0,
    reason: errors[0] || 'ONE_CONVERSATION_CONTINUATION_REQUEST_VALID',
    errors: Object.freeze(errors),
    record: errors.length === 0 ? record : null,
    payload: errors.length === 0 ? payload : null,
    workspaceValidation: workspace,
  });
}

export function createOneConversationContinuationRequestV1(input = {}, options = {}) {
  const captured = capturePublicInput(input);
  if (!captured.ok) return requestFailure(captured.reason);
  const snapshot = captured.snapshot;
  if (!sameKeys(snapshot, REQUEST_INPUT_KEYS)) return requestFailure('request-input-shape-invalid');
  const violations = inspectSnapshot(snapshot);
  if (violations.length) return requestFailure(violations[0], violations);
  if (snapshot.relatedIssue !== '#1630') return requestFailure('request-related-issue-must-be-1630');
  if (!ONE_CONVERSATION_SURFACES.includes(snapshot.fromSurface) || !ONE_CONVERSATION_SURFACES.includes(snapshot.toSurface) || snapshot.fromSurface === snapshot.toSurface) {
    return requestFailure('request-surfaces-invalid');
  }
  const nowMs = trustedNowMs(options);
  if (!timestampIsCurrent(snapshot.timestampUtc, nowMs)) return requestFailure('request-timestamp-stale-future-or-invalid');
  const callerProofs = proofRefs(snapshot.requestProofRefs);
  if (!callerProofs.valid) return requestFailure('request-proof-refs-invalid');

  const plan = planCrossSurfaceContinuationV1(snapshot.projection, {
    fromSurface: snapshot.fromSurface,
    toSurface: snapshot.toSurface,
  }, { nowMs });
  if (!plan?.ok) return requestFailure(plan?.verdict || 'continuation-plan-blocked');

  const sourceProofs = proofRefs(plan.sourceProofRefs);
  if (!sourceProofs.valid || sourceProofs.values.length === 0) return requestFailure('canonical-source-proof-missing');
  const knownDestinationThreadRef = safeId(plan.destinationThreadRef);
  let knownDestinationProofRefs = Object.freeze([]);
  if (!plan.destinationThreadCreationRequired) {
    const destinationAttestation = snapshot.projection?.surfaceAttestations?.[snapshot.toSurface];
    if (!destinationAttestation || safeId(destinationAttestation.surfaceThreadRef) !== knownDestinationThreadRef) {
      return requestFailure('canonical-destination-attestation-missing');
    }
    const destinationProofs = proofRefs(destinationAttestation.proofRefs);
    if (!destinationProofs.valid || destinationProofs.values.length === 0) return requestFailure('canonical-destination-proof-missing');
    knownDestinationProofRefs = destinationProofs.values;
  }

  const payloadBase = Object.freeze({
    schemaVersion: ONE_CONVERSATION_SHARED_WORKSPACE_CONTINUATION_SCHEMA_VERSION,
    subtype: ONE_CONVERSATION_CONTINUATION_SUBTYPES.REQUEST,
    fromSurface: plan.fromSurface,
    toSurface: plan.toSurface,
    stephanosIdentityVersion: plan.stephanosIdentityVersion,
    operatorRelationshipContextRef: plan.operatorRelationshipContextRef,
    intentId: plan.intentId,
    missionId: plan.missionId,
    memoryAuthorityRef: plan.memoryAuthorityRef,
    sourceThreadRef: plan.sourceThreadRef,
    sourceProofRefs: sourceProofs.values,
    knownDestinationThreadRef: plan.destinationThreadCreationRequired ? '' : knownDestinationThreadRef,
    knownDestinationProofRefs,
    destinationThreadCreationRequired: plan.destinationThreadCreationRequired === true,
    requestProofRefs: callerProofs.values,
    requestedAtUtc: snapshot.timestampUtc,
  });
  const requestId = `oneconv-req-${hash(requestIdentityPayload(payloadBase)).slice(0, 32)}`;
  const payload = Object.freeze({
    ...payloadBase,
    requestId,
    requestCorrelationId: requestId,
    carryOnlyBoundedContext: true,
    authority: authorityBoundary(),
  });
  const recordProofRefs = unique([...sourceProofs.values, ...callerProofs.values]);
  const record = Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId: requestId,
    participantId: ONE_CONVERSATION_PARTICIPANT_ID,
    recipientParticipantId: ONE_CONVERSATION_PARTICIPANT_ID,
    timestampUtc: snapshot.timestampUtc,
    correlationId: requestId,
    relatedIssue: '#1630',
    proofRefs: recordProofRefs,
    channel: ONE_CONVERSATION_CONTINUATION_CHANNEL,
    recordSubtype: ONE_CONVERSATION_CONTINUATION_SUBTYPES.REQUEST,
    summary: `One Conversation continuation ${plan.fromSurface} -> ${plan.toSurface}`,
    body: JSON.stringify(payload),
    ...Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])),
  });
  const validated = validateRequestRecordCaptured(record, nowMs);
  if (!validated.ok) return requestFailure(validated.reason, validated.errors);
  return Object.freeze({
    ok: true,
    reason: 'ONE_CONVERSATION_CONTINUATION_REQUEST_READY',
    requestId,
    record,
    plan,
    workspaceValidation: validated.workspaceValidation,
  });
}

export function validateOneConversationContinuationRequestV1(record = {}, options = {}) {
  const captured = capturePublicInput(record);
  if (!captured.ok) return requestFailure(captured.reason);
  return validateRequestRecordCaptured(captured.snapshot, trustedNowMs(options));
}

export function createOneConversationContinuationAcceptanceV1(input = {}, options = {}) {
  const captured = capturePublicInput(input);
  if (!captured.ok) return requestFailure(captured.reason);
  const snapshot = captured.snapshot;
  if (!sameKeys(snapshot, ACCEPTANCE_INPUT_KEYS)) return requestFailure('acceptance-input-shape-invalid');
  const violations = inspectSnapshot(snapshot);
  if (violations.length) return requestFailure(violations[0], violations);
  const nowMs = trustedNowMs(options);
  const request = validateRequestRecordCaptured(snapshot.requestRecord, nowMs);
  if (!request.ok) return requestFailure(`acceptance-${request.reason}`);
  const destinationThreadRef = safeId(snapshot.destinationThreadRef);
  if (!destinationThreadRef) return requestFailure('acceptance-destination-thread-invalid');
  if (!timestampIsCurrent(snapshot.destinationObservedAtUtc, nowMs)) return requestFailure('acceptance-timestamp-stale-future-or-invalid');
  const destinationProofs = proofRefs(snapshot.proofRefs);
  if (!destinationProofs.valid || destinationProofs.values.length === 0) return requestFailure('acceptance-proof-refs-invalid');
  if (!request.payload.destinationThreadCreationRequired && destinationThreadRef !== request.payload.knownDestinationThreadRef) {
    return requestFailure('acceptance-known-destination-thread-mismatch');
  }

  const payloadBase = Object.freeze({
    schemaVersion: ONE_CONVERSATION_SHARED_WORKSPACE_CONTINUATION_SCHEMA_VERSION,
    subtype: ONE_CONVERSATION_CONTINUATION_SUBTYPES.ACCEPTANCE,
    requestId: request.record.messageId,
    requestCorrelationId: request.record.correlationId,
    fromSurface: request.payload.fromSurface,
    toSurface: request.payload.toSurface,
    stephanosIdentityVersion: request.payload.stephanosIdentityVersion,
    operatorRelationshipContextRef: request.payload.operatorRelationshipContextRef,
    intentId: request.payload.intentId,
    missionId: request.payload.missionId,
    memoryAuthorityRef: request.payload.memoryAuthorityRef,
    sourceThreadRef: request.payload.sourceThreadRef,
    destinationThreadRef,
    destinationObservedAtUtc: snapshot.destinationObservedAtUtc,
    destinationProofRefs: destinationProofs.values,
    destinationThreadCreationProven: request.payload.destinationThreadCreationRequired === true,
    existingDestinationThreadBound: request.payload.destinationThreadCreationRequired === false,
  });
  const messageId = `oneconv-ack-${hash(acceptanceIdentityPayload(payloadBase)).slice(0, 32)}`;
  const payload = Object.freeze({
    ...payloadBase,
    acceptanceMessageId: messageId,
    authority: authorityBoundary(),
  });
  const record = Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId,
    participantId: ONE_CONVERSATION_PARTICIPANT_ID,
    recipientParticipantId: ONE_CONVERSATION_PARTICIPANT_ID,
    timestampUtc: snapshot.destinationObservedAtUtc,
    correlationId: request.record.messageId,
    relatedIssue: '#1630',
    proofRefs: destinationProofs.values,
    channel: ONE_CONVERSATION_CONTINUATION_CHANNEL,
    recordSubtype: ONE_CONVERSATION_CONTINUATION_SUBTYPES.ACCEPTANCE,
    summary: `One Conversation destination accepted on ${request.payload.toSurface}`,
    body: JSON.stringify(payload),
    ...Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])),
  });
  const workspace = workspaceValidation(record, nowMs);
  if (!workspace.valid || workspace.stale) return requestFailure(workspace.errors?.[0] || 'acceptance-workspace-record-invalid');
  return Object.freeze({
    ok: true,
    reason: 'ONE_CONVERSATION_CONTINUATION_ACCEPTANCE_READY',
    messageId,
    record,
    workspaceValidation: workspace,
  });
}

export function validateOneConversationContinuationAcceptanceV1(input = {}, options = {}) {
  const captured = capturePublicInput(input);
  if (!captured.ok) return receiptFailure(captured.reason);
  const snapshot = captured.snapshot;
  if (!sameKeys(snapshot, VALIDATION_INPUT_KEYS)) return receiptFailure('acceptance-validation-input-shape-invalid');
  const violations = inspectSnapshot(snapshot);
  if (violations.length) return receiptFailure(violations[0], violations);
  const nowMs = trustedNowMs(options);
  const request = validateRequestRecordCaptured(snapshot.requestRecord, nowMs);
  if (!request.ok) return receiptFailure(`request-${request.reason}`, request.errors);

  const acceptanceRecord = snapshot.acceptanceRecord;
  const errors = [];
  const workspace = workspaceValidation(acceptanceRecord, nowMs);
  if (!workspace.valid) errors.push(...workspace.errors.map((error) => `workspace:${error}`));
  if (workspace.stale) errors.push('acceptance-record-stale');
  if (!timestampIsCurrent(acceptanceRecord?.timestampUtc, nowMs)) errors.push('acceptance-timestamp-stale-future-or-invalid');
  if (acceptanceRecord?.schemaVersion !== SHARED_WORKSPACE_RECORD_SCHEMA_VERSION) errors.push('acceptance-record-schema-mismatch');
  if (acceptanceRecord?.kind !== SHARED_WORKSPACE_RECORD_KINDS.MESSAGE) errors.push('acceptance-kind-mismatch');
  if (acceptanceRecord?.participantId !== ONE_CONVERSATION_PARTICIPANT_ID) errors.push('acceptance-participant-mismatch');
  if (acceptanceRecord?.recipientParticipantId !== ONE_CONVERSATION_PARTICIPANT_ID) errors.push('acceptance-recipient-mismatch');
  if (acceptanceRecord?.channel !== ONE_CONVERSATION_CONTINUATION_CHANNEL) errors.push('acceptance-channel-mismatch');
  if (acceptanceRecord?.recordSubtype !== ONE_CONVERSATION_CONTINUATION_SUBTYPES.ACCEPTANCE) errors.push('acceptance-subtype-mismatch');
  if (acceptanceRecord?.correlationId !== request.record.messageId) errors.push('acceptance-request-linkage-mismatch');
  if (acceptanceRecord?.relatedIssue !== '#1630') errors.push('acceptance-related-issue-mismatch');
  errors.push(...inspectSnapshot(acceptanceRecord));

  const parsed = parseBody(acceptanceRecord);
  if (!parsed.ok) errors.push(parsed.reason);
  const payload = parsed.payload;
  if (payload) {
    if (payload.schemaVersion !== ONE_CONVERSATION_SHARED_WORKSPACE_CONTINUATION_SCHEMA_VERSION) errors.push('acceptance-body-schema-mismatch');
    if (payload.subtype !== ONE_CONVERSATION_CONTINUATION_SUBTYPES.ACCEPTANCE) errors.push('acceptance-body-subtype-mismatch');
    if (payload.requestId !== request.record.messageId || payload.requestCorrelationId !== request.record.correlationId) errors.push('acceptance-request-lineage-mismatch');
    if (payload.fromSurface !== request.payload.fromSurface || payload.toSurface !== request.payload.toSurface) errors.push('acceptance-surface-lineage-mismatch');
    for (const key of CONTINUITY_IDENTITY_KEYS) if (payload[key] !== request.payload[key]) errors.push(`acceptance-${key}-substitution`);
    if (payload.sourceThreadRef !== request.payload.sourceThreadRef) errors.push('acceptance-source-thread-mismatch');
    const destinationThreadRef = safeId(payload.destinationThreadRef);
    if (!destinationThreadRef) errors.push('acceptance-destination-thread-invalid');
    if (!canonicalTimestamp(payload.destinationObservedAtUtc) || payload.destinationObservedAtUtc !== acceptanceRecord.timestampUtc) errors.push('acceptance-observation-lineage-mismatch');
    const destinationProofs = proofRefs(payload.destinationProofRefs);
    if (!destinationProofs.valid || destinationProofs.values.length === 0) errors.push('acceptance-destination-proof-invalid');
    if (!sameStringArray(acceptanceRecord.proofRefs, destinationProofs.values)) errors.push('acceptance-record-proof-lineage-mismatch');
    if (request.payload.destinationThreadCreationRequired) {
      if (payload.destinationThreadCreationProven !== true || payload.existingDestinationThreadBound !== false) errors.push('acceptance-destination-creation-proof-missing');
    } else {
      if (destinationThreadRef !== request.payload.knownDestinationThreadRef) errors.push('acceptance-known-destination-thread-mismatch');
      if (payload.destinationThreadCreationProven !== false || payload.existingDestinationThreadBound !== true) errors.push('acceptance-known-destination-state-invalid');
    }
    if (payload.authority?.authoritySource !== AUTHORITY_SOURCE || AUTHORITY_KEYS.some((key) => payload.authority?.[key] !== false)) errors.push('acceptance-authority-invalid');
    const expectedMessageId = `oneconv-ack-${hash(acceptanceIdentityPayload(payload)).slice(0, 32)}`;
    if (acceptanceRecord.messageId !== expectedMessageId || payload.acceptanceMessageId !== expectedMessageId) errors.push('acceptance-content-identity-mismatch');
  }
  if (errors.length) return receiptFailure(errors[0], errors);

  const receiptPayload = Object.freeze({
    schemaVersion: ONE_CONVERSATION_CONTINUATION_RECEIPT_SCHEMA_VERSION,
    requestId: request.record.messageId,
    acceptanceMessageId: acceptanceRecord.messageId,
    correlationId: request.record.correlationId,
    fromSurface: request.payload.fromSurface,
    toSurface: request.payload.toSurface,
    stephanosIdentityVersion: request.payload.stephanosIdentityVersion,
    operatorRelationshipContextRef: request.payload.operatorRelationshipContextRef,
    intentId: request.payload.intentId,
    missionId: request.payload.missionId,
    memoryAuthorityRef: request.payload.memoryAuthorityRef,
    sourceThreadRef: request.payload.sourceThreadRef,
    destinationThreadRef: payload.destinationThreadRef,
    sourceProofRefs: request.payload.sourceProofRefs,
    destinationProofRefs: payload.destinationProofRefs,
    destinationObservedAtUtc: payload.destinationObservedAtUtc,
    state: 'CONTINUATION_ACCEPTED_READ_ONLY',
  });
  const receiptId = `oneconv-rec-${hash(receiptPayload).slice(0, 32)}`;
  const receipt = Object.freeze({
    ...receiptPayload,
    receiptId,
    authority: authorityBoundary(),
  });
  return Object.freeze({
    ok: true,
    reason: 'ONE_CONVERSATION_CONTINUATION_ACCEPTED_READ_ONLY',
    receipt,
    requestRecord: request.record,
    acceptanceRecord,
    workspaceValidation: workspace,
  });
}
