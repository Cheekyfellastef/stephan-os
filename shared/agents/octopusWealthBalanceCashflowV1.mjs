import { createHash } from 'node:crypto';

import {
  OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION,
  buildOctopusWealthHouseholdModelV1,
} from './octopusWealthHouseholdModelV1.mjs';

export const OCTOPUS_WEALTH_BALANCE_CASHFLOW_SCHEMA_VERSION = 'stephanos.octopus-wealth-balance-cashflow.v1';

export const OCTOPUS_WEALTH_M2_METRIC_ROLES = Object.freeze([
  Object.freeze({ tentacleId: 'CASH_AND_LIQUIDITY', metricId: 'cash-liquid-assets', section: 'ASSET', units: Object.freeze(['GBP']) }),
  Object.freeze({ tentacleId: 'ISA_AND_INVESTMENTS', metricId: 'isa-current-value', section: 'ASSET', units: Object.freeze(['GBP']) }),
  Object.freeze({ tentacleId: 'PENSIONS_AND_RETIREMENT_BRIDGE', metricId: 'pension-current-value', section: 'ASSET', units: Object.freeze(['GBP']) }),
  Object.freeze({ tentacleId: 'HOME_MORTGAGE_AND_EQUITY', metricId: 'home-current-value', section: 'ASSET', units: Object.freeze(['GBP']) }),
  Object.freeze({ tentacleId: 'CARAVAN_PORTFOLIO', metricId: 'caravan-current-value', section: 'ASSET', units: Object.freeze(['GBP']) }),
  Object.freeze({ tentacleId: 'HOME_MORTGAGE_AND_EQUITY', metricId: 'mortgage-outstanding', section: 'LIABILITY', units: Object.freeze(['GBP']) }),
  Object.freeze({ tentacleId: 'DEBT_AND_CREDIT', metricId: 'debt-balance', section: 'LIABILITY', units: Object.freeze(['GBP']) }),
  Object.freeze({ tentacleId: 'EMPLOYMENT_SALARY_SACRIFICE_AND_TAX', metricId: 'employment-net-income', section: 'INFLOW', units: Object.freeze(['GBP_PER_YEAR', 'GBP_PER_MONTH']) }),
  Object.freeze({ tentacleId: 'CARAVAN_PORTFOLIO', metricId: 'caravan-net-income', section: 'INFLOW', units: Object.freeze(['GBP_PER_YEAR', 'GBP_PER_MONTH']) }),
  Object.freeze({ tentacleId: 'CASH_AND_LIQUIDITY', metricId: 'household-running-costs', section: 'OUTFLOW', units: Object.freeze(['GBP_PER_YEAR', 'GBP_PER_MONTH']) }),
  Object.freeze({ tentacleId: 'HOME_MORTGAGE_AND_EQUITY', metricId: 'mortgage-debt-service', section: 'OUTFLOW', units: Object.freeze(['GBP_PER_YEAR', 'GBP_PER_MONTH']) }),
  Object.freeze({ tentacleId: 'DEBT_AND_CREDIT', metricId: 'consumer-debt-service', section: 'OUTFLOW', units: Object.freeze(['GBP_PER_YEAR', 'GBP_PER_MONTH']) }),
  Object.freeze({ tentacleId: 'CARAVAN_PORTFOLIO', metricId: 'caravan-running-costs', section: 'OUTFLOW', units: Object.freeze(['GBP_PER_YEAR', 'GBP_PER_MONTH']) }),
]);

const INPUT_KEYS = Object.freeze(['householdModel']);
const REQUIRED_TENTACLE_COUNT = 8;
const USABLE_EPISTEMIC_STATES = new Set(['ACTUAL', 'ESTIMATED']);
const USABLE_FRESHNESS = new Set(['FRESH', 'AGING']);

const AUTHORITY = Object.freeze({
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

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function captureHouseholdModel(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return null;
    if (JSON.stringify(keys.sort(compareCodePoints)) !== JSON.stringify([...INPUT_KEYS].sort(compareCodePoints))) return null;
    const descriptor = descriptors.householdModel;
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return null;
    return descriptor.value;
  } catch {
    return null;
  }
}

function freezeList(values) {
  return Object.freeze([...values]);
}

function safeHold(errors, source = {}) {
  return Object.freeze({
    schemaVersion: OCTOPUS_WEALTH_BALANCE_CASHFLOW_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_BALANCE_AND_CASHFLOW',
    projectionId: '',
    sourceProjectionId: typeof source.projectionId === 'string' ? source.projectionId : '',
    sourceModelId: typeof source.modelId === 'string' ? source.modelId : '',
    sourceObservedAtUtc: typeof source.observedAtUtc === 'string' ? source.observedAtUtc : '',
    evaluatedAtUtc: typeof source.evaluatedAtUtc === 'string' ? source.evaluatedAtUtc : '',
    state: 'SAFE_HOLD',
    valid: false,
    validationErrors: freezeList(new Set(errors)),
    components: Object.freeze([]),
    balanceSheet: Object.freeze({
      knownAssetSubtotalGbp: 0,
      assetsComplete: false,
      assetsTotalGbp: null,
      knownLiabilitySubtotalGbp: 0,
      liabilitiesComplete: false,
      liabilitiesTotalGbp: null,
      netWorthGbp: null,
    }),
    cashFlow: Object.freeze({
      knownAnnualInflowSubtotalGbp: 0,
      inflowsComplete: false,
      annualInflowsGbp: null,
      knownAnnualOutflowSubtotalGbp: 0,
      outflowsComplete: false,
      annualOutflowsGbp: null,
      annualNetCashFlowGbp: null,
    }),
    coverage: Object.freeze({
      requiredMetricCount: OCTOPUS_WEALTH_M2_METRIC_ROLES.length,
      usableMetricCount: 0,
      missingMetricIds: freezeList(OCTOPUS_WEALTH_M2_METRIC_ROLES.map((role) => role.metricId)),
      ambiguousMetricIds: Object.freeze([]),
      unusableMetricIds: Object.freeze([]),
    }),
    authority: AUTHORITY,
  });
}

function annualize(value, unit) {
  if (unit === 'GBP_PER_YEAR') return Object.freeze({ annualValueGbp: value, conversion: 'NONE' });
  if (unit === 'GBP_PER_MONTH') return Object.freeze({ annualValueGbp: value * 12, conversion: 'MONTHLY_X_12' });
  return null;
}

function emptyComponent(role, status) {
  return Object.freeze({
    tentacleId: role.tentacleId,
    metricId: role.metricId,
    section: role.section,
    status,
    usable: false,
    valueGbp: null,
    annualValueGbp: null,
    conversion: 'NONE',
    sourceDatumId: '',
    sourceRef: '',
    epistemicStatus: 'UNKNOWN',
    freshness: 'UNKNOWN',
    ownershipBoundary: 'UNKNOWN',
  });
}

function componentForRole(role, sourceRecords) {
  const metricMatches = sourceRecords.filter((record) => record.metricId === role.metricId);
  if (metricMatches.length === 0) return emptyComponent(role, 'MISSING');
  if (metricMatches.some((record) => record.tentacleId !== role.tentacleId)) {
    return emptyComponent(role, 'TENTACLE_MISMATCH');
  }

  const matches = metricMatches.filter((record) => record.tentacleId === role.tentacleId);
  if (matches.length !== 1) return emptyComponent(role, 'AMBIGUOUS_MULTIPLE_RECORDS');

  const record = matches[0];
  let status = 'USABLE';
  if (!USABLE_EPISTEMIC_STATES.has(record.epistemicStatus)) {
    status = record.epistemicStatus === 'PROJECTED' ? 'PROJECTED_ONLY' : 'UNKNOWN_VALUE';
  } else if (!USABLE_FRESHNESS.has(record.freshness)) {
    status = 'STALE_EVIDENCE';
  } else if (!role.units.includes(record.unit)) {
    status = 'UNIT_MISMATCH';
  } else if (typeof record.value !== 'number' || !Number.isFinite(record.value) || record.value < 0) {
    status = 'VALUE_NOT_NON_NEGATIVE';
  }

  let valueGbp = null;
  let annualValueGbp = null;
  let conversion = 'NONE';
  if (status === 'USABLE') {
    if (role.section === 'ASSET' || role.section === 'LIABILITY') {
      valueGbp = record.value;
    } else {
      const annualized = annualize(record.value, record.unit);
      if (!annualized) status = 'UNIT_MISMATCH';
      else {
        annualValueGbp = annualized.annualValueGbp;
        conversion = annualized.conversion;
      }
    }
  }

  return Object.freeze({
    tentacleId: role.tentacleId,
    metricId: role.metricId,
    section: role.section,
    status,
    usable: status === 'USABLE',
    valueGbp,
    annualValueGbp,
    conversion,
    sourceDatumId: record.datumId,
    sourceRef: record.sourceRef,
    epistemicStatus: record.epistemicStatus,
    freshness: record.freshness,
    ownershipBoundary: record.ownershipBoundary,
  });
}

function sectionSummary(components, section) {
  const selected = components.filter((component) => component.section === section);
  const complete = selected.every((component) => component.usable);
  const subtotal = selected.reduce((sum, component) => {
    const value = section === 'ASSET' || section === 'LIABILITY'
      ? component.valueGbp
      : component.annualValueGbp;
    return sum + (component.usable ? value : 0);
  }, 0);
  return Object.freeze({ selected, complete, subtotal });
}

export function buildOctopusWealthBalanceCashflowV1(input = {}) {
  const householdModel = captureHouseholdModel(input);
  if (householdModel === null) return safeHold(['input-must-contain-one-own-data-householdModel']);

  const source = buildOctopusWealthHouseholdModelV1(householdModel);
  if (!source.valid) return safeHold(source.validationErrors.map((error) => `m1:${error}`), source);
  if (source.schemaVersion !== OCTOPUS_WEALTH_HOUSEHOLD_MODEL_SCHEMA_VERSION) {
    return safeHold(['m1:schema-version-mismatch'], source);
  }
  if (source.projectionKind !== 'READ_ONLY_EVIDENCE_COVERAGE') {
    return safeHold(['m1:projection-kind-mismatch'], source);
  }
  if (source.projectionFreshness !== 'FRESH') {
    return safeHold(['m1:projection-not-fresh'], source);
  }
  if (source.evidenceCoverage?.representedTentacleCount !== REQUIRED_TENTACLE_COUNT) {
    return safeHold(['m1:all-eight-tentacles-must-be-represented'], source);
  }
  if (source.evidenceCoverage?.unresolvedOwnershipDatumCount !== 0) {
    return safeHold(['m1:known-evidence-ownership-unresolved'], source);
  }

  const components = OCTOPUS_WEALTH_M2_METRIC_ROLES.map((role) => componentForRole(role, source.data));
  const assets = sectionSummary(components, 'ASSET');
  const liabilities = sectionSummary(components, 'LIABILITY');
  const inflows = sectionSummary(components, 'INFLOW');
  const outflows = sectionSummary(components, 'OUTFLOW');

  const balanceSheet = Object.freeze({
    knownAssetSubtotalGbp: assets.subtotal,
    assetsComplete: assets.complete,
    assetsTotalGbp: assets.complete ? assets.subtotal : null,
    knownLiabilitySubtotalGbp: liabilities.subtotal,
    liabilitiesComplete: liabilities.complete,
    liabilitiesTotalGbp: liabilities.complete ? liabilities.subtotal : null,
    netWorthGbp: assets.complete && liabilities.complete ? assets.subtotal - liabilities.subtotal : null,
  });

  const cashFlow = Object.freeze({
    knownAnnualInflowSubtotalGbp: inflows.subtotal,
    inflowsComplete: inflows.complete,
    annualInflowsGbp: inflows.complete ? inflows.subtotal : null,
    knownAnnualOutflowSubtotalGbp: outflows.subtotal,
    outflowsComplete: outflows.complete,
    annualOutflowsGbp: outflows.complete ? outflows.subtotal : null,
    annualNetCashFlowGbp: inflows.complete && outflows.complete ? inflows.subtotal - outflows.subtotal : null,
  });

  const missingMetricIds = components.filter((component) => component.status === 'MISSING').map((component) => component.metricId);
  const ambiguousMetricIds = components.filter((component) => component.status === 'AMBIGUOUS_MULTIPLE_RECORDS').map((component) => component.metricId);
  const unusableMetricIds = components
    .filter((component) => !component.usable && !['MISSING', 'AMBIGUOUS_MULTIPLE_RECORDS'].includes(component.status))
    .map((component) => component.metricId);
  const usableMetricCount = components.filter((component) => component.usable).length;

  let state;
  if (ambiguousMetricIds.length > 0 || unusableMetricIds.some((metricId) => {
    const component = components.find((entry) => entry.metricId === metricId);
    return ['TENTACLE_MISMATCH', 'UNIT_MISMATCH', 'VALUE_NOT_NON_NEGATIVE', 'STALE_EVIDENCE'].includes(component.status);
  })) {
    state = 'M2_RECONCILIATION_REQUIRED';
  } else if (assets.complete && liabilities.complete && inflows.complete && outflows.complete) {
    state = 'M2_BALANCE_CASHFLOW_READY';
  } else {
    state = 'M2_PARTIAL_EVIDENCE';
  }

  const identityCore = {
    schemaVersion: OCTOPUS_WEALTH_BALANCE_CASHFLOW_SCHEMA_VERSION,
    sourceProjectionId: source.projectionId,
    components,
    balanceSheet,
    cashFlow,
  };

  return Object.freeze({
    schemaVersion: OCTOPUS_WEALTH_BALANCE_CASHFLOW_SCHEMA_VERSION,
    projectionKind: 'READ_ONLY_BALANCE_AND_CASHFLOW',
    projectionId: `octopus-wealth-m2-${stableHash(identityCore).slice(0, 24)}`,
    sourceProjectionId: source.projectionId,
    sourceModelId: source.modelId,
    sourceObservedAtUtc: source.observedAtUtc,
    evaluatedAtUtc: source.evaluatedAtUtc,
    state,
    valid: true,
    validationErrors: Object.freeze([]),
    components: Object.freeze(components),
    balanceSheet,
    cashFlow,
    coverage: Object.freeze({
      requiredMetricCount: OCTOPUS_WEALTH_M2_METRIC_ROLES.length,
      usableMetricCount,
      missingMetricIds: freezeList(missingMetricIds),
      ambiguousMetricIds: freezeList(ambiguousMetricIds),
      unusableMetricIds: freezeList(unusableMetricIds),
    }),
    authority: AUTHORITY,
  });
}
