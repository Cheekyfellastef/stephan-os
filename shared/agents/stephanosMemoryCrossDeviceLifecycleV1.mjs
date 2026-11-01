import { createHash } from 'node:crypto';

export const STEPHANOS_MEMORY_CROSS_DEVICE_INPUT_SCHEMA_V1 =
  'stephanos.memory-cross-device-lifecycle-input.v1';
export const STEPHANOS_MEMORY_CROSS_DEVICE_EVALUATION_SCHEMA_V1 =
  'stephanos.memory-cross-device-lifecycle-evaluation.v1';

export const STEPHANOS_MEMORY_CROSS_DEVICE_EVENT_TYPES = Object.freeze([
  'WRITE_CONFIRMED',
  'READ_CONFIRMED',
  'CORRECT_CONFIRMED',
  'READ_CORRECTED',
  'FORGET_CONFIRMED',
  'TOMBSTONE_OBSERVED',
]);

export const STEPHANOS_MEMORY_CROSS_DEVICE_VERDICTS = Object.freeze([
  'PASS',
  'HOLD_INCOMPLETE',
  'HOLD_AUTHORITY',
  'HOLD_EVIDENCE',
  'FAIL_DEVICE_TOPOLOGY',
  'FAIL_CHRONOLOGY',
  'FAIL_DIGEST_CHAIN',
]);

export const STEPHANOS_MEMORY_CROSS_DEVICE_MAX_EVENTS = 12;
export const STEPHANOS_MEMORY_CROSS_DEVICE_MAX_EVIDENCE_REFS = 8;
export const STEPHANOS_MEMORY_CROSS_DEVICE_MAX_BYTES = 256 * 1024;

export const STEPHANOS_MEMORY_CROSS_DEVICE_AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  memoryReadAuthorityGranted: false,
  correctionAllowed: false,
  forgetAllowed: false,
  deleteAllowed: false,
  tombstoneWriteAllowed: false,
  sharedWorkspaceMutationAllowed: false,
  deviceMutationAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

const TOP_KEYS = new Set(['schemaVersion', 'recordId', 'events']);
const EVENT_KEYS = new Set([
  'eventId',
  'eventType',
  'deviceId',
  'surface',
  'occurredAtUtc',
  'authorityConfirmed',
  'authorityClass',
  'recordId',
  'digest',
  'priorDigest',
  'newDigest',
  'contentPresent',
  'futureInfluenceAllowed',
  'evidenceRefs',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,191}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CANONICAL_AUTHORITIES = new Set(['SHARED_AUTHORITY', 'OPERATOR_CONFIRMED']);
const ALL_AUTHORITIES = new Set([
  ...CANONICAL_AUTHORITIES,
  'CANONICAL_PROJECT_EVIDENCE',
  'LOCAL_MIRROR',
  'PENDING_INTENT',
  'INFERRED',
  'UNKNOWN',
]);
const REQUIRED_ORDER = Object.freeze([
  'WRITE_CONFIRMED',
  'READ_CONFIRMED',
  'CORRECT_CONFIRMED',
  'READ_CORRECTED',
  'FORGET_CONFIRMED',
  'TOMBSTONE_OBSERVED',
]);

function fail(code, message) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlain(value, allowed, label) {
  if (!isPlainObject(value)) fail('INVALID_SHAPE', `${label} must be a plain data object`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.has(key)) fail('UNEXPECTED_FIELD', `${label}.${key} is not allowed`);
    if (!('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}.${key} must be a data value`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
}

function denseArray(value, label, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('INVALID_ARRAY', `${label} must be a standard array`);
  }
  if (value.length > max) fail('LIMIT_EXCEEDED', `${label} exceeds ${max}`);
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) fail('SPARSE_ARRAY_REJECTED', `${label} must be dense`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}[${i}] must be a data value`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
  return [...value];
}

function id(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail('INVALID_ID', `${label} is required and must be safe`);
  return value;
}

function optionalDigest(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('INVALID_DIGEST', `${label} must be sha256:<64 lowercase hex>`);
  return value;
}

function iso(value, label) {
  if (typeof value !== 'string') fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  return { utc: new Date(ms).toISOString(), ms };
}

function evidenceRefs(value, label) {
  const refs = denseArray(value, label, STEPHANOS_MEMORY_CROSS_DEVICE_MAX_EVIDENCE_REFS)
    .map((entry, index) => id(entry, `${label}[${index}]`));
  if (new Set(refs).size !== refs.length) fail('DUPLICATE_EVIDENCE_REF', `${label} contains duplicates`);
  return refs.sort();
}

function normalizeEvent(input, index, expectedRecordId) {
  const label = `events[${index}]`;
  assertPlain(input, EVENT_KEYS, label);
  if (!STEPHANOS_MEMORY_CROSS_DEVICE_EVENT_TYPES.includes(input.eventType)) {
    fail('INVALID_EVENT_TYPE', `${label}.eventType is unsupported`);
  }
  if (typeof input.authorityConfirmed !== 'boolean') fail('INVALID_AUTHORITY', `${label}.authorityConfirmed must be boolean`);
  if (!ALL_AUTHORITIES.has(input.authorityClass)) fail('INVALID_AUTHORITY', `${label}.authorityClass is unsupported`);
  if (typeof input.contentPresent !== 'boolean') fail('INVALID_CONTENT_FLAG', `${label}.contentPresent must be boolean`);
  if (typeof input.futureInfluenceAllowed !== 'boolean') fail('INVALID_INFLUENCE_FLAG', `${label}.futureInfluenceAllowed must be boolean`);
  const recordId = id(input.recordId, `${label}.recordId`);
  if (recordId !== expectedRecordId) fail('RECORD_ID_MISMATCH', `${label}.recordId differs from packet.recordId`);
  const timestamp = iso(input.occurredAtUtc, `${label}.occurredAtUtc`);
  return {
    eventId: id(input.eventId, `${label}.eventId`),
    eventType: input.eventType,
    deviceId: id(input.deviceId, `${label}.deviceId`),
    surface: id(input.surface, `${label}.surface`),
    occurredAtUtc: timestamp.utc,
    occurredAtMs: timestamp.ms,
    authorityConfirmed: input.authorityConfirmed,
    authorityClass: input.authorityClass,
    recordId,
    digest: optionalDigest(input.digest, `${label}.digest`),
    priorDigest: optionalDigest(input.priorDigest, `${label}.priorDigest`),
    newDigest: optionalDigest(input.newDigest, `${label}.newDigest`),
    contentPresent: input.contentPresent,
    futureInfluenceAllowed: input.futureInfluenceAllowed,
    evidenceRefs: evidenceRefs(input.evidenceRefs, `${label}.evidenceRefs`),
  };
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function selectRequiredEvents(events) {
  const selected = [];
  for (const eventType of REQUIRED_ORDER) {
    const candidates = events.filter((event) => event.eventType === eventType);
    if (candidates.length !== 1) return { complete: false, selected: [], issue: `${eventType} count must equal one` };
    selected.push(candidates[0]);
  }
  return { complete: true, selected, issue: null };
}

function classify(recordId, required) {
  const [write, read, correction, correctedRead, forget, tombstone] = required;
  if (required.some((event) => !event.authorityConfirmed || !CANONICAL_AUTHORITIES.has(event.authorityClass))) {
    return ['HOLD_AUTHORITY', 'every lifecycle receipt must be authority-confirmed shared/operator memory evidence'];
  }
  if (required.some((event) => event.evidenceRefs.length === 0)) {
    return ['HOLD_EVIDENCE', 'every lifecycle receipt requires at least one bounded evidence reference'];
  }
  for (let i = 1; i < required.length; i += 1) {
    if (required[i].occurredAtMs <= required[i - 1].occurredAtMs) {
      return ['FAIL_CHRONOLOGY', 'lifecycle events must be strictly chronological'];
    }
  }

  const deviceA = write.deviceId;
  const deviceB = read.deviceId;
  if (
    deviceA === deviceB ||
    correction.deviceId !== deviceB ||
    correctedRead.deviceId !== deviceA ||
    forget.deviceId !== deviceA ||
    tombstone.deviceId !== deviceB
  ) {
    return ['FAIL_DEVICE_TOPOLOGY', 'proof must alternate across two distinct devices in the required A→B→A lifecycle'];
  }

  const originalDigest = write.digest;
  const correctedDigest = correction.newDigest;
  if (!originalDigest || !correctedDigest || originalDigest === correctedDigest) {
    return ['FAIL_DIGEST_CHAIN', 'write and correction require distinct valid content digests'];
  }
  if (
    write.priorDigest !== null || write.newDigest !== null || !write.contentPresent || !write.futureInfluenceAllowed ||
    read.digest !== originalDigest || !read.contentPresent || !read.futureInfluenceAllowed ||
    correction.priorDigest !== originalDigest || correction.digest !== null || !correction.contentPresent || !correction.futureInfluenceAllowed ||
    correctedRead.digest !== correctedDigest || !correctedRead.contentPresent || !correctedRead.futureInfluenceAllowed ||
    forget.priorDigest !== correctedDigest || forget.digest !== null || forget.newDigest !== null || forget.contentPresent || forget.futureInfluenceAllowed ||
    tombstone.priorDigest !== correctedDigest || tombstone.digest !== null || tombstone.newDigest !== null || tombstone.contentPresent || tombstone.futureInfluenceAllowed
  ) {
    return ['FAIL_DIGEST_CHAIN', `record ${recordId} does not preserve write→read→correct→read→forget→tombstone truth`];
  }
  if (correction.newDigest !== correctedRead.digest) {
    return ['FAIL_DIGEST_CHAIN', 'corrected read does not match corrected canonical digest'];
  }
  return ['PASS', 'two-device lifecycle proves write, cross-device read, correction propagation, forget and tombstone convergence'];
}

export function evaluateStephanosMemoryCrossDeviceLifecycleV1(packet) {
  assertPlain(packet, TOP_KEYS, 'packet');
  if (packet.schemaVersion !== STEPHANOS_MEMORY_CROSS_DEVICE_INPUT_SCHEMA_V1) {
    fail('UNSUPPORTED_SCHEMA', 'packet.schemaVersion is unsupported');
  }
  const recordId = id(packet.recordId, 'packet.recordId');
  const events = denseArray(packet.events, 'packet.events', STEPHANOS_MEMORY_CROSS_DEVICE_MAX_EVENTS)
    .map((event, index) => normalizeEvent(event, index, recordId));
  const eventIds = new Set();
  for (const event of events) {
    if (eventIds.has(event.eventId)) fail('DUPLICATE_EVENT', `duplicate eventId ${event.eventId}`);
    eventIds.add(event.eventId);
  }

  const required = selectRequiredEvents(events);
  let verdict;
  let reason;
  if (!required.complete) {
    verdict = 'HOLD_INCOMPLETE';
    reason = required.issue;
  } else {
    [verdict, reason] = classify(recordId, required.selected);
  }

  const selected = required.complete ? required.selected : [];
  const core = {
    schemaVersion: STEPHANOS_MEMORY_CROSS_DEVICE_EVALUATION_SCHEMA_V1,
    recordId,
    verdict,
    reason,
    completeLifecycleObserved: required.complete,
    eventCount: events.length,
    requiredEventIds: selected.map((event) => event.eventId),
    deviceIds: [...new Set(selected.map((event) => event.deviceId))].sort(),
    originalDigest: selected[0]?.digest || null,
    correctedDigest: selected[2]?.newDigest || null,
    finalTombstoneObserved: selected[5]?.eventType === 'TOMBSTONE_OBSERVED' && selected[5]?.contentPresent === false,
  };
  const evaluationDigest = sha256(core);
  const result = { ...core, evaluationDigest, authority: STEPHANOS_MEMORY_CROSS_DEVICE_AUTHORITY };
  const serializedBytes = Buffer.byteLength(canonical(result), 'utf8');
  if (serializedBytes > STEPHANOS_MEMORY_CROSS_DEVICE_MAX_BYTES) fail('EVALUATION_TOO_LARGE', 'evaluation exceeds bounded serialized size');
  return deepFreeze({ ...result, serializedBytes });
}
