import { createHash } from 'node:crypto';

export const STEPHANOS_MEMORY_PROVIDER_SWAP_INPUT_SCHEMA_V1 =
  'stephanos.memory-provider-swap-continuity-input.v1';
export const STEPHANOS_MEMORY_PROVIDER_SWAP_EVALUATION_SCHEMA_V1 =
  'stephanos.memory-provider-swap-continuity-evaluation.v1';

export const STEPHANOS_MEMORY_PROVIDER_SWAP_VERDICTS = Object.freeze([
  'PASS',
  'HOLD_NOT_A_SWAP',
  'HOLD_AUTHORITY',
  'HOLD_EVIDENCE',
  'FAIL_IDENTITY_DRIFT',
  'FAIL_THREAD_DRIFT',
  'FAIL_MEMORY_DRIFT',
]);

export const STEPHANOS_MEMORY_PROVIDER_SWAP_MAX_RECORDS = 256;
export const STEPHANOS_MEMORY_PROVIDER_SWAP_MAX_EVIDENCE_REFS = 8;
export const STEPHANOS_MEMORY_PROVIDER_SWAP_MAX_BYTES = 384 * 1024;

export const STEPHANOS_MEMORY_PROVIDER_SWAP_AUTHORITY = Object.freeze({
  providerCanonicalMemoryAuthority: false,
  providerIdentityAuthority: false,
  providerThreadAuthority: false,
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  correctionAllowed: false,
  forgetAllowed: false,
  providerPromptUseAllowed: false,
  routingMutationAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

const TOP_KEYS = new Set(['schemaVersion', 'before', 'after']);
const OBSERVATION_KEYS = new Set([
  'providerId',
  'providerClass',
  'surface',
  'observedAtUtc',
  'authorityConfirmed',
  'memoryAuthorityClass',
  'stephanosIdentityVersion',
  'operatorRelationshipContextRef',
  'intentId',
  'missionId',
  'memoryAuthorityRef',
  'surfaceThreadRef',
  'canonicalRecords',
  'evidenceRefs',
]);
const RECORD_KEYS = new Set([
  'recordId',
  'digest',
  'state',
  'authorityClass',
]);
const IDENTITY_KEYS = Object.freeze([
  'stephanosIdentityVersion',
  'operatorRelationshipContextRef',
  'intentId',
  'missionId',
  'memoryAuthorityRef',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,191}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PROVIDER_CLASSES = new Set(['HOSTED', 'LOCAL', 'HYBRID', 'UNKNOWN']);
const MEMORY_STATES = new Set(['CURRENT', 'SUPERSEDED', 'TOMBSTONE', 'EXPIRED']);
const MEMORY_AUTHORITY_CLASSES = new Set([
  'SHARED_AUTHORITY',
  'OPERATOR_CONFIRMED',
  'CANONICAL_PROJECT_EVIDENCE',
  'LOCAL_MIRROR',
  'PENDING_INTENT',
  'INFERRED',
  'UNKNOWN',
]);
const CANONICAL_AUTHORITY_CLASSES = new Set([
  'SHARED_AUTHORITY',
  'OPERATOR_CONFIRMED',
  'CANONICAL_PROJECT_EVIDENCE',
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

function assertPlainObject(value, allowedKeys, label) {
  if (!isPlainObject(value)) fail('INVALID_SHAPE', `${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.has(key)) fail('UNEXPECTED_FIELD', `${label}.${key} is not allowed`);
    if (!('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}.${key} must be a data value`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
}

function captureDenseArray(value, label, maxLength) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('INVALID_ARRAY', `${label} must be a standard array`);
  }
  if (value.length > maxLength) fail('LIMIT_EXCEEDED', `${label} exceeds ${maxLength}`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail('SPARSE_ARRAY_REJECTED', `${label} must be dense`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) {
      fail('ACCESSOR_REJECTED', `${label}[${index}] must be a data value`);
    }
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
  return [...value];
}

function captureId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail('INVALID_ID', `${label} is required and must be safe`);
  return value;
}

function captureIso(value, label) {
  if (typeof value !== 'string') fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  return new Date(ms).toISOString();
}

function captureEvidenceRefs(value, label) {
  const values = captureDenseArray(value, label, STEPHANOS_MEMORY_PROVIDER_SWAP_MAX_EVIDENCE_REFS);
  const refs = values.map((entry, index) => captureId(entry, `${label}[${index}]`));
  if (new Set(refs).size !== refs.length) fail('DUPLICATE_EVIDENCE_REF', `${label} contains duplicates`);
  return refs.sort();
}

function normalizeRecord(input, index, observationLabel) {
  assertPlainObject(input, RECORD_KEYS, `${observationLabel}.canonicalRecords[${index}]`);
  const digest = input.digest;
  if (typeof digest !== 'string' || !DIGEST.test(digest)) {
    fail('INVALID_DIGEST', `${observationLabel}.canonicalRecords[${index}].digest is invalid`);
  }
  const state = input.state;
  if (!MEMORY_STATES.has(state)) fail('INVALID_STATE', `${observationLabel}.canonicalRecords[${index}].state is unsupported`);
  const authorityClass = input.authorityClass;
  if (!MEMORY_AUTHORITY_CLASSES.has(authorityClass)) {
    fail('INVALID_AUTHORITY', `${observationLabel}.canonicalRecords[${index}].authorityClass is unsupported`);
  }
  return {
    recordId: captureId(input.recordId, `${observationLabel}.canonicalRecords[${index}].recordId`),
    digest,
    state,
    authorityClass,
  };
}

function normalizeObservation(input, label) {
  assertPlainObject(input, OBSERVATION_KEYS, label);
  const providerClass = input.providerClass;
  if (!PROVIDER_CLASSES.has(providerClass)) fail('INVALID_PROVIDER_CLASS', `${label}.providerClass is unsupported`);
  if (typeof input.authorityConfirmed !== 'boolean') fail('INVALID_AUTHORITY', `${label}.authorityConfirmed must be boolean`);
  if (!MEMORY_AUTHORITY_CLASSES.has(input.memoryAuthorityClass)) {
    fail('INVALID_AUTHORITY', `${label}.memoryAuthorityClass is unsupported`);
  }
  const records = captureDenseArray(
    input.canonicalRecords,
    `${label}.canonicalRecords`,
    STEPHANOS_MEMORY_PROVIDER_SWAP_MAX_RECORDS,
  ).map((record, index) => normalizeRecord(record, index, label));
  records.sort((a, b) => a.recordId.localeCompare(b.recordId));
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.recordId)) fail('DUPLICATE_RECORD', `${label} duplicates ${record.recordId}`);
    seen.add(record.recordId);
  }

  const normalized = {
    providerId: captureId(input.providerId, `${label}.providerId`),
    providerClass,
    surface: captureId(input.surface, `${label}.surface`),
    observedAtUtc: captureIso(input.observedAtUtc, `${label}.observedAtUtc`),
    authorityConfirmed: input.authorityConfirmed,
    memoryAuthorityClass: input.memoryAuthorityClass,
    stephanosIdentityVersion: captureId(input.stephanosIdentityVersion, `${label}.stephanosIdentityVersion`),
    operatorRelationshipContextRef: captureId(input.operatorRelationshipContextRef, `${label}.operatorRelationshipContextRef`),
    intentId: captureId(input.intentId, `${label}.intentId`),
    missionId: captureId(input.missionId, `${label}.missionId`),
    memoryAuthorityRef: captureId(input.memoryAuthorityRef, `${label}.memoryAuthorityRef`),
    surfaceThreadRef: captureId(input.surfaceThreadRef, `${label}.surfaceThreadRef`),
    canonicalRecords: records,
    evidenceRefs: captureEvidenceRefs(input.evidenceRefs, `${label}.evidenceRefs`),
  };
  normalized.canonicalRecordDigest = sha256Canonical(records);
  return normalized;
}

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function compareIdentity(before, after) {
  const drift = IDENTITY_KEYS.filter((key) => before[key] !== after[key]);
  return { stable: drift.length === 0, drift };
}

function compareMemory(before, after) {
  const beforeById = new Map(before.canonicalRecords.map((record) => [record.recordId, record]));
  const afterById = new Map(after.canonicalRecords.map((record) => [record.recordId, record]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  const drift = [];
  for (const recordId of ids) {
    const left = beforeById.get(recordId);
    const right = afterById.get(recordId);
    if (!left || !right) {
      drift.push({ recordId, reason: left ? 'MISSING_AFTER' : 'ADDED_AFTER' });
      continue;
    }
    if (left.digest !== right.digest || left.state !== right.state || left.authorityClass !== right.authorityClass) {
      drift.push({ recordId, reason: 'METADATA_CHANGED' });
    }
  }
  return { stable: drift.length === 0, drift };
}

function classify(before, after, identityComparison, memoryComparison) {
  if (before.providerId === after.providerId) {
    return ['HOLD_NOT_A_SWAP', 'before and after provider identities are the same'];
  }
  if (
    !before.authorityConfirmed ||
    !after.authorityConfirmed ||
    !CANONICAL_AUTHORITY_CLASSES.has(before.memoryAuthorityClass) ||
    !CANONICAL_AUTHORITY_CLASSES.has(after.memoryAuthorityClass)
  ) {
    return ['HOLD_AUTHORITY', 'provider-swap continuity requires authority-confirmed canonical memory observations'];
  }
  if (before.evidenceRefs.length === 0 || after.evidenceRefs.length === 0) {
    return ['HOLD_EVIDENCE', 'both sides of the provider swap require bounded proof references'];
  }
  if (!identityComparison.stable || before.surface !== after.surface) {
    return ['FAIL_IDENTITY_DRIFT', 'Stephanos continuity identity or execution surface changed during provider swap'];
  }
  if (before.surfaceThreadRef !== after.surfaceThreadRef) {
    return ['FAIL_THREAD_DRIFT', 'current conversation thread changed during provider swap'];
  }
  if (!memoryComparison.stable || before.canonicalRecordDigest !== after.canonicalRecordDigest) {
    return ['FAIL_MEMORY_DRIFT', 'canonical memory identity, digest, state or authority changed during provider swap'];
  }
  return ['PASS', 'provider changed while canonical identity, current thread and canonical memory remained invariant'];
}

export function evaluateStephanosMemoryProviderSwapContinuityV1(packet) {
  assertPlainObject(packet, TOP_KEYS, 'packet');
  if (packet.schemaVersion !== STEPHANOS_MEMORY_PROVIDER_SWAP_INPUT_SCHEMA_V1) {
    fail('UNSUPPORTED_SCHEMA', 'packet.schemaVersion is unsupported');
  }
  const before = normalizeObservation(packet.before, 'before');
  const after = normalizeObservation(packet.after, 'after');
  const identityComparison = compareIdentity(before, after);
  const memoryComparison = compareMemory(before, after);
  const [verdict, reason] = classify(before, after, identityComparison, memoryComparison);

  const core = {
    schemaVersion: STEPHANOS_MEMORY_PROVIDER_SWAP_EVALUATION_SCHEMA_V1,
    verdict,
    reason,
    providerChanged: before.providerId !== after.providerId,
    beforeProviderId: before.providerId,
    afterProviderId: after.providerId,
    beforeProviderClass: before.providerClass,
    afterProviderClass: after.providerClass,
    surface: before.surface === after.surface ? before.surface : null,
    identityStable: identityComparison.stable && before.surface === after.surface,
    identityDriftFields: identityComparison.drift,
    threadStable: before.surfaceThreadRef === after.surfaceThreadRef,
    beforeThreadRef: before.surfaceThreadRef,
    afterThreadRef: after.surfaceThreadRef,
    memoryStable: memoryComparison.stable && before.canonicalRecordDigest === after.canonicalRecordDigest,
    memoryDrift: memoryComparison.drift,
    beforeCanonicalRecordDigest: before.canonicalRecordDigest,
    afterCanonicalRecordDigest: after.canonicalRecordDigest,
    beforeEvidenceRefs: before.evidenceRefs,
    afterEvidenceRefs: after.evidenceRefs,
  };
  const evaluationDigest = sha256Canonical(core);
  const result = { ...core, evaluationDigest, authority: STEPHANOS_MEMORY_PROVIDER_SWAP_AUTHORITY };
  const serializedBytes = Buffer.byteLength(canonicalStringify(result), 'utf8');
  if (serializedBytes > STEPHANOS_MEMORY_PROVIDER_SWAP_MAX_BYTES) {
    fail('EVALUATION_TOO_LARGE', 'evaluation exceeds bounded serialized size');
  }
  return deepFreeze({ ...result, serializedBytes });
}
