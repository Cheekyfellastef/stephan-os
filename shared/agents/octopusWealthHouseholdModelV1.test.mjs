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
const TEST_NOW_MS = Date.now();
const OBSERVED_MS = TEST_NOW_MS - 2 * MINUTE_MS;
const AS_OF_MS = OBSERVED_MS - MINUTE_MS;
const OBSERVED_AT = new Date(OBSERVED_MS).toISOString();
const AS_OF = new Date(AS_OF_MS).toISOString();

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

test('manual seed is deterministic for an explicit timestamp and preserves eight UNKNOWN tentacles', () => {
  const options = {
    modelId: 'octopus-household-manual-seed-test',
    observedAtUtc: OBSERVED_AT,
  };
  const first = createOctopusWealthManualSeedTemplateV1(options);
  const second = createOctopusWealthManualSeedTemplateV1({ ...options });

  assert.equal(first.valid, true, first.validationErrors.join(', '));
  assert.equal(first.readiness, 'M1_MANUAL_SEED_READY');
  assert.equal(first.projectionFreshness, 'FRESH');
  assert.equal(first.evidenceCoverage.requiredTentacleCount, 8);
  assert.equal(first.evidenceCoverage.representedTentacleCount, 8);
  assert.equal(first.evidenceCoverage.knownTentacleCount, 0);
  assert.equal(first.evidenceCoverage.unknownDatumCount, 8);
  assert.deepEqual(first.tentacles.map((entry) => entry.tentacleId), OCTOPUS_WEALTH_TENTACLES);
  assert.equal(first.data.every((entry) => entry.value === null && entry.epistemicStatus === 'UNKNOWN' && entry.freshness === 'UNKNOWN'), true);
  assert.equal(first.tentacles.every((entry) => entry.currentCount === 0), true);
  assert.equal(first.projectionId, second.projectionId);
  assert.deepEqual(first.data, second.data);
});

test('seed requires an explicit canonical timestamp', () => {
  const omitted = createOctopusWealthManualSeedTemplateV1({
    modelId: 'octopus-seed-missing-time',
    observedAtUtc: '',
  });
  assert.equal(omitted.valid, false);
  assert.ok(omitted.validationErrors.includes('seed-observedAtUtc-required'));

  const noOptions = createOctopusWealthManualSeedTemplateV1();
  assert.equal(noOptions.valid, false);
  assert.ok(noOptions.validationErrors.includes('seed-option-fields-mismatch'));
});

test('seed options fail closed without invoking accessor properties', () => {
  let getterCalls = 0;
  const options = { modelId: 'octopus-hostile-seed' };
  Object.defineProperty(options, 'observedAtUtc', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('seed getter must not run');
    },
  });
  let result;
  assert.doesNotThrow(() => {
    result = createOctopusWealthManualSeedTemplateV1(options);
  });
  assert.equal(getterCalls, 0);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('seed-options-must-be-data-only'));
});

test('actual, estimated, projected and unknown evidence remain separate truth classes', () => {
  const result = model([
    datum(),
    datum({
      datumId: 'manual-cash-estimate',
      metricId: 'cash-estimate',
      value: 120,
      confidence: 'MEDIUM',
      epistemicStatus: 'ESTIMATED',
    }),
    datum({
      datumId: 'model-cash-projection',
      metricId: 'cash-projection',
      value: 150,
      sourceType: 'MODEL_ASSUMPTION',
      sourceName: 'bounded-scenario-model',
      sourceRef: 'dataset://scenario/cash-projection',
      confidence: 'LOW',
      epistemicStatus: 'PROJECTED',
    }),
    datum({
      datumId: 'manual-cash-unknown',
      metricId: 'cash-unknown',
      value: null,
      confidence: 'UNKNOWN',
      epistemicStatus: 'UNKNOWN',
      freshness: 'UNKNOWN',
    }),
  ]);

  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.actualDatumCount, 1);
  assert.equal(result.evidenceCoverage.estimatedDatumCount, 1);
  assert.equal(result.evidenceCoverage.projectedDatumCount, 1);
  assert.equal(result.evidenceCoverage.unknownDatumCount, 1);
  assert.equal(result.tentacles[0].currentCount, 3);
});

test('duplicate and conflicting evidence clear all projected values', () => {
  const record = datum();
  const duplicate = model([record, { ...record }]);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.validationErrors.some((error) => error.startsWith('duplicate-datum-identity:')));
  assert.deepEqual(duplicate.data, []);
  assert.equal(duplicate.evidenceCoverage.actualDatumCount, 0);
  assert.equal(duplicate.readiness, 'SAFE_HOLD');

  const conflict = model([
    datum(),
    datum({ datumId: 'manual-cash-conflict', value: 999 }),
  ]);
  assert.equal(conflict.valid, false);
  assert.ok(conflict.validationErrors.some((error) => error.startsWith('conflicting-datum-identity:')));
  assert.deepEqual(conflict.data, []);
  assert.equal(conflict.evidenceCoverage.actualDatumCount, 0);
});

test('UNKNOWN requires null, UNKNOWN confidence and UNKNOWN freshness', () => {
  for (const overrides of [
    { epistemicStatus: 'UNKNOWN', value: 1, confidence: 'UNKNOWN', freshness: 'UNKNOWN' },
    { epistemicStatus: 'UNKNOWN', value: null, confidence: 'HIGH', freshness: 'UNKNOWN' },
    { epistemicStatus: 'UNKNOWN', value: null, confidence: 'UNKNOWN', freshness: 'FRESH' },
  ]) {
    const verdict = validateOctopusWealthDatumV1(datum(overrides));
    assert.equal(verdict.valid, false);
  }

  const result = model([datum({
    epistemicStatus: 'UNKNOWN',
    value: null,
    confidence: 'UNKNOWN',
    freshness: 'UNKNOWN',
  })]);
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.tentacles[0].currentCount, 0);
});

test('freshness is reconciled against as-of and observation timestamps', () => {
  const expiredAsOf = new Date(OBSERVED_MS - 400 * DAY_MS).toISOString();
  const forgedFresh = model([datum({ asOfUtc: expiredAsOf, freshness: 'FRESH' })]);
  assert.equal(forgedFresh.valid, false);
  assert.ok(forgedFresh.validationErrors.includes('data[0]:freshness-mismatch:EXPIRED'));
  assert.deepEqual(forgedFresh.data, []);

  const truthfulExpired = model([datum({ asOfUtc: expiredAsOf, freshness: 'EXPIRED' })]);
  assert.equal(truthfulExpired.valid, true, truthfulExpired.validationErrors.join(', '));
  assert.equal(truthfulExpired.tentacles[0].currentCount, 0);
  assert.equal(truthfulExpired.tentacles[0].staleCount, 1);
});

test('a stale projection cannot advertise current evidence or current readiness', () => {
  const historicalObservedMs = TEST_NOW_MS - 2 * 60 * MINUTE_MS;
  const historicalAsOfMs = historicalObservedMs - MINUTE_MS;
  const records = OCTOPUS_WEALTH_TENTACLES.map((tentacleId, index) => datum({
    datumId: `manual-historical-${index + 1}`,
    tentacleId,
    metricId: `historical-${index + 1}`,
    value: index + 1,
    asOfUtc: new Date(historicalAsOfMs).toISOString(),
    sourceRef: `manual://octopus/historical-${index + 1}`,
  }));
  const result = model(records, { observedAtUtc: new Date(historicalObservedMs).toISOString() });
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.projectionFreshness, 'AGING');
  assert.equal(result.readiness, 'M1_EVIDENCE_REFRESH_REQUIRED');
  assert.equal(result.tentacles.every((entry) => entry.currentCount === 0), true);
});

test('known truth classes require compatible source types and values', () => {
  const projectedProvider = validateOctopusWealthDatumV1(datum({
    epistemicStatus: 'PROJECTED',
    sourceType: 'PROVIDER_READ_ONLY',
    sourceName: 'synthetic-provider',
    sourceRef: 'provider://synthetic/projection',
  }));
  assert.equal(projectedProvider.valid, false);
  assert.ok(projectedProvider.errors.includes('known-sourceType-invalid'));

  const actualAssumption = validateOctopusWealthDatumV1(datum({
    sourceType: 'MODEL_ASSUMPTION',
    sourceName: 'scenario-model',
    sourceRef: 'dataset://scenario/actual-claim',
  }));
  assert.equal(actualAssumption.valid, false);
  assert.ok(actualAssumption.errors.includes('known-sourceType-invalid'));

  for (const overrides of [
    { value: true, unit: 'GBP' },
    { value: 4.5, unit: 'COUNT' },
    { value: '12345678', unit: 'TEXT' },
    { value: null, unit: 'GBP' },
  ]) {
    assert.equal(validateOctopusWealthDatumV1(datum(overrides)).valid, false);
  }
});

test('future-dated evidence and model observations fail closed', () => {
  const futureDatum = validateOctopusWealthDatumV1(datum({ asOfUtc: '2999-01-01T00:00:00.000Z' }));
  assert.equal(futureDatum.valid, false);
  assert.ok(futureDatum.errors.includes('asOfUtc-future-dated'));

  const futureModel = model([datum()], { observedAtUtc: '2999-01-01T00:00:00.000Z' });
  assert.equal(futureModel.valid, false);
  assert.ok(futureModel.validationErrors.includes('observedAtUtc-future-dated'));

  const afterObservation = model([datum({ asOfUtc: new Date(OBSERVED_MS + MINUTE_MS).toISOString() })]);
  assert.equal(afterObservation.valid, false);
  assert.ok(afterObservation.validationErrors.includes('data[0]:asOfUtc-after-observedAtUtc'));
});

test('source references reject raw URLs, traversal, disguised absolute paths and identifier-like values', () => {
  for (const sourceRef of [
    'https://provider.example/private',
    'manual://../private',
    '/Users/operator/private.csv',
    'C:\\Users\\operator\\private.csv',
    'manual://c:/users/operator/private',
    'provider://synthetic/12345678',
  ]) {
    const verdict = validateOctopusWealthDatumV1(datum({ sourceRef }));
    assert.equal(verdict.valid, false, `${sourceRef} must fail closed`);
    assert.ok(verdict.errors.includes('sourceRef-invalid'));
  }
});

test('secret and account labels remain rejected when preceded by underscores', () => {
  for (const notes of [
    'client_secret synthetic-value',
    'db_password synthetic-value',
    'bank_account_number 1234',
  ]) {
    const verdict = validateOctopusWealthDatumV1(datum({ notes }));
    assert.equal(verdict.valid, false, `${notes} must fail closed`);
    assert.ok(verdict.errors.includes('sensitive-content-rejected'));
  }
});

test('secret, account and authority-shaped extra fields are rejected and never projected', () => {
  const result = model([{
    ...datum(),
    apiKey: 'synthetic-secret-value',
    accountNumber: '12345678',
    mergeAllowed: true,
  }]);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.some((error) => error.includes('datum-fields-mismatch')));
  assert.ok(result.validationErrors.includes('sensitive-content-rejected'));
  assert.deepEqual(result.data, []);
  assert.equal(JSON.stringify(result).includes('synthetic-secret-value'), false);
});

test('accessor-backed record evidence fails closed without invoking getters', () => {
  let getterCalls = 0;
  const hostile = datum();
  Object.defineProperty(hostile, 'value', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('datum getter must not run');
    },
  });

  let result;
  assert.doesNotThrow(() => {
    result = model([hostile]);
  });
  assert.equal(getterCalls, 0);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.includes('input-must-be-data-only'));
});

test('array accessors, hidden properties, symbols and custom prototypes fail before iteration', () => {
  let getterCalls = 0;
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error('array getter must not run');
    },
  });
  accessorArray.length = 1;
  const accessorResult = model(accessorArray);
  assert.equal(getterCalls, 0);
  assert.equal(accessorResult.valid, false);
  assert.ok(accessorResult.validationErrors.includes('input-must-be-data-only'));

  const authorityArray = [datum()];
  authorityArray.mergeAllowed = true;
  assert.equal(model(authorityArray).valid, false);

  const symbolArray = [datum()];
  symbolArray[Symbol('hidden')] = 'not-visible';
  assert.equal(model(symbolArray).valid, false);

  const customPrototypeArray = [datum()];
  Object.setPrototypeOf(customPrototypeArray, Object.create(Array.prototype));
  assert.equal(model(customPrototypeArray).valid, false);
});

test('custom object prototypes, symbols and cycles fail closed', () => {
  const inherited = Object.assign(Object.create({ inherited: true }), {
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    modelId: 'octopus-inherited',
    observedAtUtc: OBSERVED_AT,
    data: [],
  });
  assert.equal(buildOctopusWealthHouseholdModelV1(inherited).valid, false);

  const symbolRecord = datum();
  symbolRecord[Symbol('hidden')] = 'not-visible';
  assert.equal(model([symbolRecord]).valid, false);

  const cycle = [];
  cycle.push(cycle);
  assert.equal(model(cycle).valid, false);
});

test('all eight tentacles accept separate ownership-bound evidence without collapsing owners', () => {
  const records = OCTOPUS_WEALTH_TENTACLES.map((tentacleId, index) => datum({
    datumId: `manual-tentacle-${index + 1}`,
    tentacleId,
    metricId: `tentacle-${index + 1}-metric`,
    value: index + 1,
    ownershipBoundary: index % 2 === 0 ? 'STEPHAN' : 'SPOUSE',
    sourceRef: `manual://octopus/tentacle-${index + 1}`,
  }));
  const result = model(records);
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.representedTentacleCount, 8);
  assert.equal(result.evidenceCoverage.knownTentacleCount, 8);
  assert.equal(result.readiness, 'M1_MANUAL_EVIDENCE_MODEL_READY');
  assert.deepEqual(new Set(result.data.map((entry) => entry.ownershipBoundary)), new Set(['STEPHAN', 'SPOUSE']));
});

test('partial tentacle evidence remains visibly incomplete', () => {
  const result = model([datum()]);
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.evidenceCoverage.representedTentacleCount, 1);
  assert.equal(result.readiness, 'M1_EVIDENCE_INCOMPLETE');
});

test('equivalent evidence sets produce one projection identity regardless of caller order', () => {
  const firstRecord = datum();
  const secondRecord = datum({
    datumId: 'manual-isa-current-value',
    tentacleId: 'ISA_AND_INVESTMENTS',
    metricId: 'isa-current-value',
    sourceRef: 'manual://octopus/isa-current-value',
  });
  const first = model([firstRecord, secondRecord]);
  const second = model([secondRecord, firstRecord]);
  assert.equal(first.valid, true, first.validationErrors.join(', '));
  assert.equal(second.valid, true, second.validationErrors.join(', '));
  assert.equal(first.projectionId, second.projectionId);
  assert.deepEqual(first.data, second.data);
});

test('M1 output is read-only and cannot acquire financial or platform authority', () => {
  const result = createOctopusWealthManualSeedTemplateV1({
    modelId: 'octopus-authority-test',
    observedAtUtc: OBSERVED_AT,
  });
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
