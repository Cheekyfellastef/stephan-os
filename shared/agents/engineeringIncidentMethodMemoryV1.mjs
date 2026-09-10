import { createHash } from 'node:crypto';

export const ENGINEERING_INCIDENT_METHOD_RECORD_SCHEMA_V1 = 'stephanos.engineering-incident-method-record.v1';
export const ENGINEERING_CODING_MEMORY_PACK_SCHEMA_V1 = 'stephanos.engineering-coding-memory-pack.v1';

export const ENGINEERING_INCIDENT_METHOD_RECORD_CLASSES_V1 = Object.freeze([
  'ENGINEERING_INCIDENT',
  'ROOT_CAUSE_FINDING',
  'SUCCESSFUL_REPAIR',
  'FAILED_REPAIR',
  'REGRESSION_CASE',
  'REUSABLE_METHOD',
  'COUNTEREXAMPLE',
  'AUTOMATION_CANDIDATE',
  'SUPERSEDED_METHOD',
]);

export const ENGINEERING_INCIDENT_METHOD_AUTHORITY_V1 = Object.freeze({
  sourceMutationAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  memoryMutationAllowed: false,
  automationExecutionAllowed: false,
  accountAccessAllowed: false,
  spendingAllowed: false,
  providerSelectionAllowed: false,
  arbitraryCommandAllowed: false,
});

const RECORD_CLASSES = new Set(ENGINEERING_INCIDENT_METHOD_RECORD_CLASSES_V1);
const STATUS_STATES = new Set(['CURRENT', 'HISTORICAL', 'FAILED', 'SUPERSEDED', 'CANDIDATE']);
const FRESHNESS_STATES = new Set(['CURRENT', 'STALE', 'UNKNOWN']);
const PRIVACY_STATES = new Set(['PUBLIC_ENGINEERING', 'INTERNAL_BOUNDED', 'SENSITIVE_OMITTED']);
const ROOT_CAUSE_REQUIRED = new Set(['ROOT_CAUSE_FINDING', 'SUCCESSFUL_REPAIR', 'FAILED_REPAIR']);
const METHOD_REQUIRED = new Set(['SUCCESSFUL_REPAIR', 'FAILED_REPAIR', 'REUSABLE_METHOD', 'AUTOMATION_CANDIDATE', 'SUPERSEDED_METHOD']);
const SYMPTOM_REQUIRED = new Set([
  'ENGINEERING_INCIDENT',
  'ROOT_CAUSE_FINDING',
  'SUCCESSFUL_REPAIR',
  'FAILED_REPAIR',
  'REGRESSION_CASE',
  'COUNTEREXAMPLE',
]);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const SAFE_REF = /^[a-z0-9][a-z0-9._:/#@+-]{0,239}$/i;
const CANONICAL_ISSUE_OWNER_REF = /^#[1-9][0-9]{0,9}$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const MAX_PACK_BYTES = 64 * 1024;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeText(value) {
  const normalized = text(value);
  return normalized && normalized.length <= 1000 && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : null;
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : null;
}

function safeRef(value) {
  const normalized = text(value);
  return SAFE_REF.test(normalized) ? normalized : null;
}

function safeComponentOrOwnerRef(value) {
  const normalized = text(value);
  return CANONICAL_ISSUE_OWNER_REF.test(normalized) || SAFE_REF.test(normalized) ? normalized : null;
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return FULL_SHA.test(normalized) ? normalized : null;
}

function timestamp(value) {
  const normalized = text(value);
  if (!normalized || !EXPLICIT_TIMEZONE.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  for (const key of Object.keys(value)) value[key] = deepFreeze(value[key]);
  return Object.freeze(value);
}

function normalizedList(value, { field, blockers, min = 0, max = 32, normalize = safeText } = {}) {
  if (!Array.isArray(value)) {
    blockers.push(`${field}-must-be-array`);
    return [];
  }
  if (value.length < min) blockers.push(`${field}-too-short`);
  if (value.length > max) blockers.push(`${field}-too-long`);
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = normalize(item);
    if (!normalized) {
      blockers.push(`${field}-item-invalid`);
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      blockers.push(`${field}-duplicate`);
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function authorityIsZero(authority) {
  if (authority === null || authority === undefined) return true;
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) return false;
  return Object.values(authority).every((value) => value === false || value === null || value === undefined);
}

function requiredStatus(recordClass, status) {
  if (recordClass === 'FAILED_REPAIR') return status === 'FAILED';
  if (recordClass === 'SUPERSEDED_METHOD') return status === 'SUPERSEDED';
  if (recordClass === 'AUTOMATION_CANDIDATE') return status === 'CANDIDATE';
  return true;
}

export function validateEngineeringIncidentMethodRecordInputV1(input = {}) {
  const blockers = [];
  const recordKey = safeId(input.recordKey);
  if (!recordKey) blockers.push('record-key-invalid');

  const recordClass = text(input.recordClass).toUpperCase();
  if (!RECORD_CLASSES.has(recordClass)) blockers.push('record-class-invalid');

  const problemClass = safeId(input.problemClass);
  if (!problemClass) blockers.push('problem-class-invalid');

  const componentAndOwnerRefs = normalizedList(input.componentAndOwnerRefs, {
    field: 'component-and-owner-refs',
    blockers,
    min: 1,
    max: 32,
    normalize: safeComponentOrOwnerRef,
  });

  const observedAtUtc = timestamp(input.observedAtUtc);
  if (!observedAtUtc) blockers.push('observed-at-invalid');

  const sourceHead = input.sourceHead === null || input.sourceHead === undefined || input.sourceHead === ''
    ? null
    : exactSha(input.sourceHead);
  const sourceBase = input.sourceBase === null || input.sourceBase === undefined || input.sourceBase === ''
    ? null
    : exactSha(input.sourceBase);
  if ((sourceHead && !sourceBase) || (!sourceHead && sourceBase)) blockers.push('source-head-and-base-must-be-paired');
  if (input.sourceHead && !sourceHead) blockers.push('source-head-invalid');
  if (input.sourceBase && !sourceBase) blockers.push('source-base-invalid');

  const symptom = safeText(input.symptom);
  const rootCause = safeText(input.rootCause);
  const repairOrMethod = safeText(input.repairOrMethod);
  if (SYMPTOM_REQUIRED.has(recordClass) && !symptom) blockers.push('symptom-required');
  if (ROOT_CAUSE_REQUIRED.has(recordClass) && !rootCause) blockers.push('root-cause-required');
  if (METHOD_REQUIRED.has(recordClass) && !repairOrMethod) blockers.push('repair-or-method-required');

  const prerequisites = normalizedList(input.prerequisites ?? [], {
    field: 'prerequisites',
    blockers,
    max: 32,
  });
  const forbiddenShortcuts = normalizedList(input.forbiddenShortcuts ?? [], {
    field: 'forbidden-shortcuts',
    blockers,
    max: 32,
  });
  const failureModes = normalizedList(input.failureModes ?? [], {
    field: 'failure-modes',
    blockers,
    max: 32,
  });
  const counterexamples = normalizedList(input.counterexamples ?? [], {
    field: 'counterexamples',
    blockers,
    max: 32,
  });
  const testAndProofRefs = normalizedList(input.testAndProofRefs, {
    field: 'test-and-proof-refs',
    blockers,
    min: 1,
    max: 48,
    normalize: safeRef,
  });
  const runtimeEvidenceRefs = normalizedList(input.runtimeEvidenceRefs ?? [], {
    field: 'runtime-evidence-refs',
    blockers,
    max: 32,
    normalize: safeRef,
  });

  const confidenceBasis = safeText(input.confidenceBasis);
  if (!confidenceBasis) blockers.push('confidence-basis-required');

  const freshness = text(input.freshness).toUpperCase();
  if (!FRESHNESS_STATES.has(freshness)) blockers.push('freshness-invalid');

  const supersedes = input.supersedes ? safeRef(input.supersedes) : null;
  const supersededBy = input.supersededBy ? safeRef(input.supersededBy) : null;
  if (input.supersedes && !supersedes) blockers.push('supersedes-invalid');
  if (input.supersededBy && !supersededBy) blockers.push('superseded-by-invalid');

  const applicableDomains = normalizedList(input.applicableDomains, {
    field: 'applicable-domains',
    blockers,
    min: 1,
    max: 24,
    normalize: safeRef,
  });

  const privacyAndSensitivity = text(input.privacyAndSensitivity).toUpperCase();
  if (!PRIVACY_STATES.has(privacyAndSensitivity)) blockers.push('privacy-and-sensitivity-invalid');
  if (Object.hasOwn(input, 'rawTranscript') || Object.hasOwn(input, 'unrestrictedLog')) {
    blockers.push('unrestricted-content-not-admissible');
  }

  const status = text(input.status).toUpperCase();
  if (!STATUS_STATES.has(status)) blockers.push('status-invalid');
  if (status && !requiredStatus(recordClass, status)) blockers.push('status-does-not-match-record-class');
  if (status === 'SUPERSEDED' && !supersededBy) blockers.push('superseded-record-requires-successor');
  if (status === 'CURRENT' && supersededBy) blockers.push('current-record-cannot-have-successor');
  if (recordClass === 'FAILED_REPAIR' && status !== 'FAILED') blockers.push('failed-repair-must-remain-failed');
  if (freshness === 'STALE' && status === 'CURRENT') blockers.push('stale-record-cannot-be-current');
  if (!authorityIsZero(input.authority)) blockers.push('authority-widening-rejected');

  const candidate = {
    schemaVersion: ENGINEERING_INCIDENT_METHOD_RECORD_SCHEMA_V1,
    recordKey,
    recordClass,
    problemClass,
    componentAndOwnerRefs,
    observedAtUtc,
    sourceHead,
    sourceBase,
    symptom: symptom || null,
    rootCause: rootCause || null,
    repairOrMethod: repairOrMethod || null,
    prerequisites,
    forbiddenShortcuts,
    failureModes,
    counterexamples,
    testAndProofRefs,
    runtimeEvidenceRefs,
    confidenceBasis,
    freshness,
    supersedes,
    supersededBy,
    applicableDomains,
    privacyAndSensitivity,
    status,
    authority: ENGINEERING_INCIDENT_METHOD_AUTHORITY_V1,
  };

  if (blockers.length) return deepFreeze({ valid: false, blockers: [...new Set(blockers)].sort(), record: null });
  const recordId = `engineering-memory-${sha256(canonicalJson(candidate)).slice(0, 24)}`;
  return deepFreeze({ valid: true, blockers: [], record: deepFreeze({ ...candidate, recordId }) });
}

export function buildEngineeringIncidentMethodRecordV1(input = {}) {
  const validation = validateEngineeringIncidentMethodRecordInputV1(input);
  if (!validation.valid) throw new Error(`engineering incident/method record rejected: ${validation.blockers.join(', ')}`);
  return validation.record;
}

function relevantRecord(record, problemClass, componentRefs) {
  if (!record || record.schemaVersion !== ENGINEERING_INCIDENT_METHOD_RECORD_SCHEMA_V1) return false;
  if (record.problemClass === problemClass) return true;
  return record.componentAndOwnerRefs.some((ref) => componentRefs.includes(ref));
}

function newestFirst(left, right) {
  return Date.parse(right.observedAtUtc) - Date.parse(left.observedAtUtc)
    || left.recordId.localeCompare(right.recordId);
}

export function buildEngineeringCodingMemoryPackV1(input = {}) {
  const problemClass = safeId(input.problemClass);
  if (!problemClass) throw new Error('coding memory pack problem class is invalid');
  const blockers = [];
  const componentRefs = normalizedList(input.componentRefs, {
    field: 'component-refs',
    blockers,
    min: 1,
    max: 24,
    normalize: safeComponentOrOwnerRef,
  });
  const createdAtUtc = timestamp(input.createdAtUtc);
  if (!createdAtUtc) blockers.push('created-at-invalid');
  const maxRecords = Number(input.maxRecords ?? 12);
  const maxBytes = Number(input.maxBytes ?? 24 * 1024);
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 32) blockers.push('max-records-invalid');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_PACK_BYTES) blockers.push('max-bytes-invalid');
  if (!authorityIsZero(input.authority)) blockers.push('authority-widening-rejected');
  if (blockers.length) throw new Error(`engineering coding memory pack rejected: ${[...new Set(blockers)].sort().join(', ')}`);

  const relevant = (Array.isArray(input.records) ? input.records : [])
    .filter((record) => relevantRecord(record, problemClass, componentRefs))
    .sort(newestFirst);
  if (!relevant.length) throw new Error('engineering coding memory pack has no relevant validated records');

  const preferredMethods = relevant.filter((record) => (
    ['REUSABLE_METHOD', 'SUCCESSFUL_REPAIR'].includes(record.recordClass)
    && record.status === 'CURRENT'
    && record.freshness === 'CURRENT'
  ));
  const incidentsAndCounterexamples = relevant.filter((record) => (
    ['ENGINEERING_INCIDENT', 'ROOT_CAUSE_FINDING', 'FAILED_REPAIR', 'REGRESSION_CASE', 'COUNTEREXAMPLE'].includes(record.recordClass)
  ));
  const automationCandidates = relevant.filter((record) => record.recordClass === 'AUTOMATION_CANDIDATE');
  const selected = [];
  const selectedIds = new Set();
  for (const record of [...preferredMethods, ...incidentsAndCounterexamples, ...automationCandidates, ...relevant]) {
    if (selected.length >= maxRecords || selectedIds.has(record.recordId)) continue;
    selected.push(record);
    selectedIds.add(record.recordId);
  }

  const candidate = {
    schemaVersion: ENGINEERING_CODING_MEMORY_PACK_SCHEMA_V1,
    problemClass,
    componentRefs,
    createdAtUtc,
    preferredMethodRecordIds: preferredMethods.map((record) => record.recordId),
    incidentAndCounterexampleRecordIds: incidentsAndCounterexamples.map((record) => record.recordId),
    automationCandidateRecordIds: automationCandidates.map((record) => record.recordId),
    records: selected,
    omittedSensitiveState: relevant.some((record) => record.privacyAndSensitivity === 'SENSITIVE_OMITTED'),
    selectionPolicy: 'CURRENT_METHODS_THEN_INCIDENTS_COUNTEREXAMPLES_AUTOMATION_AND_HISTORY',
    authority: ENGINEERING_INCIDENT_METHOD_AUTHORITY_V1,
  };
  const packId = `engineering-coding-memory-pack-${sha256(canonicalJson(candidate)).slice(0, 24)}`;
  const pack = deepFreeze({ ...candidate, packId });
  const observedBytes = Buffer.byteLength(canonicalJson(pack), 'utf8');
  if (observedBytes > maxBytes) throw new Error('engineering coding memory pack exceeds declared byte budget');
  return pack;
}
