import { createHash } from 'node:crypto';

export const STEPHANOS_MEMORY_ARCHIVE_INPUT_SCHEMA_V1 = 'stephanos.memory-archive-input.v1';
export const STEPHANOS_MEMORY_ARCHIVE_INDEX_SCHEMA_V1 = 'stephanos.memory-archive-index.v1';
export const STEPHANOS_MEMORY_RESTORE_INPUT_SCHEMA_V1 = 'stephanos.memory-restore-input.v1';
export const STEPHANOS_MEMORY_RESTORE_PLAN_SCHEMA_V1 = 'stephanos.memory-restore-plan.v1';

export const STEPHANOS_MEMORY_ARCHIVE_MAX_ENTRIES = 256;
export const STEPHANOS_MEMORY_ARCHIVE_MAX_REFS = 8;
export const STEPHANOS_MEMORY_ARCHIVE_MAX_TAGS = 12;
export const STEPHANOS_MEMORY_ARCHIVE_MAX_INDEX_BYTES = 512 * 1024;
export const STEPHANOS_MEMORY_RESTORE_MAX_CURRENT_RECORDS = 512;

export const STEPHANOS_MEMORY_ARCHIVE_STATES = Object.freeze([
  'CURRENT',
  'SUPERSEDED',
  'TOMBSTONE',
  'EXPIRED',
]);

export const STEPHANOS_MEMORY_ARCHIVE_AUTHORITY_CLASSES = Object.freeze([
  'SHARED_AUTHORITY',
  'OPERATOR_CONFIRMED',
  'CANONICAL_PROJECT_EVIDENCE',
  'LOCAL_MIRROR',
  'PENDING_INTENT',
  'INFERRED',
  'UNKNOWN',
]);

export const STEPHANOS_MEMORY_RESTORE_DISPOSITIONS = Object.freeze([
  'RESTORE_CANDIDATE',
  'RETAIN_TOMBSTONE',
  'SKIP_ALREADY_PRESENT',
  'SKIP_SUPERSEDED',
  'HOLD_CONFLICT',
  'HOLD_AUTHORITY',
  'HOLD_SENSITIVE',
]);

export const STEPHANOS_MEMORY_ARCHIVE_AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  deleteAllowed: false,
  forgetAllowed: false,
  correctionAllowed: false,
  compactionAllowed: false,
  archiveWriteAllowed: false,
  restoreExecutionAllowed: false,
  evictionAllowed: false,
  providerPromptUseAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

const TOP_LEVEL_ARCHIVE_KEYS = new Set(['schemaVersion', 'exportedAtUtc', 'records']);
const ARCHIVE_RECORD_KEYS = new Set([
  'recordId', 'namespace', 'memoryType', 'cognitiveClass', 'authorityClass', 'state',
  'observedAtUtc', 'validFromUtc', 'validUntilUtc', 'supersedes', 'supersededBy',
  'sourceRefs', 'proofRefs', 'tags', 'goalRef', 'prRef', 'component', 'participant',
  'source', 'digest', 'sensitivityClass', 'retentionDisposition',
]);
const CURRENT_RECORD_KEYS = new Set([
  'recordId', 'authorityClass', 'state', 'digest', 'supersedes', 'supersededBy',
  'sensitivityClass',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,191}$/;
const SAFE_TEXT = /^[\p{L}\p{N} _./:#@+()\[\]-]{0,256}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE_CLASSES = new Set([
  'CREDENTIAL', 'SECRET', 'SESSION', 'COOKIE', 'RAW_PROMPT', 'RAW_RESPONSE',
  'UNRESTRICTED_LOG', 'LOCAL_PATH', 'PSYCHOLOGICAL_PROFILE', 'MENTAL_DIAGNOSIS',
  'OMITTED_SENSITIVE',
]);
const RESTORABLE_AUTHORITIES = new Set([
  'SHARED_AUTHORITY', 'OPERATOR_CONFIRMED', 'CANONICAL_PROJECT_EVIDENCE',
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

function assertPlainDataObject(value, allowedKeys, label) {
  if (!isPlainObject(value)) fail('INVALID_SHAPE', `${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.has(key)) fail('UNEXPECTED_FIELD', `${label}.${key} is not allowed`);
    if (!('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}.${key} must not be an accessor`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
}

function captureDenseArray(value, label, maxLength) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('INVALID_ARRAY', `${label} must be a standard array`);
  }
  if (value.length > maxLength) fail('LIMIT_EXCEEDED', `${label} exceeds ${maxLength}`);
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) fail('SPARSE_ARRAY_REJECTED', `${label} must be dense`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) fail('ACCESSOR_REJECTED', `${label}[${i}] must be a data value`);
  }
  if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_REJECTED', `${label} must not contain symbol keys`);
  return [...value];
}

function captureOptionalString(value, label, { id = false, digest = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail('INVALID_STRING', `${label} must be a string`);
  if (digest && !DIGEST.test(value)) fail('INVALID_DIGEST', `${label} must be sha256:<64 lowercase hex>`);
  if (id && !SAFE_ID.test(value)) fail('INVALID_ID', `${label} is unsafe`);
  if (!id && !digest && !SAFE_TEXT.test(value)) fail('INVALID_TEXT', `${label} contains unsupported characters or is too long`);
  return value;
}

function captureRequiredString(value, label, options) {
  const captured = captureOptionalString(value, label, options);
  if (!captured) fail('MISSING_FIELD', `${label} is required`);
  return captured;
}

function captureIso(value, label, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('MISSING_FIELD', `${label} is required`);
    return null;
  }
  if (typeof value !== 'string') fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail('INVALID_DATE', `${label} must be an ISO timestamp`);
  return new Date(ms).toISOString();
}

function captureStringArray(value, label, max, { id = false } = {}) {
  if (value === undefined || value === null) return [];
  const input = captureDenseArray(value, label, max);
  const out = input.map((item, index) => captureRequiredString(item, `${label}[${index}]`, { id }));
  return [...new Set(out)].sort();
}

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freezeDeep(item);
  }
  return value;
}

function normalizeArchiveRecord(input, index) {
  assertPlainDataObject(input, ARCHIVE_RECORD_KEYS, `records[${index}]`);
  const recordId = captureRequiredString(input.recordId, `records[${index}].recordId`, { id: true });
  const authorityClass = captureRequiredString(input.authorityClass, `records[${index}].authorityClass`);
  if (!STEPHANOS_MEMORY_ARCHIVE_AUTHORITY_CLASSES.includes(authorityClass)) {
    fail('INVALID_AUTHORITY', `records[${index}].authorityClass is unsupported`);
  }
  const state = captureRequiredString(input.state, `records[${index}].state`);
  if (!STEPHANOS_MEMORY_ARCHIVE_STATES.includes(state)) fail('INVALID_STATE', `records[${index}].state is unsupported`);
  const digest = captureRequiredString(input.digest, `records[${index}].digest`, { digest: true });
  const sensitivityClass = captureOptionalString(input.sensitivityClass, `records[${index}].sensitivityClass`) || 'NORMAL';

  const record = {
    recordId,
    namespace: captureOptionalString(input.namespace, `records[${index}].namespace`),
    memoryType: captureOptionalString(input.memoryType, `records[${index}].memoryType`),
    cognitiveClass: captureOptionalString(input.cognitiveClass, `records[${index}].cognitiveClass`),
    authorityClass,
    state,
    observedAtUtc: captureIso(input.observedAtUtc, `records[${index}].observedAtUtc`),
    validFromUtc: captureIso(input.validFromUtc, `records[${index}].validFromUtc`),
    validUntilUtc: captureIso(input.validUntilUtc, `records[${index}].validUntilUtc`),
    supersedes: captureStringArray(input.supersedes, `records[${index}].supersedes`, STEPHANOS_MEMORY_ARCHIVE_MAX_REFS, { id: true }),
    supersededBy: captureStringArray(input.supersededBy, `records[${index}].supersededBy`, STEPHANOS_MEMORY_ARCHIVE_MAX_REFS, { id: true }),
    sourceRefs: captureStringArray(input.sourceRefs, `records[${index}].sourceRefs`, STEPHANOS_MEMORY_ARCHIVE_MAX_REFS, { id: true }),
    proofRefs: captureStringArray(input.proofRefs, `records[${index}].proofRefs`, STEPHANOS_MEMORY_ARCHIVE_MAX_REFS, { id: true }),
    tags: captureStringArray(input.tags, `records[${index}].tags`, STEPHANOS_MEMORY_ARCHIVE_MAX_TAGS),
    goalRef: captureOptionalString(input.goalRef, `records[${index}].goalRef`, { id: true }),
    prRef: captureOptionalString(input.prRef, `records[${index}].prRef`, { id: true }),
    component: captureOptionalString(input.component, `records[${index}].component`),
    participant: captureOptionalString(input.participant, `records[${index}].participant`),
    source: captureOptionalString(input.source, `records[${index}].source`),
    digest,
    sensitivityClass,
    retentionDisposition: captureOptionalString(input.retentionDisposition, `records[${index}].retentionDisposition`),
  };

  record.sensitiveContentOmitted = SENSITIVE_CLASSES.has(sensitivityClass);
  return record;
}

function assertUniqueRecords(records) {
  const seen = new Map();
  for (const record of records) {
    const prior = seen.get(record.recordId);
    if (!prior) {
      seen.set(record.recordId, record);
      continue;
    }
    if (prior.digest !== record.digest || prior.state !== record.state || prior.authorityClass !== record.authorityClass) {
      fail('DUPLICATE_CONFLICT', `recordId ${record.recordId} has conflicting archive metadata`);
    }
    fail('DUPLICATE_RECORD', `recordId ${record.recordId} is duplicated`);
  }
}

export function buildStephanosMemoryArchiveIndexV1(packet) {
  assertPlainDataObject(packet, TOP_LEVEL_ARCHIVE_KEYS, 'packet');
  if (packet.schemaVersion !== STEPHANOS_MEMORY_ARCHIVE_INPUT_SCHEMA_V1) {
    fail('UNSUPPORTED_SCHEMA', 'archive input schemaVersion is unsupported');
  }
  const exportedAtUtc = captureIso(packet.exportedAtUtc, 'packet.exportedAtUtc', true);
  const inputs = captureDenseArray(packet.records, 'packet.records', STEPHANOS_MEMORY_ARCHIVE_MAX_ENTRIES);
  const records = inputs.map(normalizeArchiveRecord).sort((a, b) => a.recordId.localeCompare(b.recordId));
  assertUniqueRecords(records);

  const core = {
    schemaVersion: STEPHANOS_MEMORY_ARCHIVE_INDEX_SCHEMA_V1,
    exportedAtUtc,
    recordCount: records.length,
    records,
  };
  const manifestDigest = sha256Canonical(core);
  const result = {
    ...core,
    manifestDigest,
    authority: STEPHANOS_MEMORY_ARCHIVE_AUTHORITY,
  };
  const bytes = Buffer.byteLength(canonicalStringify(result), 'utf8');
  if (bytes > STEPHANOS_MEMORY_ARCHIVE_MAX_INDEX_BYTES) fail('INDEX_TOO_LARGE', 'archive index exceeds bounded serialized size');
  return freezeDeep({ ...result, serializedBytes: bytes });
}

function normalizeCurrentRecord(input, index) {
  assertPlainDataObject(input, CURRENT_RECORD_KEYS, `currentRecords[${index}]`);
  const authorityClass = captureRequiredString(input.authorityClass, `currentRecords[${index}].authorityClass`);
  if (!STEPHANOS_MEMORY_ARCHIVE_AUTHORITY_CLASSES.includes(authorityClass)) fail('INVALID_AUTHORITY', `currentRecords[${index}].authorityClass is unsupported`);
  const state = captureRequiredString(input.state, `currentRecords[${index}].state`);
  if (!STEPHANOS_MEMORY_ARCHIVE_STATES.includes(state)) fail('INVALID_STATE', `currentRecords[${index}].state is unsupported`);
  return {
    recordId: captureRequiredString(input.recordId, `currentRecords[${index}].recordId`, { id: true }),
    authorityClass,
    state,
    digest: captureRequiredString(input.digest, `currentRecords[${index}].digest`, { digest: true }),
    supersedes: captureStringArray(input.supersedes, `currentRecords[${index}].supersedes`, STEPHANOS_MEMORY_ARCHIVE_MAX_REFS, { id: true }),
    supersededBy: captureStringArray(input.supersededBy, `currentRecords[${index}].supersededBy`, STEPHANOS_MEMORY_ARCHIVE_MAX_REFS, { id: true }),
    sensitivityClass: captureOptionalString(input.sensitivityClass, `currentRecords[${index}].sensitivityClass`) || 'NORMAL',
  };
}

function classifyRestore(archived, currentById, currentRecords) {
  if (archived.state === 'TOMBSTONE') {
    return ['RETAIN_TOMBSTONE', 'archived tombstone metadata must remain visible and must never resurrect forgotten content'];
  }
  if (archived.sensitiveContentOmitted || SENSITIVE_CLASSES.has(archived.sensitivityClass)) {
    return ['HOLD_SENSITIVE', 'sensitive or deliberately omitted content is not eligible for automatic restore'];
  }
  if (!RESTORABLE_AUTHORITIES.has(archived.authorityClass)) {
    return ['HOLD_AUTHORITY', 'archive authority is not sufficient for a restore candidate'];
  }

  const current = currentById.get(archived.recordId);
  if (current) {
    if (current.state === 'TOMBSTONE') {
      return ['RETAIN_TOMBSTONE', 'current tombstone outranks archived content and forbids resurrection'];
    }
    if (current.digest === archived.digest && current.state === archived.state) {
      return ['SKIP_ALREADY_PRESENT', 'the same record digest and state already exist'];
    }
    if (current.supersedes.includes(archived.recordId) || archived.supersededBy.includes(current.recordId)) {
      return ['SKIP_SUPERSEDED', 'current memory explicitly supersedes the archived record'];
    }
    return ['HOLD_CONFLICT', 'current record identity exists with different state or digest'];
  }

  const supersedingCurrent = currentRecords.find((candidate) =>
    candidate.supersedes.includes(archived.recordId) || archived.supersededBy.includes(candidate.recordId));
  if (supersedingCurrent) {
    return ['SKIP_SUPERSEDED', `current record ${supersedingCurrent.recordId} supersedes archived history`];
  }

  if (archived.state === 'SUPERSEDED' || archived.state === 'EXPIRED') {
    return ['SKIP_SUPERSEDED', `archived state ${archived.state} is historical and must not become current`];
  }

  return ['RESTORE_CANDIDATE', 'authority-confirmed current archive metadata is missing from the current snapshot'];
}

export function buildStephanosMemoryRestorePlanV1(packet) {
  const allowed = new Set(['schemaVersion', 'archiveIndex', 'currentRecords']);
  assertPlainDataObject(packet, allowed, 'packet');
  if (packet.schemaVersion !== STEPHANOS_MEMORY_RESTORE_INPUT_SCHEMA_V1) {
    fail('UNSUPPORTED_SCHEMA', 'restore input schemaVersion is unsupported');
  }
  const archiveIndex = packet.archiveIndex;
  if (!isPlainObject(archiveIndex) || archiveIndex.schemaVersion !== STEPHANOS_MEMORY_ARCHIVE_INDEX_SCHEMA_V1) {
    fail('INVALID_ARCHIVE_INDEX', 'archiveIndex must be a V1 archive index');
  }
  const archiveRecords = captureDenseArray(archiveIndex.records, 'packet.archiveIndex.records', STEPHANOS_MEMORY_ARCHIVE_MAX_ENTRIES);
  const expectedCore = {
    schemaVersion: archiveIndex.schemaVersion,
    exportedAtUtc: archiveIndex.exportedAtUtc,
    recordCount: archiveIndex.recordCount,
    records: archiveRecords,
  };
  if (archiveIndex.manifestDigest !== sha256Canonical(expectedCore)) {
    fail('ARCHIVE_DIGEST_MISMATCH', 'archive index manifestDigest does not match its metadata');
  }

  const currentInputs = captureDenseArray(packet.currentRecords, 'packet.currentRecords', STEPHANOS_MEMORY_RESTORE_MAX_CURRENT_RECORDS);
  const currentRecords = currentInputs.map(normalizeCurrentRecord);
  assertUniqueRecords(currentRecords);
  const currentById = new Map(currentRecords.map((record) => [record.recordId, record]));

  const items = archiveRecords.map((archived) => {
    const [disposition, reason] = classifyRestore(archived, currentById, currentRecords);
    return {
      recordId: archived.recordId,
      archivedDigest: archived.digest,
      archivedState: archived.state,
      archivedAuthorityClass: archived.authorityClass,
      disposition,
      reason,
    };
  });
  const summary = Object.fromEntries(STEPHANOS_MEMORY_RESTORE_DISPOSITIONS.map((value) => [value, 0]));
  for (const item of items) summary[item.disposition] += 1;

  return freezeDeep({
    schemaVersion: STEPHANOS_MEMORY_RESTORE_PLAN_SCHEMA_V1,
    sourceManifestDigest: archiveIndex.manifestDigest,
    itemCount: items.length,
    summary,
    items,
    authority: STEPHANOS_MEMORY_ARCHIVE_AUTHORITY,
  });
}
