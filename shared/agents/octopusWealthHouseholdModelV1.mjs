import { createHash } from 'node:crypto';

export const OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION = 'stephanos.octopus-wealth-household-model.v1';
export const OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION = 'stephanos.octopus-wealth-datum.v1';

export const OCTOPUS_WEALTH_TENTACLES = Object.freeze([
  'CASH_AND_LIQUIDITY',
  'ISA_AND_INVESTMENTS',
  'PENSIONS_AND_RETIREMENT_BRIDGE',
  'HOME_MORTGAGE_AND_EQUITY',
  'CARAVAN_PORTFOLIO',
  'EMPLOYMENT_SALARY_SACRIFICE_AND_TAX',
  'DEBT_AND_CREDIT',
  'EXTERNAL_ENVIRONMENT',
]);

export const OCTOPUS_WEALTH_EPISTEMIC_STATUS = Object.freeze([
  'ACTUAL',
  'ESTIMATED',
  'PROJECTED',
  'UNKNOWN',
]);

export const OCTOPUS_WEALTH_FRESHNESS = Object.freeze([
  'FRESH',
  'AGING',
  'STALE',
  'EXPIRED',
  'UNKNOWN',
]);

export const OCTOPUS_WEALTH_OWNERSHIP_BOUNDARIES = Object.freeze([
  'STEPHAN',
  'SPOUSE',
  'JOINT',
  'HOUSEHOLD',
  'EXTERNAL_REFERENCE',
  'UNKNOWN',
]);

export const OCTOPUS_WEALTH_SOURCE_TYPES = Object.freeze([
  'MANUAL',
  'DOCUMENT',
  'PROVIDER_READ_ONLY',
  'PUBLIC_PRIMARY',
  'MODEL_ASSUMPTION',
  'UNKNOWN',
]);

export const OCTOPUS_WEALTH_CONFIDENCE = Object.freeze([
  'HIGH',
  'MEDIUM',
  'LOW',
  'UNKNOWN',
]);

export const OCTOPUS_WEALTH_UNITS = Object.freeze([
  'GBP',
  'GBP_PER_MONTH',
  'GBP_PER_YEAR',
  'PERCENT',
  'COUNT',
  'YEARS',
  'DATE',
  'TEXT',
  'BOOLEAN',
  'UNKNOWN',
]);

const TOP_LEVEL_KEYS = Object.freeze(['schemaVersion', 'modelId', 'observedAtUtc', 'data']);
const SEED_OPTION_KEYS = Object.freeze(['modelId', 'observedAtUtc']);
const VALIDATION_OPTION_KEYS = Object.freeze(['observedAtUtc']);
const DATUM_KEYS = Object.freeze([
  'schemaVersion',
  'datumId',
  'tentacleId',
  'metricId',
  'value',
  'unit',
  'asOfUtc',
  'sourceType',
  'sourceName',
  'sourceRef',
  'confidence',
  'epistemicStatus',
  'freshness',
  'ownershipBoundary',
  'manualOverride',
  'notes',
]);

const LOWER_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SOURCE_REF = /^(?:manual|document|provider|public|dataset):\/\/[a-z0-9][a-z0-9._/-]{0,239}$/;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SENSITIVE_TEXT = /(?:^|[^a-z0-9])(?:api[-_ ]?key|client[-_ ]?secret|db[-_ ]?password|password|passwd|secret|bearer|authorization|credential|cookie|session[-_ ]?(?:id|token|key)|oauth[-_ ]?token|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|account[-_ ]?(?:number|no|identifier|id)|sort[-_ ]?code|iban|swift)(?:$|[^a-z0-9])/i;
const LONG_IDENTIFIER_DIGITS = /(?:^|[^0-9])(?:\d[ -]?){8,22}(?:$|[^0-9])/;
const SORT_CODE = /(?:^|[^0-9])\d{2}[- ]?\d{2}[- ]?\d{2}(?:$|[^0-9])/;
const IBAN = /(?:^|[^a-z0-9])[a-z]{2}\d{2}[a-z0-9]{11,30}(?:$|[^a-z0-9])/i;
const INVALID = Symbol('INVALID_DATA_ONLY_VALUE');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_DATA_RECORDS = 256;
const MAX_CANONICAL_ARRAY_LENGTH = 512;
const MAX_CANONICAL_DEPTH = 12;
const MAX_CANONICAL_NODES = 4096;
const MAX_CANONICAL_OBJECT_KEYS = 64;
const MAX_CANONICAL_STRING_LENGTH = 4096;
const MAX_ABSOLUTE_NUMERIC_VALUE = 1_000_000_000_000_000;

const AUTHORITY = Object.freeze({
  tradeAllowed: false,
  transferAllowed: false,
  borrowingAllowed: false,
  mortgageApplicationAllowed: false,
  pensionTransferAllowed: false,
  purchaseAllowed: false,
  credentialUseAllowed: false,
  sourceMutationAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  spendAllowed: false,
});

function canonicalDataOnly(value, state = null, depth = 0) {
  const traversal = state || { seen: new Set(), nodes: 0 };
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length <= MAX_CANONICAL_STRING_LENGTH ? value : INVALID;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID;
  if (!value || typeof value !== 'object' || depth > MAX_CANONICAL_DEPTH) return INVALID;

  traversal.nodes += 1;
  if (traversal.nodes > MAX_CANONICAL_NODES) return INVALID;

  let isArray;
  try {
    isArray = Array.isArray(value);
  } catch {
    return INVALID;
  }

  if (isArray) {
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
      if (traversal.seen.has(value)) return INVALID;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const descriptorKeys = Reflect.ownKeys(descriptors);
      if (descriptorKeys.some((key) => typeof key !== 'string')) return INVALID;
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (!lengthDescriptor
        || lengthDescriptor.get
        || lengthDescriptor.set
        || !Number.isSafeInteger(length)
        || length < 0
        || length > MAX_CANONICAL_ARRAY_LENGTH) return INVALID;
      const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
      if (descriptorKeys.some((key) => !expectedKeys.has(key))) return INVALID;

      traversal.seen.add(value);
      const output = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
          traversal.seen.delete(value);
          return INVALID;
        }
        const normalized = canonicalDataOnly(descriptor.value, traversal, depth + 1);
        if (normalized === INVALID) {
          traversal.seen.delete(value);
          return INVALID;
        }
        output.push(normalized);
      }
      traversal.seen.delete(value);
      return Object.freeze(output);
    } catch {
      return INVALID;
    }
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    if (traversal.seen.has(value)) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (descriptorKeys.some((key) => typeof key !== 'string')) return INVALID;
    if (descriptorKeys.length > MAX_CANONICAL_OBJECT_KEYS) return INVALID;

    traversal.seen.add(value);
    const output = Object.create(null);
    for (const key of descriptorKeys.sort(compareCodePoints)) {
      if (RESERVED_KEYS.has(key)) {
        traversal.seen.delete(value);
        return INVALID;
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        traversal.seen.delete(value);
        return INVALID;
      }
      const normalized = canonicalDataOnly(descriptor.value, traversal, depth + 1);
      if (normalized === INVALID) {
        traversal.seen.delete(value);
        return INVALID;
      }
      Object.defineProperty(output, key, {
        value: normalized,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    traversal.seen.delete(value);
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function exactKeys(record, expectedKeys) {
  return JSON.stringify(Object.keys(record).sort(compareCodePoints))
    === JSON.stringify([...expectedKeys].sort(compareCodePoints));
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function boundedText(value, maxLength, allowEmpty = false) {
  if (typeof value !== 'string') return false;
  if (value !== value.trim() || value.length > maxLength || CONTROL_CHARACTERS.test(value)) return false;
  return allowEmpty ? true : value.length > 0;
}

function containsSensitiveText(value) {
  if (typeof value === 'string') return SENSITIVE_TEXT.test(value);
  if (Array.isArray(value)) return value.some(containsSensitiveText);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => SENSITIVE_TEXT.test(key) || containsSensitiveText(entry));
}

function containsIdentifierLikeText(value) {
  return typeof value === 'string'
    && (LONG_IDENTIFIER_DIGITS.test(value) || SORT_CODE.test(value) || IBAN.test(value));
}

function validSourceRef(value) {
  if (typeof value !== 'string'
    || !SOURCE_REF.test(value)
    || value.includes('..')
    || value.includes('\\')
    || CONTROL_CHARACTERS.test(value)) return false;
  return !SENSITIVE_TEXT.test(value) && !containsIdentifierLikeText(value);
}

function validKnownValue(value, unit) {
  if (unit === 'BOOLEAN') return typeof value === 'boolean';
  if (unit === 'DATE') return canonicalTimestamp(value) !== null;
  if (unit === 'TEXT') {
    return boundedText(value, 240)
      && !SENSITIVE_TEXT.test(value)
      && !containsIdentifierLikeText(value);
  }
  if (!['GBP', 'GBP_PER_MONTH', 'GBP_PER_YEAR', 'PERCENT', 'COUNT', 'YEARS'].includes(unit)) return false;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_NUMERIC_VALUE) return false;
  if (unit === 'COUNT') return Number.isInteger(value) && value >= 0 && value <= 1_000_000_000;
  if (unit === 'YEARS') return value >= 0 && value <= 200;
  if (unit === 'PERCENT') return value >= -100 && value <= 100_000;
  return true;
}

function expectedKnownSourceType(status, sourceType) {
  if (status === 'ACTUAL') return ['MANUAL', 'DOCUMENT', 'PROVIDER_READ_ONLY', 'PUBLIC_PRIMARY'].includes(sourceType);
  if (status === 'ESTIMATED') return ['MANUAL', 'DOCUMENT', 'PROVIDER_READ_ONLY', 'PUBLIC_PRIMARY', 'MODEL_ASSUMPTION'].includes(sourceType);
  if (status === 'PROJECTED') return ['MANUAL', 'MODEL_ASSUMPTION'].includes(sourceType);
  return false;
}

function deriveEvidenceFreshness(asOfMs, observedAtMs) {
  const ageMs = observedAtMs - asOfMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs <= DAY_MS) return 'FRESH';
  if (ageMs <= 30 * DAY_MS) return 'AGING';
  if (ageMs <= 365 * DAY_MS) return 'STALE';
  return 'EXPIRED';
}

function deriveProjectionFreshness(observedAtMs, nowMs) {
  const ageMs = nowMs - observedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'UNKNOWN';
  if (ageMs <= HOUR_MS) return 'FRESH';
  if (ageMs <= DAY_MS) return 'AGING';
  if (ageMs <= 30 * DAY_MS) return 'STALE';
  return 'EXPIRED';
}

function datumIdentity(record) {
  return `${record.tentacleId}:${record.metricId}:${record.ownershipBoundary}`;
}

function ownershipResolvedForTentacle(record) {
  if (record.ownershipBoundary === 'UNKNOWN') return false;
  if (record.ownershipBoundary === 'EXTERNAL_REFERENCE') {
    return record.tentacleId === 'EXTERNAL_ENVIRONMENT';
  }
  return true;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function emptyTentacleSummary(tentacleId) {
  return Object.freeze({
    tentacleId,
    datumCount: 0,
    actualCount: 0,
    estimatedCount: 0,
    projectedCount: 0,
    unknownCount: 0,
    currentCount: 0,
    staleCount: 0,
    knownEvidenceAvailable: false,
    currentKnownEvidenceAvailable: false,
  });
}

function safeInvalidModelId(partial) {
  const candidate = typeof partial?.modelId === 'string' ? partial.modelId : '';
  return LOWER_ID.test(candidate)
    && !SENSITIVE_TEXT.test(candidate)
    && !containsIdentifierLikeText(candidate)
    ? candidate
    : '';
}

function safeInvalidObservedAt(partial, nowMs) {
  const candidate = typeof partial?.observedAtUtc === 'string' ? partial.observedAtUtc : '';
  const parsed = canonicalTimestamp(candidate);
  return parsed !== null && parsed <= nowMs ? candidate : '';
}

function invalidProjection(errors, partial = {}, nowMs = Date.now()) {
  return Object.freeze({
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_EVIDENCE_COVERAGE',
    projectionId: '',
    modelId: safeInvalidModelId(partial),
    observedAtUtc: safeInvalidObservedAt(partial, nowMs),
    evaluatedAtUtc: new Date(nowMs).toISOString(),
    freshnessValidUntilUtc: '',
    projectionFreshness: 'UNKNOWN',
    data: Object.freeze([]),
    tentacles: Object.freeze(OCTOPUS_WEALTH_TENTACLES.map(emptyTentacleSummary)),
    evidenceCoverage: Object.freeze({
      requiredTentacleCount: OCTOPUS_WEALTH_TENTACLES.length,
      representedTentacleCount: 0,
      knownTentacleCount: 0,
      currentKnownTentacleCount: 0,
      staleKnownTentacleCount: 0,
      unresolvedOwnershipDatumCount: 0,
      actualDatumCount: 0,
      estimatedDatumCount: 0,
      projectedDatumCount: 0,
      unknownDatumCount: 0,
    }),
    readiness: 'SAFE_HOLD',
    valid: false,
    validationErrors: Object.freeze([...new Set(errors)]),
    authority: AUTHORITY,
  });
}

function validateDatumSnapshot(record, { observedAtMs, nowMs }) {
  const errors = [];
  if (!exactKeys(record, DATUM_KEYS)) errors.push('datum-fields-mismatch');
  if (record.schemaVersion !== OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION) errors.push('datum-schema-version-mismatch');
  if (!LOWER_ID.test(record.datumId || '') || containsIdentifierLikeText(record.datumId)) errors.push('datumId-invalid');
  if (!OCTOPUS_WEALTH_TENTACLES.includes(record.tentacleId)) errors.push('tentacleId-invalid');
  if (!LOWER_ID.test(record.metricId || '') || containsIdentifierLikeText(record.metricId)) errors.push('metricId-invalid');
  if (!OCTOPUS_WEALTH_UNITS.includes(record.unit)) errors.push('unit-invalid');

  const asOfMs = canonicalTimestamp(record.asOfUtc);
  if (asOfMs === null) errors.push('asOfUtc-invalid');
  else {
    if (asOfMs > nowMs) errors.push('asOfUtc-future-dated');
    if (asOfMs > observedAtMs) errors.push('asOfUtc-after-observedAtUtc');
  }

  if (!OCTOPUS_WEALTH_SOURCE_TYPES.includes(record.sourceType)) errors.push('sourceType-invalid');
  if (!boundedText(record.sourceName, 120) || containsIdentifierLikeText(record.sourceName)) errors.push('sourceName-invalid');
  if (!validSourceRef(record.sourceRef)) errors.push('sourceRef-invalid');
  if (!OCTOPUS_WEALTH_CONFIDENCE.includes(record.confidence)) errors.push('confidence-invalid');
  if (!OCTOPUS_WEALTH_EPISTEMIC_STATUS.includes(record.epistemicStatus)) errors.push('epistemicStatus-invalid');
  if (!OCTOPUS_WEALTH_FRESHNESS.includes(record.freshness)) errors.push('freshness-invalid');
  if (!OCTOPUS_WEALTH_OWNERSHIP_BOUNDARIES.includes(record.ownershipBoundary)) errors.push('ownershipBoundary-invalid');
  if (typeof record.manualOverride !== 'boolean') errors.push('manualOverride-must-be-boolean');
  if (!boundedText(record.notes, 500, true)) errors.push('notes-invalid');

  if (record.epistemicStatus === 'UNKNOWN') {
    if (record.value !== null) errors.push('unknown-value-must-be-null');
    if (record.confidence !== 'UNKNOWN') errors.push('unknown-confidence-must-be-UNKNOWN');
    if (record.freshness !== 'UNKNOWN') errors.push('unknown-freshness-must-be-UNKNOWN');
  } else {
    if (record.unit === 'UNKNOWN' || !validKnownValue(record.value, record.unit)) errors.push('known-value-invalid');
    if (!expectedKnownSourceType(record.epistemicStatus, record.sourceType)) errors.push('known-sourceType-invalid');
    if (record.confidence === 'UNKNOWN') errors.push('known-confidence-required');
    const expectedFreshness = asOfMs === null ? null : deriveEvidenceFreshness(asOfMs, observedAtMs);
    if (expectedFreshness !== null && record.freshness !== expectedFreshness) {
      errors.push(`freshness-mismatch:${expectedFreshness}`);
    }
  }

  if (record.manualOverride === true && record.sourceType !== 'MANUAL') errors.push('manualOverride-sourceType-mismatch');
  if (containsSensitiveText(record) || containsIdentifierLikeText(record.notes)) errors.push('sensitive-content-rejected');

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    record: errors.length === 0 ? record : null,
  });
}

export function validateOctopusWealthDatumV1(input, options = {}) {
  const nowMs = Date.now();
  const record = canonicalDataOnly(input);
  const validationOptions = canonicalDataOnly(options);
  if (record === INVALID || !record || Array.isArray(record)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['record-must-be-data-only']), record: null });
  }
  if (validationOptions === INVALID || !validationOptions || Array.isArray(validationOptions)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['validation-options-must-be-data-only']), record: null });
  }
  if (!exactKeys(validationOptions, VALIDATION_OPTION_KEYS)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['validation-options-must-contain-observedAtUtc']), record: null });
  }
  const observedAtMs = canonicalTimestamp(validationOptions.observedAtUtc);
  if (observedAtMs === null || observedAtMs > nowMs) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([observedAtMs === null ? 'observedAtUtc-invalid' : 'observedAtUtc-future-dated']),
      record: null,
    });
  }
  return validateDatumSnapshot(record, { observedAtMs, nowMs });
}

export function buildOctopusWealthHouseholdModelV1(input = {}) {
  const nowMs = Date.now();
  const snapshot = canonicalDataOnly(input);
  if (snapshot === INVALID || !snapshot || Array.isArray(snapshot)) {
    return invalidProjection(['input-must-be-data-only'], {}, nowMs);
  }

  const errors = [];
  if (!exactKeys(snapshot, TOP_LEVEL_KEYS)) errors.push('model-fields-mismatch');
  if (snapshot.schemaVersion !== OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION) errors.push('model-schema-version-mismatch');
  if (!LOWER_ID.test(snapshot.modelId || '')
    || SENSITIVE_TEXT.test(snapshot.modelId || '')
    || containsIdentifierLikeText(snapshot.modelId)) errors.push('modelId-invalid');
  const observedAtMs = canonicalTimestamp(snapshot.observedAtUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');
  else if (observedAtMs > nowMs) errors.push('observedAtUtc-future-dated');
  if (!Array.isArray(snapshot.data)) errors.push('data-must-be-array');
  else if (snapshot.data.length > MAX_DATA_RECORDS) errors.push('data-record-limit-exceeded');
  if (containsSensitiveText(snapshot)) errors.push('sensitive-content-rejected');
  if (errors.length > 0) return invalidProjection(errors, snapshot, nowMs);

  const validRecords = [];
  const identities = new Map();
  const datumIds = new Set();
  snapshot.data.forEach((datum, index) => {
    const verdict = validateDatumSnapshot(datum, { observedAtMs, nowMs });
    if (!verdict.valid) {
      errors.push(...verdict.errors.map((error) => `data[${index}]:${error}`));
      return;
    }
    const record = verdict.record;
    const identity = datumIdentity(record);
    const prior = identities.get(identity);
    if (prior) {
      errors.push(JSON.stringify(prior) === JSON.stringify(record)
        ? `duplicate-datum-identity:${identity}`
        : `conflicting-datum-identity:${identity}`);
      return;
    }
    if (datumIds.has(record.datumId)) {
      errors.push(`duplicate-datumId:${record.datumId}`);
      return;
    }
    datumIds.add(record.datumId);
    identities.set(identity, record);
    validRecords.push(record);
  });

  if (errors.length > 0) return invalidProjection(errors, snapshot, nowMs);

  validRecords.sort((left, right) => {
    const identityOrder = compareCodePoints(datumIdentity(left), datumIdentity(right));
    return identityOrder !== 0 ? identityOrder : compareCodePoints(left.datumId, right.datumId);
  });

  const projectionFreshness = deriveProjectionFreshness(observedAtMs, nowMs);
  const projectionIsCurrent = projectionFreshness === 'FRESH';
  const summaries = OCTOPUS_WEALTH_TENTACLES.map((tentacleId) => {
    const records = validRecords.filter((record) => record.tentacleId === tentacleId);
    const count = (status) => records.filter((record) => record.epistemicStatus === status).length;
    const knownRecords = records.filter((record) => record.epistemicStatus !== 'UNKNOWN');
    const currentRecords = projectionIsCurrent
      ? knownRecords.filter((record) => ['FRESH', 'AGING'].includes(record.freshness))
      : [];
    const currentCount = currentRecords.length;
    const currentResolvedCount = currentRecords.filter(ownershipResolvedForTentacle).length;
    const staleCount = knownRecords.filter((record) => ['STALE', 'EXPIRED'].includes(record.freshness)).length;
    return Object.freeze({
      tentacleId,
      datumCount: records.length,
      actualCount: count('ACTUAL'),
      estimatedCount: count('ESTIMATED'),
      projectedCount: count('PROJECTED'),
      unknownCount: count('UNKNOWN'),
      currentCount,
      staleCount,
      knownEvidenceAvailable: knownRecords.length > 0,
      currentKnownEvidenceAvailable: currentResolvedCount > 0,
    });
  });

  const representedTentacleCount = summaries.filter((summary) => summary.datumCount > 0).length;
  const knownTentacleCount = summaries.filter((summary) => summary.knownEvidenceAvailable).length;
  const currentKnownTentacleCount = summaries.filter((summary) => summary.currentKnownEvidenceAvailable).length;
  const staleKnownTentacleCount = summaries.filter((summary) => summary.staleCount > 0).length;
  const unresolvedOwnershipDatumCount = validRecords.filter((record) => record.epistemicStatus !== 'UNKNOWN' && !ownershipResolvedForTentacle(record)).length;
  const countAll = (status) => validRecords.filter((record) => record.epistemicStatus === status).length;
  const unknownDatumCount = countAll('UNKNOWN');

  let readiness;
  if (representedTentacleCount < OCTOPUS_WEALTH_TENTACLES.length) readiness = 'M1_EVIDENCE_INCOMPLETE';
  else if (projectionFreshness !== 'FRESH') readiness = 'M1_EVIDENCE_REFRESH_REQUIRED';
  else if (knownTentacleCount === 0) readiness = 'M1_MANUAL_SEED_READY';
  else if (unknownDatumCount > 0 || unresolvedOwnershipDatumCount > 0) readiness = 'M1_MANUAL_RECONCILIATION_REQUIRED';
  else if (currentKnownTentacleCount < knownTentacleCount) readiness = 'M1_EVIDENCE_REFRESH_REQUIRED';
  else if (currentKnownTentacleCount === OCTOPUS_WEALTH_TENTACLES.length) readiness = 'M1_MANUAL_EVIDENCE_MODEL_READY';
  else readiness = 'M1_MANUAL_RECONCILIATION_REQUIRED';

  const identityCore = {
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    modelId: snapshot.modelId,
    observedAtUtc: snapshot.observedAtUtc,
    data: validRecords,
  };
  return Object.freeze({
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_EVIDENCE_COVERAGE',
    projectionId: `octopus-wealth-${hash(identityCore).slice(0, 24)}`,
    modelId: snapshot.modelId,
    observedAtUtc: snapshot.observedAtUtc,
    evaluatedAtUtc: new Date(nowMs).toISOString(),
    freshnessValidUntilUtc: new Date(observedAtMs + HOUR_MS).toISOString(),
    projectionFreshness,
    data: Object.freeze(validRecords),
    tentacles: Object.freeze(summaries),
    evidenceCoverage: Object.freeze({
      requiredTentacleCount: OCTOPUS_WEALTH_TENTACLES.length,
      representedTentacleCount,
      knownTentacleCount,
      currentKnownTentacleCount,
      staleKnownTentacleCount,
      unresolvedOwnershipDatumCount,
      actualDatumCount: countAll('ACTUAL'),
      estimatedDatumCount: countAll('ESTIMATED'),
      projectedDatumCount: countAll('PROJECTED'),
      unknownDatumCount,
    }),
    readiness,
    valid: true,
    validationErrors: Object.freeze([]),
    authority: AUTHORITY,
  });
}

const SEED_METRICS = Object.freeze([
  ['CASH_AND_LIQUIDITY', 'cash-liquid-assets', 'GBP'],
  ['ISA_AND_INVESTMENTS', 'isa-current-value', 'GBP'],
  ['PENSIONS_AND_RETIREMENT_BRIDGE', 'pension-current-value', 'GBP'],
  ['HOME_MORTGAGE_AND_EQUITY', 'home-mortgage-position', 'GBP'],
  ['CARAVAN_PORTFOLIO', 'caravan-net-income', 'GBP_PER_YEAR'],
  ['EMPLOYMENT_SALARY_SACRIFICE_AND_TAX', 'employment-free-cash-flow', 'GBP_PER_MONTH'],
  ['DEBT_AND_CREDIT', 'debt-weighted-cost', 'PERCENT'],
  ['EXTERNAL_ENVIRONMENT', 'external-base-rate', 'PERCENT'],
]);

export function createOctopusWealthManualSeedTemplateV1(input = {}) {
  const nowMs = Date.now();
  const options = canonicalDataOnly(input);
  if (options === INVALID || !options || Array.isArray(options)) {
    return invalidProjection(['seed-options-must-be-data-only'], {}, nowMs);
  }
  if (!exactKeys(options, SEED_OPTION_KEYS)) {
    return invalidProjection(['seed-option-fields-mismatch'], options, nowMs);
  }
  if (canonicalTimestamp(options.observedAtUtc) === null) {
    return invalidProjection(['seed-observedAtUtc-required'], options, nowMs);
  }
  const modelId = options.modelId || 'octopus-household-manual-seed';
  const observedAtUtc = options.observedAtUtc;
  const data = SEED_METRICS.map(([tentacleId, metricId, unit]) => Object.freeze({
    schemaVersion: OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION,
    datumId: `manual-${metricId}`,
    tentacleId,
    metricId,
    value: null,
    unit,
    asOfUtc: observedAtUtc,
    sourceType: 'MANUAL',
    sourceName: 'operator-manual-seed',
    sourceRef: `manual://octopus-template/${metricId}`,
    confidence: 'UNKNOWN',
    epistemicStatus: 'UNKNOWN',
    freshness: 'UNKNOWN',
    ownershipBoundary: 'HOUSEHOLD',
    manualOverride: false,
    notes: 'No value entered.',
  }));
  return buildOctopusWealthHouseholdModelV1({
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    modelId,
    observedAtUtc,
    data,
  });
}
