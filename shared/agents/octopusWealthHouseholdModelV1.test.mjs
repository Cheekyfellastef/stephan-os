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

const AS_OF = '2026-08-14T10:00:00.000Z';
const OBSERVED_AT = '2026-08-14T10:05:00.000Z';

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

test('manual seed preserves all eight tentacles as explicit UNKNOWN without personal values', () => {
  const result = createOctopusWealthManualSeedTemplateV1({
    modelId: 'octopus-household-manual-seed-test',
    observedAtUtc: OBSERVED_AT,
  });

  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.readiness, 'M1_MANUAL_SEED_READY');
  assert.equal(result.evidenceCoverage.requiredTentacleCount, 8);
  assert.equal(result.evidenceCoverage.representedTentacleCount, 8);
  assert.equal(result.evidenceCoverage.knownTentacleCount, 0);
  assert.equal(result.evidenceCoverage.unknownDatumCount, 8);
  assert.deepEqual(result.tentacles.map((entry) => entry.tentacleId), OCTOPUS_WEALTH_TENTACLES);
  assert.equal(result.data.every((entry) => entry.value === null && entry.epistemicStatus === 'UNKNOWN'), true);
  assert.equal(JSON.stringify(result).includes('account'), false);
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
});

test('duplicate evidence identity fails closed instead of inflating coverage', () => {
  const record = datum();
  const result = model([record, { ...record }]);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.some((error) => error.startsWith('duplicate-datum-identity:')));
  assert.equal(result.readiness, 'SAFE_HOLD');
});

test('conflicting evidence identity fails closed instead of choosing one source', () => {
  const result = model([
    datum(),
    datum({ datumId: 'manual-cash-conflict', value: 999 }),
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.some((error) => error.startsWith('conflicting-datum-identity:')));
  assert.equal(result.readiness, 'SAFE_HOLD');
});

test('UNKNOWN requires null and known evidence requires a bounded finite value', () => {
  const unknownWithValue = validateOctopusWealthDatumV1(datum({
    epistemicStatus: 'UNKNOWN',
    confidence: 'UNKNOWN',
    freshness: 'UNKNOWN',
  }));
  assert.equal(unknownWithValue.valid, false);
  assert.ok(unknownWithValue.errors.includes('unknown-value-must-be-null'));

  const actualWithoutValue = validateOctopusWealthDatumV1(datum({ value: null }));
  assert.equal(actualWithoutValue.valid, false);
  assert.ok(actualWithoutValue.errors.includes('known-value-invalid'));

  const nonFinite = model([datum({ value: Number.POSITIVE_INFINITY })]);
  assert.equal(nonFinite.valid, false);
  assert.ok(nonFinite.validationErrors.includes('input-must-be-data-only'));
});

test('projected evidence cannot masquerade as provider-observed actual truth', () => {
  const verdict = validateOctopusWealthDatumV1(datum({
    epistemicStatus: 'PROJECTED',
    sourceType: 'PROVIDER_READ_ONLY',
    sourceName: 'synthetic-provider',
    sourceRef: 'provider://synthetic/projection',
  }));
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('projected-sourceType-invalid'));
});

test('future-dated evidence and model observations fail closed', () => {
  const futureDatum = validateOctopusWealthDatumV1(datum({ asOfUtc: '2999-01-01T00:00:00.000Z' }));
  assert.equal(futureDatum.valid, false);
  assert.ok(futureDatum.errors.includes('asOfUtc-future-dated'));

  const futureModel = model([datum()], { observedAtUtc: '2999-01-01T00:00:00.000Z' });
  assert.equal(futureModel.valid, false);
  assert.ok(futureModel.validationErrors.includes('observedAtUtc-future-dated'));
});

test('source references reject raw URLs, traversal and absolute personal paths', () => {
  for (const sourceRef of [
    'https://provider.example/private',
    'manual://../private',
    '/Users/operator/private.csv',
    'C:\\Users\\operator\\private.csv',
  ]) {
    const verdict = validateOctopusWealthDatumV1(datum({ sourceRef }));
    assert.equal(verdict.valid, false, `${sourceRef} must fail closed`);
    assert.ok(verdict.errors.includes('sourceRef-invalid'));
  }
});

test('secret, account and authority-shaped fields are rejected rather than projected', () => {
  const result = model([{
    ...datum(),
    apiKey: 'synthetic-secret-value',
    accountNumber: '12345678',
    mergeAllowed: true,
  }]);
  assert.equal(result.valid, false);
  assert.ok(result.validationErrors.some((error) => error.includes('datum-fields-mismatch')));
  assert.ok(result.validationErrors.includes('sensitive-content-rejected'));
  assert.equal(JSON.stringify(result).includes('synthetic-secret-value'), false);
});

test('sensitive text hidden in otherwise valid notes is rejected', () => {
  const verdict = validateOctopusWealthDatumV1(datum({
    notes: 'Password synthetic-value must never be retained.',
  }));
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('sensitive-content-rejected'));
});

test('accessor-backed evidence fails closed without invoking getters', () => {
  let getterCalls = 0;
  const hostile = datum();
  Object.defineProperty(hostile, 'value', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('getter must not run');
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

test('custom prototypes, symbols and cycles fail closed at the data-only boundary', () => {
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
