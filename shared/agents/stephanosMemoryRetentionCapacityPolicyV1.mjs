import { createHash } from 'node:crypto';
import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_MEMORY_RETENTION_POLICY_SCHEMA_VERSION = 'stephanos.memory-retention-capacity-policy.v1';
export const STEPHANOS_MEMORY_RETENTION_EVALUATION_SCHEMA_VERSION = 'stephanos.memory-retention-capacity-evaluation.v1';
export const STEPHANOS_MEMORY_RETENTION_MAX_RECORDS = 2048;
export const STEPHANOS_MEMORY_RETENTION_MAX_REFS = 16;
export const STEPHANOS_MEMORY_RETENTION_MAX_SERIALIZED_BYTES = 512 * 1024;
export const STEPHANOS_MEMORY_RETENTION_WORKING_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const STEPHANOS_MEMORY_RETENTION_TELEMETRY_COMPACT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const STEPHANOS_MEMORY_RETENTION_SUPERSEDED_ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const STEPHANOS_MEMORY_RETENTION_COLD_EVIDENCE_ARCHIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

export const STEPHANOS_MEMORY_COGNITIVE_CLASSES = Object.freeze([
  'WORKING_MEMORY', 'EPISODIC_MEMORY', 'SEMANTIC_MEMORY', 'PROCEDURAL_MEMORY',
  'PROSPECTIVE_MEMORY', 'REFLECTIVE_MEMORY', 'OTHER_GOVERNED_MEMORY',
]);
export const STEPHANOS_MEMORY_RETENTION_CLASSES = Object.freeze([
  'EPHEMERAL_SESSION', 'DURABLE_DECISION', 'DURABLE_EVIDENCE', 'REPETITIVE_TELEMETRY',
  'SUPERSEDED_PROJECTION', 'TOMBSTONE', 'COLD_EVIDENCE', 'UNKNOWN',
]);
export const STEPHANOS_MEMORY_LIFECYCLE_STATES = Object.freeze([
  'ACTIVE', 'CURRENT', 'OPEN', 'BLOCKED', 'SUPERSEDED', 'RESOLVED', 'CLOSED',
  'EXPIRED', 'CANCELLED', 'RETIRED', 'UNKNOWN',
]);
export const STEPHANOS_MEMORY_RETENTION_ACTIONS = Object.freeze([
  'RETAIN_HOT', 'RETAIN_TOMBSTONE', 'COMPACTION_CANDIDATE', 'ARCHIVE_CANDIDATE',
  'EXPIRY_CANDIDATE', 'SAFE_HOLD',
]);
export const STEPHANOS_MEMORY_PROTECTED_REASONS = Object.freeze([
  'OPERATOR_DECISION', 'OPERATOR_APPROVAL', 'DURABLE_CORRECTION', 'LEGAL_PRIVACY_ACTION',
  'AUTHORITY_EVIDENCE', 'AUDIT_REQUIRED',
]);

const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const COGNITIVE_CLASSES = new Set(STEPHANOS_MEMORY_COGNITIVE_CLASSES);
const RETENTION_CLASSES = new Set(STEPHANOS_MEMORY_RETENTION_CLASSES);
const LIFECYCLE_STATES = new Set(STEPHANOS_MEMORY_LIFECYCLE_STATES);
const PROTECTED_REASONS = new Set(STEPHANOS_MEMORY_PROTECTED_REASONS);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_REF = /^(?:memory|episode|claim|method|goal|issue|pr|receipt|proof|evidence|decision|correction|approval|workspace|runtime|project|component):\/\/[a-z0-9][a-z0-9._:/#@-]{0,220}$/i;
const RECORD_KEYS = Object.freeze([
  'recordId', 'cognitiveClass', 'retentionClass', 'lifecycleState', 'authorityClass',
  'approximateBytes', 'createdAtUtc', 'lastTouchedAtUtc', 'validUntilUtc',
  'protectedReasons', 'sourceRefs',
]);
const INPUT_KEYS = Object.freeze(['observedAtUtc', 'capacityLimitBytes', 'records']);
const INVALID = Symbol('invalid');

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  deleteAllowed: false,
  forgetAllowed: false,
  compactionExecutionAllowed: false,
  archiveExecutionAllowed: false,
  tombstoneMutationAllowed: false,
  retentionOverrideAllowed: false,
  capacityEvictionAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function exactObject(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return INVALID;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return INVALID;
    if (Object.getOwnPropertySymbols(value).length) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (JSON.stringify(Object.keys(descriptors).sort(compareText)) !== JSON.stringify([...keys].sort(compareText))) return INVALID;
    const out = Object.create(null);
    for (const key of keys) {
      const d = descriptors[key];
      if (!d?.enumerable || !Object.hasOwn(d, 'value') || d.get || d.set) return INVALID;
      out[key] = d.value;
    }
    return Object.freeze(out);
  } catch { return INVALID; }
}

function denseArray(value, maximum) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Object.keys(descriptors).length !== length + 1) return INVALID;
    const out = [];
    for (let i = 0; i < length; i += 1) {
      const d = descriptors[String(i)];
      if (!d?.enumerable || !Object.hasOwn(d, 'value') || d.get || d.set) return INVALID;
      out.push(d.value);
    }
    return Object.freeze(out);
  } catch { return INVALID; }
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

function normalizeOptionalTimestamp(value, field, errors) {
  if (value === null) return null;
  if (!exactTimestamp(value)) { errors.push(`${field}-invalid`); return null; }
  return value;
}

function normalizeStringList(value, field, validator, errors) {
  const values = denseArray(value, STEPHANOS_MEMORY_RETENTION_MAX_REFS);
  if (values === INVALID || values.some((item) => typeof item !== 'string')) {
    errors.push(`${field}-must-be-dense-bounded-string-array`);
    return [];
  }
  const out = [];
  for (const item of values) {
    if (!validator(item)) errors.push(`${field}-contains-invalid-value`);
    else out.push(item);
  }
  if (new Set(out).size !== out.length) errors.push(`${field}-contains-duplicate`);
  return out;
}

function normalizeRecord(value, index) {
  const errors = [];
  const record = exactObject(value, RECORD_KEYS);
  if (record === INVALID) return { record: null, errors: [`record-${index}:invalid-exact-data-shape`] };
  if (!SAFE_ID.test(record.recordId || '')) errors.push('recordId-invalid');
  if (!COGNITIVE_CLASSES.has(record.cognitiveClass)) errors.push('cognitiveClass-invalid');
  if (!RETENTION_CLASSES.has(record.retentionClass)) errors.push('retentionClass-invalid');
  if (!LIFECYCLE_STATES.has(record.lifecycleState)) errors.push('lifecycleState-invalid');
  if (!AUTHORITY_CLASSES.has(record.authorityClass)) errors.push('authorityClass-invalid');
  if (!Number.isSafeInteger(record.approximateBytes) || record.approximateBytes < 0 || record.approximateBytes > 16 * 1024 * 1024) errors.push('approximateBytes-invalid');
  if (!exactTimestamp(record.createdAtUtc)) errors.push('createdAtUtc-invalid');
  if (!exactTimestamp(record.lastTouchedAtUtc)) errors.push('lastTouchedAtUtc-invalid');
  const validUntilUtc = normalizeOptionalTimestamp(record.validUntilUtc, 'validUntilUtc', errors);
  const protectedReasons = normalizeStringList(record.protectedReasons, 'protectedReasons', (item) => PROTECTED_REASONS.has(item), errors);
  const sourceRefs = normalizeStringList(record.sourceRefs, 'sourceRefs', (item) => SAFE_REF.test(item) && !item.includes('..'), errors);
  if (!sourceRefs.length) errors.push('sourceRefs-required');
  const createdAtMs = exactTimestamp(record.createdAtUtc) ? Date.parse(record.createdAtUtc) : 0;
  const lastTouchedAtMs = exactTimestamp(record.lastTouchedAtUtc) ? Date.parse(record.lastTouchedAtUtc) : 0;
  if (lastTouchedAtMs < createdAtMs) errors.push('lastTouchedAtUtc-before-createdAtUtc');
  const validUntilMs = validUntilUtc ? Date.parse(validUntilUtc) : null;
  if (validUntilMs !== null && validUntilMs < createdAtMs) errors.push('validUntilUtc-before-createdAtUtc');
  return {
    record: Object.freeze({ ...record, validUntilUtc, protectedReasons: Object.freeze(protectedReasons), sourceRefs: Object.freeze(sourceRefs), createdAtMs, lastTouchedAtMs, validUntilMs }),
    errors: errors.map((e) => `record-${index}:${e}`),
  };
}

function pressureFor(totalBytes, limitBytes) {
  const ratio = limitBytes === 0 ? 1 : totalBytes / limitBytes;
  if (ratio >= 1) return Object.freeze({ level: 'EXCEEDED', ratio });
  if (ratio >= 0.95) return Object.freeze({ level: 'CRITICAL', ratio });
  if (ratio >= 0.85) return Object.freeze({ level: 'HIGH', ratio });
  if (ratio >= 0.70) return Object.freeze({ level: 'NOTICE', ratio });
  return Object.freeze({ level: 'NORMAL', ratio });
}

function evaluateRecord(record, observedAtMs) {
  const protectedRecord = record.protectedReasons.length > 0;
  const ageMs = Math.max(0, observedAtMs - record.createdAtMs);
  const untouchedMs = Math.max(0, observedAtMs - record.lastTouchedAtMs);
  const expiredByValidity = record.validUntilMs !== null && observedAtMs >= record.validUntilMs;

  if (record.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN || record.retentionClass === 'UNKNOWN' || record.lifecycleState === 'UNKNOWN') {
    return { action: 'SAFE_HOLD', reason: 'unknown-authority-retention-or-lifecycle' };
  }
  if (record.retentionClass === 'TOMBSTONE') return { action: 'RETAIN_TOMBSTONE', reason: 'tombstone-semantics-must-survive' };
  if (protectedRecord) return { action: 'RETAIN_HOT', reason: 'protected-record-cannot-be-erased-or-compacted' };
  if (['ACTIVE', 'CURRENT', 'OPEN', 'BLOCKED'].includes(record.lifecycleState)) return { action: 'RETAIN_HOT', reason: 'active-or-current-memory' };
  if (record.cognitiveClass === 'WORKING_MEMORY' || record.retentionClass === 'EPHEMERAL_SESSION') {
    if (expiredByValidity || ageMs >= STEPHANOS_MEMORY_RETENTION_WORKING_MAX_AGE_MS) return { action: 'EXPIRY_CANDIDATE', reason: 'working-context-expired' };
    return { action: 'RETAIN_HOT', reason: 'working-context-still-within-session-window' };
  }
  if (record.retentionClass === 'REPETITIVE_TELEMETRY' && untouchedMs >= STEPHANOS_MEMORY_RETENTION_TELEMETRY_COMPACT_AFTER_MS) {
    return { action: 'COMPACTION_CANDIDATE', reason: 'repetitive-telemetry-is-cold' };
  }
  if ((record.lifecycleState === 'SUPERSEDED' || record.retentionClass === 'SUPERSEDED_PROJECTION')
      && untouchedMs >= STEPHANOS_MEMORY_RETENTION_SUPERSEDED_ARCHIVE_AFTER_MS) {
    return { action: 'ARCHIVE_CANDIDATE', reason: 'superseded-history-is-cold-but-must-remain-searchable' };
  }
  if (record.retentionClass === 'COLD_EVIDENCE' && untouchedMs >= STEPHANOS_MEMORY_RETENTION_COLD_EVIDENCE_ARCHIVE_AFTER_MS) {
    return { action: 'ARCHIVE_CANDIDATE', reason: 'cold-evidence-remains-searchable-via-archive' };
  }
  return { action: 'RETAIN_HOT', reason: 'no-safe-compaction-archive-or-expiry-rule-matched' };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeHold(errors) {
  return deepFreeze({
    schemaVersion: STEPHANOS_MEMORY_RETENTION_EVALUATION_SCHEMA_VERSION,
    evaluationKind: 'READ_ONLY_RETENTION_CAPACITY_PLAN', evaluationId: '', observedAtUtc: '',
    totalObservedBytes: 0, capacityLimitBytes: 0, capacityPressure: { level: 'UNKNOWN', ratio: null },
    decisions: [], countsByAction: {}, protectedRecordIds: [],
    authority: AUTHORITY, valid: false, verdict: 'SAFE_HOLD', validationErrors: errors,
  });
}

export function buildStephanosMemoryRetentionCapacityPolicyV1(input = {}) {
  const observed = exactObject(input, INPUT_KEYS);
  if (observed === INVALID) return safeHold(['input-invalid-exact-data-shape']);
  const errors = [];
  if (!exactTimestamp(observed.observedAtUtc)) errors.push('observedAtUtc-invalid');
  if (!Number.isSafeInteger(observed.capacityLimitBytes) || observed.capacityLimitBytes <= 0 || observed.capacityLimitBytes > 1024 * 1024 * 1024) errors.push('capacityLimitBytes-invalid');
  const observedAtMs = exactTimestamp(observed.observedAtUtc) ? Date.parse(observed.observedAtUtc) : 0;
  const values = denseArray(observed.records, STEPHANOS_MEMORY_RETENTION_MAX_RECORDS);
  if (values === INVALID) errors.push('records-must-be-dense-bounded-array');
  const records = [];
  if (values !== INVALID) {
    for (let i = 0; i < values.length; i += 1) {
      const normalized = normalizeRecord(values[i], i);
      errors.push(...normalized.errors);
      if (normalized.record) records.push(normalized.record);
    }
  }
  const ids = records.map((r) => r.recordId);
  if (new Set(ids).size !== ids.length) errors.push('recordIds-must-be-unique');
  if (Buffer.byteLength(JSON.stringify(records), 'utf8') > STEPHANOS_MEMORY_RETENTION_MAX_SERIALIZED_BYTES) errors.push('records-serialized-size-exceeds-bound');
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length) return safeHold(uniqueErrors);

  const ordered = [...records].sort((a, b) => compareText(a.recordId, b.recordId));
  const decisions = ordered.map((record) => {
    const result = evaluateRecord(record, observedAtMs);
    return Object.freeze({
      recordId: record.recordId, cognitiveClass: record.cognitiveClass, retentionClass: record.retentionClass,
      lifecycleState: record.lifecycleState, authorityClass: record.authorityClass,
      approximateBytes: record.approximateBytes, protectedReasons: record.protectedReasons,
      action: result.action, reason: result.reason, sourceRefs: record.sourceRefs,
    });
  });
  const totalObservedBytes = ordered.reduce((sum, r) => sum + r.approximateBytes, 0);
  const capacityPressure = pressureFor(totalObservedBytes, observed.capacityLimitBytes);
  const countsByAction = Object.fromEntries(STEPHANOS_MEMORY_RETENTION_ACTIONS.map((action) => [action, decisions.filter((d) => d.action === action).length]));
  const protectedRecordIds = decisions.filter((d) => d.protectedReasons.length > 0 || d.action === 'RETAIN_TOMBSTONE').map((d) => d.recordId);
  const verdict = capacityPressure.level === 'NORMAL' ? 'RETENTION_PLAN_READY' : 'RETENTION_PLAN_READY_WITH_CAPACITY_PRESSURE';
  const evaluationId = `retention-${createHash('sha256').update(JSON.stringify({ observedAtUtc: observed.observedAtUtc, capacityLimitBytes: observed.capacityLimitBytes, decisions })).digest('hex').slice(0, 32)}`;

  return deepFreeze({
    schemaVersion: STEPHANOS_MEMORY_RETENTION_EVALUATION_SCHEMA_VERSION,
    policySchemaVersion: STEPHANOS_MEMORY_RETENTION_POLICY_SCHEMA_VERSION,
    evaluationKind: 'READ_ONLY_RETENTION_CAPACITY_PLAN', evaluationId, observedAtUtc: observed.observedAtUtc,
    totalObservedBytes, capacityLimitBytes: observed.capacityLimitBytes, capacityPressure,
    decisions, countsByAction, protectedRecordIds,
    authority: AUTHORITY, valid: true, verdict, validationErrors: [],
  });
}
