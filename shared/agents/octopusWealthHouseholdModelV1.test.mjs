import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION,
  OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
  OCTOPUS_WEALTH_TENTACLES,
  buildOctopusWealthHouseholdModelV1,
  createOctopusWealthManualSeedTemplateV1,
  validateOctopusWealthDatumV1,
} from './octopusWealthHouseholdModelV1.mjs';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NOW_MS = Date.now();
const OBSERVED_MS = NOW_MS - 2 * MINUTE_MS;
const AS_OF_MS = OBSERVED_MS - MINUTE_MS;
const OBSERVED_AT = new Date(OBSERVED_MS).toISOString();
const AS_OF = new Date(AS_OF_MS).toISOString();
const VALIDATION_OPTIONS = Object.freeze({ observedAtUtc: OBSERVED_AT });

function datum(overrides = {}) {
  return {
    schemaVersion: OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION,
    datumId: 'manual-cash-liquid-assets',
    tentacleId: 'CASH_AND_LIQUIDITY',
    metricId: 'cash-liquid-assets',
    value: 100,
    unit: 'GBP',
    asOfUtc: AS_OF,
    sourceType: 'MANUAL',
    sourceName: 'operator-manual-entry',
    sourceRef: 'manual://octopus/cash-liquid-assets',
    confidence: 'HIGH',
    epistemicStatus: 'ACTUAL',
    freshness: 'FRESH',
    ownershipBoundary: 'HOUSEHOLD',
    manualOverride: false,
    notes: 'Synthetic test evidence only.',
    ...overrides,
  };
}

function model(data, overrides = {}) {
  return buildOctopusWealthHouseholdModelV1({
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    modelId: 'octopus-household-test',
    observedAtUtc: OBSERVED_AT,
    data,
    ...overrides,
  });
}

function allTentacleRecords(overridesForIndex = () => ({})) {
  return OCTOPUS_WEALTH_TENTACLES.map((tentacleId, index) => datum({
    datumId: `tentacle-${index + 1}`,
    tentacleId,
    metricId: `tentacle-${index + 1}-metric`,
    value: index + 1,
    sourceRef: `manual://octopus/tentacle-${index + 1}`,
    ...overridesForIndex(index, tentacleId),
  }));
}

test('explicit seed is deterministic and keeps eight tentacles UNKNOWN and non-current', () => {
  const options = { modelId: 'octopus-seed-test', observedAtUtc: OBSERVED_AT };
  const first = createOctopusWealthManualSeedTemplateV1(options);
  const second = createOctopusWealthManualSeedTemplateV1({ ...options });

  assert.equal(first.valid, true, first.validationErrors.join(', '));
  assert.equal(first.readiness, 'M1_MANUAL_SEED_READY');
  assert.equal(first.projectionFreshness, 'FRESH');
  assert.equal(first.evidenceCoverage.representedTentacleCount, 8);
  assert.equal(first.evidenceCoverage.knownTentacleCount, 0);
  assert.equal(first.evidenceCoverage.currentKnownTentacleCount, 0);
  assert.equal(first.evidenceCoverage.unknownDatumCount, 8);
  assert.deepEqual(first.tentacles.map((entry) => entry.tentacleId), OCTOPUS_WEALTH_TENTACLES);
  assert.equal(first.data.every((entry) => entry.value === null && entry.epistemicStatus === 'UNKNOWN' && entry.freshness === 'UNKNOWN'), true);
  assert.equal(first.tentacles.every((entry) => entry.currentCount === 0 && entry.currentKnownEvidenceAvailable === false), true);
  assert.equal(first.projectionId, second.projectionId);
  assert.deepEqual(first.data, second.data);
  assert.equal(Date.parse(first.evaluatedAtUtc) >= OBSERVED_MS, true);
  assert.equal(first.freshnessValidUntilUtc, new Date(OBSERVED_MS + 60 * MINUTE_MS).toISOString());
});

test('seed requires explicit safe options and never invokes getters', () => {
  assert.equal(createOctopusWealthManualSeedTemplateV1().valid, false);
  const missingTime = createOctopusWealthManualSeedTemplateV1({ modelId: 'missing-time', observedAtUtc: '' });
  assert.ok(missingTime.validationErrors.includes('seed-observedAtUtc-required'));

  let calls = 0;
  const hostile = { modelId: 'hostile-seed' };
  Object.defineProperty(hostile, 'observedAtUtc', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('getter must not run');
    },
  });
  let result;
  assert.doesNotThrow(() => { result = createOctopusWealthManualSeedTemplateV1(hostile); });
  assert.equal(calls, 0);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('seed-options-must-be-data-only'));
});

test('standalone datum validation requires observation context and adjudicates freshness', () => {
  const missingContext = validateOctopusWealthDatumV1(datum());
  assert.equal(missingContext.valid, false);
  assert.ok(missingContext.errors.includes('validation-options-must-contain-observedAtUtc'));

  const valid = validateOctopusWealthDatumV1(datum(), VALIDATION_OPTIONS);
  assert.equal(valid.valid, true, valid.errors.join(', '));

  const expiredAsOf = new Date(OBSERVED_MS - 400 * DAY_MS).toISOString();
  const forged = validateOctopusWealthDatumV1(datum({ asOfUtc: expiredAsOf, freshness: 'FRESH' }), VALIDATION_OPTIONS);
  assert.equal(forged.valid, false);
  assert.ok(forged.errors.includes('freshness-mismatch:EXPIRED'));
});

test('standalone validator options are descriptor-safe', () => {
  let calls = 0;
  const options = {};
  Object.defineProperty(options, 'observedAtUtc', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('validator option getter must not run');
    },
  });
  let verdict;
  assert.doesNotThrow(() => { verdict = validateOctopusWealthDatumV1(datum(), options); });
  assert.equal(calls, 0);
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('validation-options-must-be-data-only'));
});

test('epistemic classes remain separate and UNKNOWN cannot count as current', () => {
  const result = model([
    datum(),
    datum({ datumId: 'cash-estimate', metricId: 'cash-estimate', value: 120, epistemicStatus: 'ESTIMATED', confidence: 'MEDIUM' }),
    datum({ datumId: 'cash-projection', metricId: 'cash-projection', value: 150, epistemicStatus: 'PROJECTED', sourceType: 'MODEL_ASSUMPTION', sourceName: 'scenario-model', sourceRef: 'dataset://scenario/cash-projection', confidence: 'LOW' }),
    datum({ datumId: 'cash-unknown', metricId: 'cash-unknown', value: null, epistemicStatus: 'UNKNOWN', confidence: 'UNKNOWN', freshness: 'UNKNOWN' }),
  ]);

  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.actualDatumCount, 1);
  assert.equal(result.evidenceCoverage.estimatedDatumCount, 1);
  assert.equal(result.evidenceCoverage.projectedDatumCount, 1);
  assert.equal(result.evidenceCoverage.unknownDatumCount, 1);
  assert.equal(result.evidenceCoverage.currentKnownTentacleCount, 1);
  assert.equal(result.tentacles[0].currentCount, 3);
  assert.equal(result.readiness, 'M1_EVIDENCE_INCOMPLETE');
});

test('duplicate or conflicting evidence identity clears every projected value', () => {
  const record = datum();
  const duplicate = model([record, { ...record }]);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.validationErrors.some((error) => error.startsWith('duplicate-datum-identity:')));
  assert.deepEqual(duplicate.data, []);
  assert.equal(duplicate.evidenceCoverage.actualDatumCount, 0);

  const conflict = model([datum(), datum({ datumId: 'cash-conflict', value: 999 })]);
  assert.equal(conflict.valid, false);
  assert.ok(conflict.validationErrors.some((error) => error.startsWith('conflicting-datum-identity:')));
  assert.deepEqual(conflict.data, []);
});

test('datum IDs are globally unique even when semantic identities differ', () => {
  const result = model([
    datum(),
    datum({
      tentacleId: 'ISA_AND_INVESTMENTS',
      metricId: 'isa-current-value',
      sourceRef: 'manual://octopus/isa-current-value',
    }),
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('duplicate-datumId:manual-cash-liquid-assets'));
  assert.deepEqual(result.data, []);
});

test('UNKNOWN requires null, UNKNOWN confidence and UNKNOWN freshness', () => {
  for (const overrides of [
    { epistemicStatus: 'UNKNOWN', value: 1, confidence: 'UNKNOWN', freshness: 'UNKNOWN' },
    { epistemicStatus: 'UNKNOWN', value: null, confidence: 'HIGH', freshness: 'UNKNOWN' },
    { epistemicStatus: 'UNKNOWN', value: null, confidence: 'UNKNOWN', freshness: 'FRESH' },
  ]) assert.equal(validateOctopusWealthDatumV1(datum(overrides), VALIDATION_OPTIONS).valid, false);
});

test('freshness is derived from as-of and observation time', () => {
  const expiredAsOf = new Date(OBSERVED_MS - 400 * DAY_MS).toISOString();
  const forged = model([datum({ asOfUtc: expiredAsOf, freshness: 'FRESH' })]);
  assert.equal(forged.valid, false);
  assert.ok(forged.validationErrors.includes('data[0]:freshness-mismatch:EXPIRED'));
  assert.deepEqual(forged.data, []);

  const truthful = model([datum({ asOfUtc: expiredAsOf, freshness: 'EXPIRED' })]);
  assert.equal(truthful.valid, true, truthful.validationErrors.join(', '));
  assert.equal(truthful.tentacles[0].currentCount, 0);
  assert.equal(truthful.tentacles[0].staleCount, 1);
});

test('complete but expired evidence estate requires refresh rather than becoming ready', () => {
  const expiredAsOf = new Date(OBSERVED_MS - 400 * DAY_MS).toISOString();
  const result = model(allTentacleRecords(() => ({ asOfUtc: expiredAsOf, freshness: 'EXPIRED' })));
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.knownTentacleCount, 8);
  assert.equal(result.evidenceCoverage.currentKnownTentacleCount, 0);
  assert.equal(result.evidenceCoverage.staleKnownTentacleCount, 8);
  assert.equal(result.readiness, 'M1_EVIDENCE_REFRESH_REQUIRED');
});

test('stale projection truth never advertises current evidence or current readiness', () => {
  const observedMs = NOW_MS - 2 * 60 * MINUTE_MS;
  const asOfUtc = new Date(observedMs - MINUTE_MS).toISOString();
  const result = model(allTentacleRecords((index) => ({
    asOfUtc,
    sourceRef: `manual://octopus/historical-${index + 1}`,
  })), { observedAtUtc: new Date(observedMs).toISOString() });
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.projectionFreshness, 'AGING');
  assert.equal(result.readiness, 'M1_EVIDENCE_REFRESH_REQUIRED');
  assert.equal(result.tentacles.every((entry) => entry.currentCount === 0), true);
});

test('known evidence requires compatible source and bounded value types', () => {
  const badRecords = [
    datum({ epistemicStatus: 'PROJECTED', sourceType: 'PROVIDER_READ_ONLY', sourceName: 'synthetic-provider', sourceRef: 'provider://synthetic/projection' }),
    datum({ sourceType: 'MODEL_ASSUMPTION', sourceName: 'scenario-model', sourceRef: 'dataset://scenario/actual-claim' }),
    datum({ value: true, unit: 'GBP' }),
    datum({ value: 4.5, unit: 'COUNT' }),
    datum({ value: '12345678', unit: 'TEXT' }),
    datum({ value: null, unit: 'GBP' }),
    datum({ value: 1e20, unit: 'GBP' }),
    datum({ value: 201, unit: 'YEARS' }),
    datum({ value: -101, unit: 'PERCENT' }),
  ];
  for (const record of badRecords) assert.equal(validateOctopusWealthDatumV1(record, VALIDATION_OPTIONS).valid, false);
});

test('future and internally impossible timestamps fail closed', () => {
  const futureDatum = validateOctopusWealthDatumV1(datum({ asOfUtc: '2999-01-01T00:00:00.000Z' }), VALIDATION_OPTIONS);
  assert.ok(futureDatum.errors.includes('asOfUtc-future-dated'));
  const futureModel = model([datum()], { observedAtUtc: '2999-01-01T00:00:00.000Z' });
  assert.ok(futureModel.validationErrors.includes('observedAtUtc-future-dated'));
  const afterObservation = model([datum({ asOfUtc: new Date(OBSERVED_MS + MINUTE_MS).toISOString() })]);
  assert.ok(afterObservation.validationErrors.includes('data[0]:asOfUtc-after-observedAtUtc'));
});

test('source references reject URLs, traversal, disguised paths and identifier-like values', () => {
  for (const sourceRef of [
    'https://provider.example/private',
    'manual://../private',
    '/Users/operator/private.csv',
    'C:\\Users\\operator\\private.csv',
    'manual://c:/users/operator/private',
    'provider://synthetic/12345678',
    'document://bank/12-34-56',
    'provider://bank/GB82WEST12345698765432',
  ]) {
    const verdict = validateOctopusWealthDatumV1(datum({ sourceRef }), VALIDATION_OPTIONS);
    assert.equal(verdict.valid, false, `${sourceRef} must fail closed`);
    assert.ok(verdict.errors.includes('sourceRef-invalid'));
  }
});

test('secret labels, credential aliases and control characters are rejected', () => {
  for (const notes of [
    'client_secret value',
    'db_password value',
    'bank_account_number 1234',
    'oauth_token value',
    'session_token value',
    'credential value',
    'unsafe\u0000text',
  ]) {
    const verdict = validateOctopusWealthDatumV1(datum({ notes }), VALIDATION_OPTIONS);
    assert.equal(verdict.valid, false, `${JSON.stringify(notes)} must fail closed`);
  }
});

test('secret and authority-shaped extra fields fail closed and are never returned', () => {
  const result = model([{ ...datum(), apiKey: 'synthetic-secret-value', accountNumber: '12345678', mergeAllowed: true }]);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('sensitive-content-rejected'));
  assert.deepEqual(result.data, []);
  assert.equal(JSON.stringify(result).includes('synthetic-secret-value'), false);
});

test('invalid projections redact sensitive or identifier-like top-level model identity', () => {
  for (const modelId of ['client-secret', '12345678']) {
    const result = model([], { modelId });
    assert.equal(result.valid, false);
    assert.equal(result.modelId, '');
    assert.equal(JSON.stringify(result).includes(modelId), false);
  }
});

test('identity and source-name fields cannot carry account-like digit strings', () => {
  const badRecords = [
    datum({ datumId: '12345678' }),
    datum({ metricId: 'metric-12345678' }),
    datum({ sourceName: '12345678' }),
  ];
  for (const record of badRecords) {
    assert.equal(validateOctopusWealthDatumV1(record, VALIDATION_OPTIONS).valid, false);
  }
});

test('record accessors fail closed without invoking getters', () => {
  let calls = 0;
  const hostile = datum();
  Object.defineProperty(hostile, 'value', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('getter must not run');
    },
  });
  let result;
  assert.doesNotThrow(() => { result = model([hostile]); });
  assert.equal(calls, 0);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('input-must-be-data-only'));
});

test('array accessors, hidden properties, symbols and custom prototypes fail before iteration', () => {
  let calls = 0;
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    configurable: true,
    get() {
      calls += 1;
      throw new Error('array getter must not run');
    },
  });
  accessorArray.length = 1;
  assert.equal(model(accessorArray).valid, false);
  assert.equal(calls, 0);

  const authorityArray = [datum()];
  authorityArray.mergeAllowed = true;
  assert.equal(model(authorityArray).valid, false);
  const symbolArray = [datum()];
  symbolArray[Symbol('hidden')] = true;
  assert.equal(model(symbolArray).valid, false);
  const customPrototypeArray = [datum()];
  Object.setPrototypeOf(customPrototypeArray, Object.create(Array.prototype));
  assert.equal(model(customPrototypeArray).valid, false);
});

test('custom prototypes, symbol keys, cycles and record-count overflow fail closed', () => {
  const inherited = Object.assign(Object.create({ inherited: true }), {
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    modelId: 'octopus-inherited',
    observedAtUtc: OBSERVED_AT,
    data: [],
  });
  assert.equal(buildOctopusWealthHouseholdModelV1(inherited).valid, false);
  const symbolRecord = datum();
  symbolRecord[Symbol('hidden')] = true;
  assert.equal(model([symbolRecord]).valid, false);
  const cycle = [];
  cycle.push(cycle);
  assert.equal(model(cycle).valid, false);

  const tooMany = Array.from({ length: 257 }, (_, index) => datum({
    datumId: `record-${index + 1}`,
    metricId: `metric-${index + 1}`,
    sourceRef: `manual://octopus/record-${index + 1}`,
  }));
  const overflow = model(tooMany);
  assert.equal(overflow.valid, false);
  assert.ok(overflow.validationErrors.includes('data-record-limit-exceeded'));
});

test('all eight tentacles retain separate ownership-bound current evidence', () => {
  const result = model(allTentacleRecords((index) => ({ ownershipBoundary: index % 2 === 0 ? 'STEPHAN' : 'SPOUSE' })));
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.representedTentacleCount, 8);
  assert.equal(result.evidenceCoverage.knownTentacleCount, 8);
  assert.equal(result.evidenceCoverage.currentKnownTentacleCount, 8);
  assert.equal(result.readiness, 'M1_MANUAL_EVIDENCE_MODEL_READY');
  assert.deepEqual(new Set(result.data.map((entry) => entry.ownershipBoundary)), new Set(['STEPHAN', 'SPOUSE']));
});

test('known evidence with unresolved ownership remains reconciliation-required', () => {
  const result = model(allTentacleRecords((index) => index === 3 ? { ownershipBoundary: 'UNKNOWN' } : {}));
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.unresolvedOwnershipDatumCount, 1);
  assert.equal(result.readiness, 'M1_MANUAL_RECONCILIATION_REQUIRED');
});

test('external-reference evidence counts only for the external-environment tentacle', () => {
  const unresolved = model(allTentacleRecords((index) => index === 0 ? { ownershipBoundary: 'EXTERNAL_REFERENCE' } : {}));
  assert.equal(unresolved.valid, true, unresolved.validationErrors.join(', '));
  assert.equal(unresolved.evidenceCoverage.unresolvedOwnershipDatumCount, 1);
  assert.equal(unresolved.evidenceCoverage.currentKnownTentacleCount, 7);
  assert.equal(unresolved.readiness, 'M1_MANUAL_RECONCILIATION_REQUIRED');

  const externalEnvironmentIndex = OCTOPUS_WEALTH_TENTACLES.indexOf('EXTERNAL_ENVIRONMENT');
  const resolved = model(allTentacleRecords((index) => index === externalEnvironmentIndex ? { ownershipBoundary: 'EXTERNAL_REFERENCE' } : {}));
  assert.equal(resolved.valid, true, resolved.validationErrors.join(', '));
  assert.equal(resolved.evidenceCoverage.unresolvedOwnershipDatumCount, 0);
  assert.equal(resolved.evidenceCoverage.currentKnownTentacleCount, 8);
  assert.equal(resolved.readiness, 'M1_MANUAL_EVIDENCE_MODEL_READY');
});

test('mixed known and explicit UNKNOWN evidence remains reconciliation-required', () => {
  const records = allTentacleRecords();
  records.push(datum({
    datumId: 'cash-unknown-secondary',
    metricId: 'cash-unknown-secondary',
    value: null,
    confidence: 'UNKNOWN',
    epistemicStatus: 'UNKNOWN',
    freshness: 'UNKNOWN',
    sourceRef: 'manual://octopus/cash-unknown-secondary',
  }));
  const result = model(records);
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.unknownDatumCount, 1);
  assert.equal(result.readiness, 'M1_MANUAL_RECONCILIATION_REQUIRED');
});

test('partial evidence remains incomplete and equivalent sets have stable projection identity', () => {
  const firstRecord = datum();
  const secondRecord = datum({ datumId: 'isa-current-value', tentacleId: 'ISA_AND_INVESTMENTS', metricId: 'isa-current-value', sourceRef: 'manual://octopus/isa-current-value' });
  const partial = model([firstRecord]);
  assert.equal(partial.readiness, 'M1_EVIDENCE_INCOMPLETE');
  const first = model([firstRecord, secondRecord]);
  const second = model([secondRecord, firstRecord]);
  assert.equal(first.valid, true, first.validationErrors.join(', '));
  assert.equal(second.valid, true, second.validationErrors.join(', '));
  assert.equal(first.projectionId, second.projectionId);
  assert.deepEqual(first.data, second.data);
});

test('M1 projection retains zero financial and platform authority', () => {
  const result = createOctopusWealthManualSeedTemplateV1({ modelId: 'octopus-authority-test', observedAtUtc: OBSERVED_AT });
  assert.deepEqual(result.authority, {
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
});
