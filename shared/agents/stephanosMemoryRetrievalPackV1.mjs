import { createHash } from 'node:crypto';

import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_MEMORY_RETRIEVAL_PACK_SCHEMA_VERSION =
  'stephanos.memory-retrieval-pack.v1';

export const STEPHANOS_MEMORY_RETRIEVAL_PACK_KINDS = Object.freeze([
  'CONVERSATIONAL_CONTINUITY_PACK',
  'OPERATOR_RELATIONSHIP_PACK',
  'PROJECT_SELF_MODEL_PACK',
  'ACTIVE_MISSION_PACK',
  'PROCEDURAL_METHOD_PACK',
  'PROSPECTIVE_OPEN_LOOPS_PACK',
  'REFLECTIVE_LESSONS_PACK',
]);

export const STEPHANOS_MEMORY_RETRIEVAL_FRESHNESS = Object.freeze([
  'FRESH',
  'RECENT',
  'STALE',
  'CONFLICTING',
  'UNKNOWN',
]);

export const STEPHANOS_MEMORY_RETRIEVAL_CURRENT_STATES = Object.freeze([
  'CURRENT',
  'SUPERSEDED',
  'UNKNOWN',
]);

const PACK_KINDS = new Set(STEPHANOS_MEMORY_RETRIEVAL_PACK_KINDS);
const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const FRESHNESS_STATES = new Set(STEPHANOS_MEMORY_RETRIEVAL_FRESHNESS);
const CURRENT_STATES = new Set(STEPHANOS_MEMORY_RETRIEVAL_CURRENT_STATES);
const RELATIONSHIP_EVIDENCE_CLASSES = new Set([
  'EXPLICIT_OPERATOR',
  'OPERATOR_CORRECTION',
  'LOW_AUTHORITY_INTERACTION_INFERENCE',
  'NOT_RELATIONSHIP',
]);

const MAX_INPUT_RECORDS = 2_000;
const DEFAULT_MAX_RECORDS = 24;
const ABSOLUTE_MAX_RECORDS = 64;
const DEFAULT_MAX_BYTES = 32 * 1024;
const ABSOLUTE_MAX_BYTES = 64 * 1024;
const MAX_LIST_VALUES = 32;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const RECORD_KEYS = Object.freeze([
  'recordId',
  'namespace',
  'type',
  'source',
  'summary',
  'tags',
  'relationshipRefs',
  'observedAtUtc',
  'updatedAtUtc',
  'authorityClass',
  'freshness',
  'currentState',
  'proofRefs',
  'sourceRefs',
  'relatedGoalRef',
  'relatedPrRef',
  'component',
  'personOrParticipant',
  'relationshipEvidenceClass',
]);

const SELECTOR_KEYS = Object.freeze([
  'namespace',
  'type',
  'tag',
  'goalRef',
  'prRef',
  'component',
  'personOrParticipant',
  'source',
  'fromUtc',
  'toUtc',
  'includeHistorical',
]);

const BUDGET_KEYS = Object.freeze(['maxRecords', 'maxBytes']);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_TEXT = /^[\u0020-\u007e\n\r\t]+$/;
const SAFE_GOAL_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_PR_REF = /^#[1-9][0-9]{0,9}$/;
const SAFE_REF = /^(?:(?:issue|pr|receipt|evidence|workspace|memory|operator|runtime|project|github|shared-workspace):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}|(?:proof|proofs|receipt|receipts|evidence|github|shared-workspace|runtime|memory)\/[a-z0-9._/#:-]{1,220})$/i;
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session[-_ ]?cookie|sort[-_ ]?code|iban|swift|raw prompt|raw response|psychological profile|mental diagnosis)\b/i;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|\/[A-Za-z0-9._-]+(?:[\\/][^\s]*)?)/;
const PSYCHOLOGICAL_INFERENCE = /\b(?:mood|depressed|anxious|diagnos(?:e|is)|mental state|personality disorder|hidden motivation|secretly wants|intimate|trauma|psychological profile)\b/i;

const AUTHORITY_RANK = new Map([
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY, 0],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.PENDING_LOCAL_INTENT, 1],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.LOCAL_MIRROR, 2],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.STALE_EVIDENCE, 3],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED, 4],
  [STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN, 5],
]);
const FRESHNESS_RANK = new Map([
  ['FRESH', 0],
  ['RECENT', 1],
  ['CONFLICTING', 2],
  ['STALE', 3],
  ['UNKNOWN', 4],
]);
const CURRENT_RANK = new Map([
  ['CURRENT', 0],
  ['UNKNOWN', 1],
  ['SUPERSEDED', 2],
]);

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  memoryDeleteAllowed: false,
  memoryCorrectionAllowed: false,
  sharedAuthorityClaimAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactIso(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString() === value ? milliseconds : null;
  } catch {
    return null;
  }
}

function safePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
}

function ownData(descriptors, key) {
  const descriptor = descriptors?.[key];
  if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return undefined;
  return descriptor.value;
}

function safeString(value, maximum = 500) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && SAFE_TEXT.test(value)
    && !SENSITIVE_TEXT.test(value)
    && !LOCAL_PATH.test(value);
}

function safeRef(value) {
  return typeof value === 'string'
    && value.length <= 240
    && SAFE_REF.test(value)
    && !value.includes('..')
    && !SENSITIVE_TEXT.test(value)
    && !LOCAL_PATH.test(value);
}

function denseStringList(value, maximum = MAX_LIST_VALUES) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== 'string') return null;
    const item = value[index].trim();
    if (!safeString(item, 240)) return null;
    output.push(item);
  }
  return [...new Set(output)];
}

function normalizeRecord(value, index, errors, omissions, asOfMs) {
  const descriptors = safePlainObject(value);
  const prefix = `record-${index + 1}`;
  if (!descriptors) {
    errors.push(`${prefix}:data-only-object-required`);
    return null;
  }

  const unknownKeys = Object.keys(descriptors).filter((key) => !RECORD_KEYS.includes(key));
  if (unknownKeys.length) omissions.push(`${prefix}:unsupported-fields-omitted`);
  if (Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set)) {
    omissions.push(`${prefix}:accessor-fields-omitted`);
  }

  const recordId = ownData(descriptors, 'recordId');
  const namespace = ownData(descriptors, 'namespace');
  const type = ownData(descriptors, 'type');
  const source = ownData(descriptors, 'source');
  const summary = ownData(descriptors, 'summary');
  if (!SAFE_ID.test(recordId || '')) errors.push(`${prefix}:recordId-invalid`);
  for (const [field, candidate] of [['namespace', namespace], ['type', type]]) {
    if (!SAFE_ID.test(candidate || '')) errors.push(`${prefix}:${field}-invalid`);
  }
  if (!safeString(source, 180)) errors.push(`${prefix}:source-invalid`);
  if (!safeString(summary, 800)) errors.push(`${prefix}:summary-sensitive-or-invalid`);

  const observedAtUtc = ownData(descriptors, 'observedAtUtc');
  const updatedAtUtc = ownData(descriptors, 'updatedAtUtc');
  const observedAtMs = exactIso(observedAtUtc);
  const updatedAtMs = exactIso(updatedAtUtc);
  if (observedAtMs === null) errors.push(`${prefix}:observedAtUtc-invalid`);
  if (updatedAtMs === null) errors.push(`${prefix}:updatedAtUtc-invalid`);
  if (observedAtMs !== null && observedAtMs > asOfMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    errors.push(`${prefix}:observedAtUtc-in-future`);
  }
  if (updatedAtMs !== null && updatedAtMs > asOfMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    errors.push(`${prefix}:updatedAtUtc-in-future`);
  }
  if (observedAtMs !== null && updatedAtMs !== null && updatedAtMs < observedAtMs) {
    errors.push(`${prefix}:updated-before-observed`);
  }

  const tags = denseStringList(ownData(descriptors, 'tags') ?? []);
  const relationshipRefs = denseStringList(ownData(descriptors, 'relationshipRefs') ?? []);
  const proofRefs = denseStringList(ownData(descriptors, 'proofRefs') ?? []);
  const sourceRefs = denseStringList(ownData(descriptors, 'sourceRefs') ?? []);
  if (!tags) errors.push(`${prefix}:tags-invalid`);
  if (!relationshipRefs) errors.push(`${prefix}:relationshipRefs-invalid`);
  if (!proofRefs || proofRefs.some((item) => !safeRef(item))) errors.push(`${prefix}:unsafe-proof-ref`);
  if (!sourceRefs || sourceRefs.some((item) => !safeRef(item))) errors.push(`${prefix}:unsafe-source-ref`);

  const claimedAuthority = String(ownData(descriptors, 'authorityClass') || '').trim().toUpperCase();
  const authorityClass = AUTHORITY_CLASSES.has(claimedAuthority)
    ? claimedAuthority
    : STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
  if (!claimedAuthority || !AUTHORITY_CLASSES.has(claimedAuthority)) omissions.push(`${prefix}:authority-normalized-unknown`);

  const claimedFreshness = String(ownData(descriptors, 'freshness') || '').trim().toUpperCase();
  const freshness = FRESHNESS_STATES.has(claimedFreshness) ? claimedFreshness : 'UNKNOWN';
  if (!claimedFreshness || !FRESHNESS_STATES.has(claimedFreshness)) omissions.push(`${prefix}:freshness-normalized-unknown`);

  const claimedCurrentState = String(ownData(descriptors, 'currentState') || '').trim().toUpperCase();
  const currentState = CURRENT_STATES.has(claimedCurrentState) ? claimedCurrentState : 'UNKNOWN';
  if (!claimedCurrentState || !CURRENT_STATES.has(claimedCurrentState)) omissions.push(`${prefix}:current-state-normalized-unknown`);

  const relatedGoalRef = ownData(descriptors, 'relatedGoalRef') ?? '';
  const relatedPrRef = ownData(descriptors, 'relatedPrRef') ?? '';
  if (relatedGoalRef && !SAFE_GOAL_REF.test(relatedGoalRef)) errors.push(`${prefix}:relatedGoalRef-invalid`);
  if (relatedPrRef && !SAFE_PR_REF.test(relatedPrRef)) errors.push(`${prefix}:relatedPrRef-invalid`);

  const component = ownData(descriptors, 'component') ?? '';
  const personOrParticipant = ownData(descriptors, 'personOrParticipant') ?? '';
  if (component && !SAFE_ID.test(component)) errors.push(`${prefix}:component-invalid`);
  if (personOrParticipant && !SAFE_ID.test(personOrParticipant)) errors.push(`${prefix}:personOrParticipant-invalid`);

  const relationshipEvidenceClass = String(
    ownData(descriptors, 'relationshipEvidenceClass') || 'NOT_RELATIONSHIP',
  ).trim().toUpperCase();
  if (!RELATIONSHIP_EVIDENCE_CLASSES.has(relationshipEvidenceClass)) {
    errors.push(`${prefix}:relationshipEvidenceClass-invalid`);
  }
  if (relationshipEvidenceClass === 'LOW_AUTHORITY_INTERACTION_INFERENCE'
      && authorityClass !== STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED) {
    errors.push(`${prefix}:relationship-inference-authority-incompatible`);
  }

  if (errors.some((error) => error.startsWith(`${prefix}:`))) return null;

  return Object.freeze({
    recordId,
    namespace,
    type,
    source,
    summary,
    tags: Object.freeze(tags),
    relationshipRefs: Object.freeze(relationshipRefs),
    observedAtUtc,
    updatedAtUtc,
    updatedAtMs,
    authorityClass,
    freshness,
    currentState,
    proofRefs: Object.freeze(proofRefs),
    sourceRefs: Object.freeze(sourceRefs),
    relatedGoalRef,
    relatedPrRef,
    component,
    personOrParticipant,
    relationshipEvidenceClass,
  });
}

function normalizeSelectors(value, errors) {
  if (value === undefined || value === null) return Object.freeze({
    namespace: '', type: '', tag: '', goalRef: '', prRef: '', component: '', personOrParticipant: '',
    source: '', fromUtc: '', toUtc: '', includeHistorical: false,
  });
  const descriptors = safePlainObject(value);
  if (!descriptors) {
    errors.push('selectors:data-only-object-required');
    return null;
  }
  const actual = Object.keys(descriptors);
  for (const key of actual) if (!SELECTOR_KEYS.includes(key)) errors.push(`selectors:unknown-field:${key}`);
  const output = Object.create(null);
  for (const key of SELECTOR_KEYS) {
    const candidate = ownData(descriptors, key);
    if (key === 'includeHistorical') {
      output[key] = candidate === true;
    } else {
      output[key] = candidate === undefined || candidate === null ? '' : String(candidate).trim();
    }
  }
  if (output.goalRef && !SAFE_GOAL_REF.test(output.goalRef)) errors.push('selectors:goalRef-invalid');
  if (output.prRef && !SAFE_PR_REF.test(output.prRef)) errors.push('selectors:prRef-invalid');
  if (output.fromUtc && exactIso(output.fromUtc) === null) errors.push('selectors:fromUtc-invalid');
  if (output.toUtc && exactIso(output.toUtc) === null) errors.push('selectors:toUtc-invalid');
  if (output.fromUtc && output.toUtc && Date.parse(output.fromUtc) > Date.parse(output.toUtc)) {
    errors.push('selectors:time-range-invalid');
  }
  return Object.freeze(output);
}

function normalizeBudget(value, errors) {
  if (value === undefined || value === null) {
    return Object.freeze({ maxRecords: DEFAULT_MAX_RECORDS, maxBytes: DEFAULT_MAX_BYTES });
  }
  const descriptors = safePlainObject(value);
  if (!descriptors) {
    errors.push('budget:data-only-object-required');
    return null;
  }
  for (const key of Object.keys(descriptors)) if (!BUDGET_KEYS.includes(key)) errors.push(`budget:unknown-field:${key}`);
  const maxRecords = ownData(descriptors, 'maxRecords') ?? DEFAULT_MAX_RECORDS;
  const maxBytes = ownData(descriptors, 'maxBytes') ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > ABSOLUTE_MAX_RECORDS) {
    errors.push('budget:maxRecords-invalid');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > ABSOLUTE_MAX_BYTES) {
    errors.push('budget:maxBytes-invalid');
  }
  return Object.freeze({ maxRecords, maxBytes });
}

function selectionReasons(record, selectors) {
  const reasons = [];
  if (selectors.namespace) reasons.push('namespace-match');
  if (selectors.type) reasons.push('type-match');
  if (selectors.tag) reasons.push('tag-match');
  if (selectors.goalRef) reasons.push('goal-match');
  if (selectors.prRef) reasons.push('pr-match');
  if (selectors.component) reasons.push('component-match');
  if (selectors.personOrParticipant) reasons.push('person-or-participant-match');
  if (selectors.source) reasons.push('source-match');
  if (selectors.fromUtc || selectors.toUtc) reasons.push('time-range-match');
  if (!reasons.length) reasons.push('eligible-record');
  if (record.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY) reasons.push('shared-authority-preferred');
  if (record.freshness === 'FRESH') reasons.push('fresh-evidence-preferred');
  if (record.currentState === 'CURRENT') reasons.push('current-state-preferred');
  return Object.freeze(reasons);
}

function matches(record, selectors) {
  if (!selectors.includeHistorical && record.currentState === 'SUPERSEDED') return false;
  if (selectors.namespace && record.namespace !== selectors.namespace) return false;
  if (selectors.type && record.type !== selectors.type) return false;
  if (selectors.tag && !record.tags.includes(selectors.tag)) return false;
  if (selectors.goalRef && record.relatedGoalRef !== selectors.goalRef) return false;
  if (selectors.prRef && record.relatedPrRef !== selectors.prRef) return false;
  if (selectors.component && record.component !== selectors.component) return false;
  if (selectors.personOrParticipant && record.personOrParticipant !== selectors.personOrParticipant) return false;
  if (selectors.source && record.source !== selectors.source) return false;
  const updatedAtMs = record.updatedAtMs;
  if (selectors.fromUtc && updatedAtMs < Date.parse(selectors.fromUtc)) return false;
  if (selectors.toUtc && updatedAtMs > Date.parse(selectors.toUtc)) return false;
  return true;
}

function containsPsychologicalInference(record) {
  const projectedText = [
    record.recordId,
    record.namespace,
    record.type,
    record.source,
    record.summary,
    ...record.tags,
    ...record.relationshipRefs,
    record.observedAtUtc,
    record.updatedAtUtc,
    record.authorityClass,
    record.freshness,
    record.currentState,
    ...record.proofRefs,
    ...record.sourceRefs,
    record.relatedGoalRef,
    record.relatedPrRef,
    record.component,
    record.personOrParticipant,
    record.relationshipEvidenceClass,
  ];
  return projectedText.some((value) => typeof value === 'string' && PSYCHOLOGICAL_INFERENCE.test(value));
}

function relationshipAllowed(record) {
  if (!['EXPLICIT_OPERATOR', 'OPERATOR_CORRECTION', 'LOW_AUTHORITY_INTERACTION_INFERENCE'].includes(record.relationshipEvidenceClass)) {
    return false;
  }
  if (record.relationshipEvidenceClass === 'LOW_AUTHORITY_INTERACTION_INFERENCE'
      && containsPsychologicalInference(record)) {
    return false;
  }
  return true;
}

function rankRecords(left, right) {
  return (AUTHORITY_RANK.get(left.authorityClass) - AUTHORITY_RANK.get(right.authorityClass))
    || (FRESHNESS_RANK.get(left.freshness) - FRESHNESS_RANK.get(right.freshness))
    || (CURRENT_RANK.get(left.currentState) - CURRENT_RANK.get(right.currentState))
    || (right.updatedAtMs - left.updatedAtMs)
    || compareText(left.recordId, right.recordId);
}

function selectedProjection(record, reasons) {
  return Object.freeze({
    recordId: record.recordId,
    namespace: record.namespace,
    type: record.type,
    source: record.source,
    summary: record.summary,
    tags: record.tags,
    relationshipRefs: record.relationshipRefs,
    observedAtUtc: record.observedAtUtc,
    updatedAtUtc: record.updatedAtUtc,
    authorityClass: record.authorityClass,
    freshness: record.freshness,
    currentState: record.currentState,
    proofRefs: record.proofRefs,
    sourceRefs: record.sourceRefs,
    relatedGoalRef: record.relatedGoalRef,
    relatedPrRef: record.relatedPrRef,
    component: record.component,
    personOrParticipant: record.personOrParticipant,
    relationshipEvidenceClass: record.relationshipEvidenceClass,
    selectionReasons: reasons,
  });
}

function contradictionLedger(records) {
  const conflicting = new Set(records.filter((record) => record.freshness === 'CONFLICTING').map((record) => record.recordId));
  const groups = new Map();
  for (const record of records.filter((item) => item.currentState === 'CURRENT')) {
    const key = record.recordId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (new Set(group.map((record) => record.summary)).size > 1) {
      for (const record of group) conflicting.add(record.recordId);
    }
  }
  return Object.freeze([...conflicting].sort(compareText));
}

function emptyResult(packKind, errors, omissions = []) {
  return Object.freeze({
    schemaVersion: STEPHANOS_MEMORY_RETRIEVAL_PACK_SCHEMA_VERSION,
    packKind: PACK_KINDS.has(packKind) ? packKind : '',
    packId: '',
    verdict: 'SAFE_HOLD',
    selectedRecords: Object.freeze([]),
    selectedRecordIds: Object.freeze([]),
    unresolvedContradictions: Object.freeze([]),
    sensitiveDataOmitted: omissions.length > 0,
    omissionReasons: Object.freeze([...new Set(omissions)]),
    budget: Object.freeze({ maxRecords: 0, maxBytes: 0, actualRecords: 0, actualBytes: 0, truncated: false }),
    authority: AUTHORITY,
    valid: false,
    validationErrors: Object.freeze([...new Set(errors)]),
  });
}

export function buildStephanosMemoryRetrievalPackV1(input = {}) {
  const top = safePlainObject(input);
  if (!top) return emptyResult('', ['input:data-only-object-required']);

  const errors = [];
  const omissions = [];
  const packKind = String(ownData(top, 'packKind') || '').trim().toUpperCase();
  if (!PACK_KINDS.has(packKind)) errors.push('packKind-unsupported');

  const recordsInput = ownData(top, 'records');
  if (!Array.isArray(recordsInput) || Object.getPrototypeOf(recordsInput) !== Array.prototype) {
    errors.push('records-must-be-dense-array');
  } else if (recordsInput.length > MAX_INPUT_RECORDS) {
    errors.push('records-exceed-input-bound');
  }

  const explicitAsOfUtc = ownData(top, 'asOfUtc');
  const asOfMs = explicitAsOfUtc === undefined || explicitAsOfUtc === null
    ? Date.now()
    : exactIso(explicitAsOfUtc);
  if (asOfMs === null) errors.push('asOfUtc-invalid');

  const selectors = normalizeSelectors(ownData(top, 'selectors'), errors);
  const budget = normalizeBudget(ownData(top, 'budget'), errors);
  if (errors.length) return emptyResult(packKind, errors, omissions);

  const normalized = [];
  for (let index = 0; index < recordsInput.length; index += 1) {
    if (!Object.hasOwn(recordsInput, index)) {
      errors.push(`record-${index + 1}:sparse-array-entry`);
      continue;
    }
    const record = normalizeRecord(recordsInput[index], index, errors, omissions, asOfMs);
    if (record) normalized.push(record);
  }
  if (errors.length) return emptyResult(packKind, errors, omissions);

  let eligible = normalized.filter((record) => matches(record, selectors));
  if (packKind === 'OPERATOR_RELATIONSHIP_PACK') {
    const rejected = eligible.filter((record) => !relationshipAllowed(record));
    if (rejected.length) omissions.push('operator-relationship-unsupported-inference-omitted');
    eligible = eligible.filter(relationshipAllowed);
  }
  eligible.sort(rankRecords);

  const unresolvedContradictions = contradictionLedger(eligible);
  const selectedRecords = [];
  let truncated = false;
  for (const record of eligible) {
    if (selectedRecords.length >= budget.maxRecords) {
      truncated = true;
      break;
    }
    const projection = selectedProjection(record, selectionReasons(record, selectors));
    const prospectiveRecords = [...selectedRecords, projection];
    const prospectiveBytes = Buffer.byteLength(JSON.stringify(prospectiveRecords), 'utf8');
    if (prospectiveBytes > budget.maxBytes) {
      truncated = true;
      continue;
    }
    selectedRecords.push(projection);
  }
  const actualBytes = Buffer.byteLength(JSON.stringify(selectedRecords), 'utf8');
  const selectedRecordIds = selectedRecords.map((record) => record.recordId);
  const omissionReasons = [...new Set(omissions)];
  const verdict = unresolvedContradictions.length ? 'CONFLICTING_EVIDENCE' : (truncated ? 'BOUNDED_PARTIAL' : 'READY');
  const resultBudget = {
    maxRecords: budget.maxRecords,
    maxBytes: budget.maxBytes,
    actualRecords: selectedRecords.length,
    actualBytes,
    truncated,
  };

  const canonicalPayload = {
    schemaVersion: STEPHANOS_MEMORY_RETRIEVAL_PACK_SCHEMA_VERSION,
    packKind,
    selectors,
    selectedRecords,
    selectedRecordIds,
    unresolvedContradictions,
    sensitiveDataOmitted: omissionReasons.length > 0,
    omissionReasons,
    budget: resultBudget,
    verdict,
  };
  const packId = `memory-pack-${createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex').slice(0, 24)}`;

  return Object.freeze({
    schemaVersion: STEPHANOS_MEMORY_RETRIEVAL_PACK_SCHEMA_VERSION,
    packKind,
    packId,
    verdict,
    selectedRecords: Object.freeze(selectedRecords),
    selectedRecordIds: Object.freeze(selectedRecordIds),
    unresolvedContradictions,
    sensitiveDataOmitted: omissionReasons.length > 0,
    omissionReasons: Object.freeze(omissionReasons),
    budget: Object.freeze(resultBudget),
    authority: AUTHORITY,
    valid: true,
    validationErrors: Object.freeze([]),
  });
}
