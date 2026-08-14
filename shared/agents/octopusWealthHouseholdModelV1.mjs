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
const SOURCE_REF = /^(?:manual|document|provider|public|dataset):\/\/[a-z0-9][a-z0-9._:/-]{0,239}$/;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|account[-_ ]?(?:number|no)|sort[-_ ]?code|iban|swift)\b/i;
const INVALID = Symbol('INVALID_DATA_ONLY_VALUE');

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

function canonicalDataOnly(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID;
  if (Array.isArray(value)) {
    if (seen.has(value)) return INVALID;
    seen.add(value);
    const output = [];
    for (const item of value) {
      const normalized = canonicalDataOnly(item, seen);
      if (normalized === INVALID) {
        seen.delete(value);
        return INVALID;
      }
      output.push(normalized);
    }
    seen.delete(value);
    return Object.freeze(output);
  }
  if (!value || typeof value !== 'object') return INVALID;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    if (Object.getOwnPropertySymbols(value).length > 0 || seen.has(value)) return INVALID;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      if (RESERVED_KEYS.has(key)) {
        seen.delete(value);
        return INVALID;
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        seen.delete(value);
        return INVALID;
      }
      const normalized = canonicalDataOnly(descriptor.value, seen);
      if (normalized === INVALID) {
        seen.delete(value);
        return INVALID;
      }
      Object.defineProperty(output, key, {
        value: normalized,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    seen.delete(value);
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function exactKeys(record, expectedKeys) {
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...expectedKeys].sort());
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function boundedText(value, maxLength, allowEmpty = false) {
  if (typeof value !== 'string') return false;
  if (value !== value.trim() || value.length > maxLength) return false;
  return allowEmpty ? true : value.length > 0;
}

function containsSensitiveText(value) {
  if (typeof value === 'string') return SENSITIVE_TEXT.test(value);
  if (Array.isArray(value)) return value.some(containsSensitiveText);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => SENSITIVE_TEXT.test(key) || containsSensitiveText(entry));
}

function validKnownValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && value === value.trim()
    && !SENSITIVE_TEXT.test(value);
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
  });
}

function invalidProjection(errors, partial = {}) {
  return Object.freeze({
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_EVIDENCE_COVERAGE',
    projectionId: '',
    modelId: partial.modelId || '',
    observedAtUtc: partial.observedAtUtc || '',
    data: Object.freeze([]),
    tentacles: Object.freeze(OCTOPUS_WEALTH_TENTACLES.map(emptyTentacleSummary)),
    evidenceCoverage: Object.freeze({
      requiredTentacleCount: OCTOPUS_WEALTH_TENTACLES.length,
      representedTentacleCount: 0,
      knownTentacleCount: 0,
      actualDatumCount: 0,
      estimatedDatumCount: 0,
      projectedDatumCount: 0,
      unknownDatumCount: 0,
    }),
    readiness: 'SAFE_HOLD',
    valid: false,
    validationErrors: Object.freeze([...errors]),
    authority: AUTHORITY,
  });
}

export function validateOctopusWealthDatumV1(input) {
  const record = canonicalDataOnly(input);
  if (record === INVALID || !record || Array.isArray(record)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['record-must-be-data-only']), record: null });
  }
  const errors = [];
  if (!exactKeys(record, DATUM_KEYS)) errors.push('datum-fields-mismatch');
  if (record.schemaVersion !== OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION) errors.push('datum-schema-version-mismatch');
  if (!LOWER_ID.test(record.datumId || '')) errors.push('datumId-invalid');
  if (!OCTOPUS_WEALTH_TENTACLES.includes(record.tentacleId)) errors.push('tentacleId-invalid');
  if (!LOWER_ID.test(record.metricId || '')) errors.push('metricId-invalid');
  if (!OCTOPUS_WEALTH_UNITS.includes(record.unit)) errors.push('unit-invalid');
  const asOfMs = canonicalTimestamp(record.asOfUtc);
  if (asOfMs === null) errors.push('asOfUtc-invalid');
  else if (asOfMs > Date.now()) errors.push('asOfUtc-future-dated');
  if (!OCTOPUS_WEALTH_SOURCE_TYPES.includes(record.sourceType)) errors.push('sourceType-invalid');
  if (!boundedText(record.sourceName, 120)) errors.push('sourceName-invalid');
  if (typeof record.sourceRef !== 'string' || !SOURCE_REF.test(record.sourceRef) || record.sourceRef.includes('..')) errors.push('sourceRef-invalid');
  if (!OCTOPUS_WEALTH_CONFIDENCE.includes(record.confidence)) errors.push('confidence-invalid');
  if (!OCTOPUS_WEALTH_EPISTEMIC_STATUS.includes(record.epistemicStatus)) errors.push('epistemicStatus-invalid');
  if (!OCTOPUS_WEALTH_FRESHNESS.includes(record.freshness)) errors.push('freshness-invalid');
  if (!OCTOPUS_WEALTH_OWNERSHIP_BOUNDARIES.includes(record.ownershipBoundary)) errors.push('ownershipBoundary-invalid');
  if (typeof record.manualOverride !== 'boolean') errors.push('manualOverride-must-be-boolean');
  if (!boundedText(record.notes, 500, true)) errors.push('notes-invalid');
  if (record.epistemicStatus === 'UNKNOWN') {
    if (record.value !== null) errors.push('unknown-value-must-be-null');
  } else if (!validKnownValue(record.value)) {
    errors.push('known-value-invalid');
  }
  if (record.epistemicStatus === 'PROJECTED' && record.sourceType !== 'MODEL_ASSUMPTION' && record.sourceType !== 'MANUAL') {
    errors.push('projected-sourceType-invalid');
  }
  if (containsSensitiveText(record)) errors.push('sensitive-content-rejected');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    record: errors.length === 0 ? record : null,
  });
}

export function buildOctopusWealthHouseholdModelV1(input = {}) {
  const snapshot = canonicalDataOnly(input);
  if (snapshot === INVALID || !snapshot || Array.isArray(snapshot)) {
    return invalidProjection(['input-must-be-data-only']);
  }
  const errors = [];
  if (!exactKeys(snapshot, TOP_LEVEL_KEYS)) errors.push('model-fields-mismatch');
  if (snapshot.schemaVersion !== OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION) errors.push('model-schema-version-mismatch');
  if (!LOWER_ID.test(snapshot.modelId || '')) errors.push('modelId-invalid');
  const observedAtMs = canonicalTimestamp(snapshot.observedAtUtc);
  if (observedAtMs === null) errors.push('observedAtUtc-invalid');
  else if (observedAtMs > Date.now()) errors.push('observedAtUtc-future-dated');
  if (!Array.isArray(snapshot.data)) errors.push('data-must-be-array');
  if (containsSensitiveText(snapshot)) errors.push('sensitive-content-rejected');

  const validRecords = [];
  const identities = new Map();
  if (Array.isArray(snapshot.data)) {
    snapshot.data.forEach((datum, index) => {
      const verdict = validateOctopusWealthDatumV1(datum);
      if (!verdict.valid) {
        errors.push(...verdict.errors.map((error) => `data[${index}]:${error}`));
        return;
      }
      const record = verdict.record;
      const identity = `${record.tentacleId}:${record.metricId}:${record.ownershipBoundary}`;
      const prior = identities.get(identity);
      if (prior) {
        errors.push(JSON.stringify(prior) === JSON.stringify(record)
          ? `duplicate-datum-identity:${identity}`
          : `conflicting-datum-identity:${identity}`);
        return;
      }
      identities.set(identity, record);
      validRecords.push(record);
    });
  }

  const summaries = OCTOPUS_WEALTH_TENTACLES.map((tentacleId) => {
    const records = validRecords.filter((record) => record.tentacleId === tentacleId);
    const count = (status) => records.filter((record) => record.epistemicStatus === status).length;
    const currentCount = records.filter((record) => ['FRESH', 'AGING'].includes(record.freshness)).length;
    const staleCount = records.filter((record) => ['STALE', 'EXPIRED'].includes(record.freshness)).length;
    return Object.freeze({
      tentacleId,
      datumCount: records.length,
      actualCount: count('ACTUAL'),
      estimatedCount: count('ESTIMATED'),
      projectedCount: count('PROJECTED'),
      unknownCount: count('UNKNOWN'),
      currentCount,
      staleCount,
      knownEvidenceAvailable: records.some((record) => record.epistemicStatus !== 'UNKNOWN'),
    });
  });
  const representedTentacleCount = summaries.filter((summary) => summary.datumCount > 0).length;
  const knownTentacleCount = summaries.filter((summary) => summary.knownEvidenceAvailable).length;
  const countAll = (status) => validRecords.filter((record) => record.epistemicStatus === status).length;
  const readiness = errors.length > 0
    ? 'SAFE_HOLD'
    : representedTentacleCount < OCTOPUS_WEALTH_TENTACLES.length
      ? 'M1_EVIDENCE_INCOMPLETE'
      : knownTentacleCount === 0
        ? 'M1_MANUAL_SEED_READY'
        : knownTentacleCount === OCTOPUS_WEALTH_TENTACLES.length
          ? 'M1_MANUAL_EVIDENCE_MODEL_READY'
          : 'M1_MANUAL_RECONCILIATION_REQUIRED';
  const projectionCore = {
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_EVIDENCE_COVERAGE',
    modelId: snapshot.modelId || '',
    observedAtUtc: snapshot.observedAtUtc || '',
    data: Object.freeze(validRecords),
    tentacles: Object.freeze(summaries),
    evidenceCoverage: Object.freeze({
      requiredTentacleCount: OCTOPUS_WEALTH_TENTACLES.length,
      representedTentacleCount,
      knownTentacleCount,
      actualDatumCount: countAll('ACTUAL'),
      estimatedDatumCount: countAll('ESTIMATED'),
      projectedDatumCount: countAll('PROJECTED'),
      unknownDatumCount: countAll('UNKNOWN'),
    }),
    readiness,
    valid: errors.length === 0,
    validationErrors: Object.freeze(errors),
    authority: AUTHORITY,
  };
  return Object.freeze({
    ...projectionCore,
    projectionId: `octopus-wealth-${hash(projectionCore).slice(0, 24)}`,
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
  const observedAtUtc = typeof input.observedAtUtc === 'string' ? input.observedAtUtc : new Date().toISOString();
  const modelId = typeof input.modelId === 'string' ? input.modelId : 'octopus-household-manual-seed';
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
