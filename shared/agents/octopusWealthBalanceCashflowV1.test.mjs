import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION,
  OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
} from './octopusWealthHouseholdModelV1.mjs';
import {
  OCTOPUS_WEALTH_BALANCE_CASHFLOW_SCHEMA_VERSION,
  OCTOPUS_WEALTH_M2_METRIC_ROLES,
  buildOctopusWealthBalanceCashflowV1,
} from './octopusWealthBalanceCashflowV1.mjs';

function isoNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function knownDatum(observedAtUtc, {
  datumId,
  tentacleId,
  metricId,
  value,
  unit,
  ownershipBoundary = 'HOUSEHOLD',
  epistemicStatus = 'ACTUAL',
  sourceType = epistemicStatus === 'PROJECTED' ? 'MODEL_ASSUMPTION' : 'MANUAL',
} = {}) {
  return {
    schemaVersion: OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION,
    datumId,
    tentacleId,
    metricId,
    value,
    unit,
    asOfUtc: observedAtUtc,
    sourceType,
    sourceName: sourceType === 'MODEL_ASSUMPTION' ? 'bounded-model-assumption' : 'operator-reconciled-evidence',
    sourceRef: `manual://octopus-m2/${datumId}`,
    confidence: 'HIGH',
    epistemicStatus,
    freshness: 'FRESH',
    ownershipBoundary,
    manualOverride: false,
    notes: '',
  };
}

function unknownDatum(observedAtUtc, {
  datumId,
  tentacleId,
  metricId,
  unit,
  ownershipBoundary = 'HOUSEHOLD',
} = {}) {
  return {
    schemaVersion: OCTOPUS_WEALTH_DATUM_SCHEMA_VERSION,
    datumId,
    tentacleId,
    metricId,
    value: null,
    unit,
    asOfUtc: observedAtUtc,
    sourceType: 'MANUAL',
    sourceName: 'operator-reconciled-evidence',
    sourceRef: `manual://octopus-m2/${datumId}`,
    confidence: 'UNKNOWN',
    epistemicStatus: 'UNKNOWN',
    freshness: 'UNKNOWN',
    ownershipBoundary,
    manualOverride: false,
    notes: '',
  };
}

function completeData(observedAtUtc) {
  return [
    knownDatum(observedAtUtc, { datumId: 'cash-assets', tentacleId: 'CASH_AND_LIQUIDITY', metricId: 'cash-liquid-assets', value: 10_000, unit: 'GBP' }),
    knownDatum(observedAtUtc, { datumId: 'isa-value', tentacleId: 'ISA_AND_INVESTMENTS', metricId: 'isa-current-value', value: 20_000, unit: 'GBP' }),
    knownDatum(observedAtUtc, { datumId: 'pension-value', tentacleId: 'PENSIONS_AND_RETIREMENT_BRIDGE', metricId: 'pension-current-value', value: 90_000, unit: 'GBP' }),
    knownDatum(observedAtUtc, { datumId: 'home-value', tentacleId: 'HOME_MORTGAGE_AND_EQUITY', metricId: 'home-current-value', value: 350_000, unit: 'GBP' }),
    knownDatum(observedAtUtc, { datumId: 'caravan-value', tentacleId: 'CARAVAN_PORTFOLIO', metricId: 'caravan-current-value', value: 50_000, unit: 'GBP' }),
    knownDatum(observedAtUtc, { datumId: 'mortgage-balance', tentacleId: 'HOME_MORTGAGE_AND_EQUITY', metricId: 'mortgage-outstanding', value: 90_000, unit: 'GBP' }),
    knownDatum(observedAtUtc, { datumId: 'debt-balance', tentacleId: 'DEBT_AND_CREDIT', metricId: 'debt-balance', value: 10_000, unit: 'GBP' }),
    knownDatum(observedAtUtc, { datumId: 'employment-income', tentacleId: 'EMPLOYMENT_SALARY_SACRIFICE_AND_TAX', metricId: 'employment-net-income', value: 48_000, unit: 'GBP_PER_YEAR' }),
    knownDatum(observedAtUtc, { datumId: 'caravan-income', tentacleId: 'CARAVAN_PORTFOLIO', metricId: 'caravan-net-income', value: 5_000, unit: 'GBP_PER_YEAR' }),
    knownDatum(observedAtUtc, { datumId: 'household-costs', tentacleId: 'CASH_AND_LIQUIDITY', metricId: 'household-running-costs', value: 30_000, unit: 'GBP_PER_YEAR' }),
    knownDatum(observedAtUtc, { datumId: 'mortgage-service', tentacleId: 'HOME_MORTGAGE_AND_EQUITY', metricId: 'mortgage-debt-service', value: 7_800, unit: 'GBP_PER_YEAR' }),
    knownDatum(observedAtUtc, { datumId: 'consumer-debt-service', tentacleId: 'DEBT_AND_CREDIT', metricId: 'consumer-debt-service', value: 1_200, unit: 'GBP_PER_YEAR' }),
    knownDatum(observedAtUtc, { datumId: 'caravan-costs', tentacleId: 'CARAVAN_PORTFOLIO', metricId: 'caravan-running-costs', value: 10_000, unit: 'GBP_PER_YEAR' }),
    unknownDatum(observedAtUtc, { datumId: 'external-rate', tentacleId: 'EXTERNAL_ENVIRONMENT', metricId: 'external-base-rate', unit: 'PERCENT', ownershipBoundary: 'EXTERNAL_REFERENCE' }),
  ];
}

function model(observedAtUtc = isoNow(), data = completeData(observedAtUtc)) {
  return {
    schemaVersion: OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
    modelId: 'octopus-household-m2-test',
    observedAtUtc,
    data,
  };
}

function component(result, metricId) {
  return result.components.find((entry) => entry.metricId === metricId);
}

test('complete reconciled M1 evidence produces deterministic balance sheet and annual cash flow', () => {
  const observedAtUtc = isoNow();
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc) });

  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.schemaVersion, OCTOPUS_WEALTH_BALANCE_CASHFLOW_SCHEMA_VERSION);
  assert.equal(result.projectionKind, 'READ_ONLY_BALANCE_AND_CASHFLOW');
  assert.match(result.projectionId, /^octopus-wealth-m2-[0-9a-f]{24}$/);
  assert.equal(result.state, 'M2_BALANCE_CASHFLOW_READY');
  assert.equal(result.coverage.requiredMetricCount, OCTOPUS_WEALTH_M2_METRIC_ROLES.length);
  assert.equal(result.coverage.usableMetricCount, OCTOPUS_WEALTH_M2_METRIC_ROLES.length);
  assert.deepEqual(result.coverage.missingMetricIds, []);
  assert.deepEqual(result.coverage.ambiguousMetricIds, []);
  assert.deepEqual(result.coverage.unusableMetricIds, []);

  assert.equal(result.balanceSheet.assetsTotalGbp, 520_000);
  assert.equal(result.balanceSheet.liabilitiesTotalGbp, 100_000);
  assert.equal(result.balanceSheet.netWorthGbp, 420_000);
  assert.equal(result.cashFlow.annualInflowsGbp, 53_000);
  assert.equal(result.cashFlow.annualOutflowsGbp, 49_000);
  assert.equal(result.cashFlow.annualNetCashFlowGbp, 4_000);
  assert.equal(component(result, 'cash-liquid-assets').sourceDatumId, 'cash-assets');
  assert.equal(component(result, 'cash-liquid-assets').tentacleId, 'CASH_AND_LIQUIDITY');
});

test('monthly cash-flow evidence is annualized transparently by exactly twelve', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc).map((datum) => datum.metricId === 'employment-net-income'
    ? knownDatum(observedAtUtc, {
      datumId: 'employment-income-monthly',
      tentacleId: 'EMPLOYMENT_SALARY_SACRIFICE_AND_TAX',
      metricId: 'employment-net-income',
      value: 4_000,
      unit: 'GBP_PER_MONTH',
    })
    : datum);
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });
  const employment = component(result, 'employment-net-income');
  assert.equal(employment.usable, true);
  assert.equal(employment.annualValueGbp, 48_000);
  assert.equal(employment.conversion, 'MONTHLY_X_12');
  assert.equal(result.cashFlow.annualInflowsGbp, 53_000);
});

test('unknown evidence preserves known subtotals but never fabricates complete totals', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc).map((datum) => datum.metricId === 'isa-current-value'
    ? unknownDatum(observedAtUtc, {
      datumId: 'isa-value-unknown',
      tentacleId: 'ISA_AND_INVESTMENTS',
      metricId: 'isa-current-value',
      unit: 'GBP',
    })
    : datum);
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'M2_PARTIAL_EVIDENCE');
  assert.equal(component(result, 'isa-current-value').status, 'UNKNOWN_VALUE');
  assert.equal(result.balanceSheet.knownAssetSubtotalGbp, 500_000);
  assert.equal(result.balanceSheet.assetsComplete, false);
  assert.equal(result.balanceSheet.assetsTotalGbp, null);
  assert.equal(result.balanceSheet.netWorthGbp, null);
  assert.deepEqual(result.coverage.unusableMetricIds, ['isa-current-value']);
});

test('projected values stay visible as projected-only and cannot enter current totals', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc).map((datum) => datum.metricId === 'pension-current-value'
    ? knownDatum(observedAtUtc, {
      datumId: 'pension-projection',
      tentacleId: 'PENSIONS_AND_RETIREMENT_BRIDGE',
      metricId: 'pension-current-value',
      value: 100_000,
      unit: 'GBP',
      epistemicStatus: 'PROJECTED',
    })
    : datum);
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });

  assert.equal(result.state, 'M2_PARTIAL_EVIDENCE');
  assert.equal(component(result, 'pension-current-value').status, 'PROJECTED_ONLY');
  assert.equal(result.balanceSheet.assetsTotalGbp, null);
  assert.equal(result.balanceSheet.netWorthGbp, null);
});

test('multiple M1 records for one M2 metric fail closed against double counting', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc);
  data.push(knownDatum(observedAtUtc, {
    datumId: 'cash-assets-spouse',
    tentacleId: 'CASH_AND_LIQUIDITY',
    metricId: 'cash-liquid-assets',
    value: 5_000,
    unit: 'GBP',
    ownershipBoundary: 'SPOUSE',
  }));
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'M2_RECONCILIATION_REQUIRED');
  assert.equal(component(result, 'cash-liquid-assets').status, 'AMBIGUOUS_MULTIPLE_RECORDS');
  assert.deepEqual(result.coverage.ambiguousMetricIds, ['cash-liquid-assets']);
  assert.equal(result.balanceSheet.assetsTotalGbp, null);
  assert.equal(result.balanceSheet.netWorthGbp, null);
});

test('a correctly named metric in the wrong M1 tentacle cannot satisfy an M2 role', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc).map((datum) => datum.metricId === 'home-current-value'
    ? knownDatum(observedAtUtc, {
      datumId: 'misrouted-home-value',
      tentacleId: 'ISA_AND_INVESTMENTS',
      metricId: 'home-current-value',
      value: 350_000,
      unit: 'GBP',
    })
    : datum);
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'M2_RECONCILIATION_REQUIRED');
  assert.equal(component(result, 'home-current-value').status, 'TENTACLE_MISMATCH');
  assert.equal(component(result, 'home-current-value').tentacleId, 'HOME_MORTGAGE_AND_EQUITY');
  assert.deepEqual(result.coverage.unusableMetricIds, ['home-current-value']);
  assert.equal(result.balanceSheet.assetsTotalGbp, null);
  assert.equal(result.balanceSheet.netWorthGbp, null);
});

test('stale M1 projection truth is rejected before M2 arithmetic', () => {
  const observedAtUtc = isoNow(-2 * 60 * 60 * 1000);
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc) });

  assert.equal(result.valid, false);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.match(result.validationErrors.join('\n'), /m1:projection-not-fresh/);
  assert.equal(result.balanceSheet.netWorthGbp, null);
  assert.equal(result.cashFlow.annualNetCashFlowGbp, null);
});

test('all eight M1 tentacles must be represented before M2 derives a household view', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc).filter((datum) => datum.tentacleId !== 'EXTERNAL_ENVIRONMENT');
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });

  assert.equal(result.valid, false);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.match(result.validationErrors.join('\n'), /all-eight-tentacles-must-be-represented/);
});

test('negative asset or liability semantics require reconciliation instead of sign inference', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc).map((datum) => datum.metricId === 'debt-balance'
    ? knownDatum(observedAtUtc, {
      datumId: 'debt-negative',
      tentacleId: 'DEBT_AND_CREDIT',
      metricId: 'debt-balance',
      value: -10_000,
      unit: 'GBP',
    })
    : datum);
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'M2_RECONCILIATION_REQUIRED');
  assert.equal(component(result, 'debt-balance').status, 'VALUE_NOT_NON_NEGATIVE');
  assert.equal(result.balanceSheet.liabilitiesTotalGbp, null);
  assert.equal(result.balanceSheet.netWorthGbp, null);
});

test('ambiguous M1 seed metrics are not reinterpreted as M2 assets or liabilities', () => {
  const observedAtUtc = isoNow();
  const data = completeData(observedAtUtc).map((datum) => datum.metricId === 'home-current-value'
    ? knownDatum(observedAtUtc, {
      datumId: 'home-position-ambiguous',
      tentacleId: 'HOME_MORTGAGE_AND_EQUITY',
      metricId: 'home-mortgage-position',
      value: 260_000,
      unit: 'GBP',
    })
    : datum);
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model(observedAtUtc, data) });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'M2_PARTIAL_EVIDENCE');
  assert.equal(component(result, 'home-current-value').status, 'MISSING');
  assert.deepEqual(result.coverage.missingMetricIds, ['home-current-value']);
  assert.equal(result.balanceSheet.assetsTotalGbp, null);
});

test('outer accessor, custom shape and revoked nested model fail closed without invoking caller getters', () => {
  let getterCalls = 0;
  const accessorInput = {};
  Object.defineProperty(accessorInput, 'householdModel', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return model();
    },
  });
  const accessorResult = buildOctopusWealthBalanceCashflowV1(accessorInput);
  assert.equal(accessorResult.valid, false);
  assert.equal(getterCalls, 0);

  const extraResult = buildOctopusWealthBalanceCashflowV1({ householdModel: model(), extraAuthority: true });
  assert.equal(extraResult.valid, false);
  assert.match(extraResult.validationErrors.join('\n'), /input-must-contain-one-own-data-householdModel/);

  const target = model();
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  const proxyResult = buildOctopusWealthBalanceCashflowV1({ householdModel: proxy });
  assert.equal(proxyResult.valid, false);
  assert.equal(proxyResult.state, 'SAFE_HOLD');
});

test('M2 projection is read-only arithmetic and exposes no financial or runtime authority', () => {
  const result = buildOctopusWealthBalanceCashflowV1({ householdModel: model() });
  assert.equal(result.valid, true);
  assert.deepEqual(result.authority, {
    financialAdviceAllowed: false,
    recommendationAllowed: false,
    tradeAllowed: false,
    transferAllowed: false,
    borrowingAllowed: false,
    mortgageApplicationAllowed: false,
    pensionTransferAllowed: false,
    purchaseAllowed: false,
    credentialUseAllowed: false,
    providerWriteAllowed: false,
    sourceMutationAllowed: false,
    approvalAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    spendAllowed: false,
    runtimeMutationAllowed: false,
  });
});
