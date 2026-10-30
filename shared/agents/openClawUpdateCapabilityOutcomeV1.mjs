import {
  OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA,
  OPENCLAW_UPDATE_DISPOSITION,
} from './openClawUpdateCapabilityLedgerV1.mjs';

export const OPENCLAW_UPDATE_CAPABILITY_OUTCOME_SCHEMA = 'stephanos.openclaw-update-capability-outcome.v1';
export const OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA = 'stephanos.openclaw-update-capability-comparison.v1';
export const OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA = 'stephanos.openclaw-update-capability-test-result.v1';
export const OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS = Object.freeze({
  EQUAL_OR_BETTER: 'CAPABILITY_OUTCOME_EQUAL_OR_BETTER',
  BLOCK_UPDATE: 'CAPABILITY_OUTCOME_BLOCK_UPDATE',
  REGRESSION: 'CAPABILITY_REGRESSION_BLOCKS_UPDATE',
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:/+-]{0,127}$/i;
const MAX_CAPABILITIES = 128;
const MAX_TESTS = 64;
const INPUT_KEYS = Object.freeze(['capabilityLedger', 'comparisons']);
const COMPARISON_KEYS = Object.freeze(['schemaVersion', 'capabilityId', 'testResults']);
const TEST_RESULT_KEYS = Object.freeze(['schemaVersion', 'testId', 'baselineVerdict', 'candidateVerdict', 'proofRef']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function dataRecord(value, expectedKeys = null) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const actual = keys.map(String).sort();
    if (expectedKeys) {
      const wanted = [...expectedKeys].sort();
      if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = {};
    for (const key of actual) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function denseArray(value, maxItems) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maxItems) return null;
    const allowed = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      output.push(descriptor.value);
    }
    return output;
  } catch {
    return null;
  }
}

function blocked(blockers, status = OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.BLOCK_UPDATE) {
  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_OUTCOME_SCHEMA,
    status,
    blockers: Object.freeze([...new Set(blockers)].sort()),
    acceptedCapabilities: Object.freeze([]),
    requiredQualificationReplay: Object.freeze([]),
    updatePromotionAllowed: false,
    authority: Object.freeze({
      updateExecutionAllowed: false,
      runtimeMutationAllowed: false,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      providerQualificationAllowed: false,
    }),
  });
}

function normalizeTestResult(raw) {
  const record = dataRecord(raw, TEST_RESULT_KEYS);
  if (!record) return null;
  const testId = safeId(record.testId);
  const proofRef = safeId(record.proofRef);
  const baselineVerdict = text(record.baselineVerdict);
  const candidateVerdict = text(record.candidateVerdict);
  if (text(record.schemaVersion) !== OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA
    || !testId
    || !proofRef
    || !['PASS', 'FAIL'].includes(baselineVerdict)
    || !['PASS', 'FAIL'].includes(candidateVerdict)) return null;
  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
    testId,
    baselineVerdict,
    candidateVerdict,
    proofRef,
  });
}

function normalizeComparison(raw) {
  const record = dataRecord(raw, COMPARISON_KEYS);
  if (!record) return null;
  const capabilityId = safeId(record.capabilityId);
  const tests = denseArray(record.testResults, MAX_TESTS);
  if (text(record.schemaVersion) !== OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA
    || !capabilityId
    || !tests
    || tests.length === 0) return null;
  const normalized = tests.map(normalizeTestResult);
  if (normalized.some((entry) => !entry)) return null;
  const ids = normalized.map((entry) => entry.testId);
  if (new Set(ids).size !== ids.length) return null;
  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA,
    capabilityId,
    testResults: Object.freeze(normalized.sort((a, b) => a.testId.localeCompare(b.testId))),
  });
}

export function evaluateOpenClawUpdateCapabilityOutcomeV1(input = {}) {
  const snapshot = dataRecord(input, INPUT_KEYS);
  if (!snapshot) return blocked(['CAPABILITY_OUTCOME_SCHEMA_INVALID']);
  const ledger = dataRecord(snapshot.capabilityLedger);
  if (!ledger
    || text(ledger.schemaVersion) !== OPENCLAW_UPDATE_CAPABILITY_LEDGER_SCHEMA
    || ledger.updateAllowed !== true
    || text(ledger.verdict) !== 'CAPABILITY_LEDGER_READY_FOR_CANDIDATE_PROOF') {
    return blocked(['CAPABILITY_LEDGER_NOT_READY']);
  }

  const capabilityRows = denseArray(ledger.capabilities, MAX_CAPABILITIES);
  const comparisonRows = denseArray(snapshot.comparisons, MAX_CAPABILITIES);
  if (!capabilityRows || !comparisonRows) return blocked(['CAPABILITY_OR_COMPARISON_ESTATE_INVALID']);

  const protectedCapabilities = capabilityRows.filter((row) => dataRecord(row)?.protected === true);
  if (protectedCapabilities.length === 0) return blocked(['NO_PROTECTED_CAPABILITIES']);

  const comparisons = comparisonRows.map(normalizeComparison);
  if (comparisons.some((entry) => !entry)) return blocked(['CAPABILITY_COMPARISON_INVALID']);
  const comparisonMap = new Map();
  for (const comparison of comparisons) {
    if (comparisonMap.has(comparison.capabilityId)) return blocked([`DUPLICATE_CAPABILITY_COMPARISON:${comparison.capabilityId}`]);
    comparisonMap.set(comparison.capabilityId, comparison);
  }

  const accepted = [];
  const blockers = [];
  let regression = false;
  for (const raw of protectedCapabilities) {
    const capability = dataRecord(raw);
    const capabilityId = safeId(capability?.capabilityId);
    if (!capabilityId) {
      blockers.push('PROTECTED_CAPABILITY_ID_INVALID');
      continue;
    }
    if (text(capability.updateDisposition) === OPENCLAW_UPDATE_DISPOSITION.BLOCK_UPDATE) {
      blockers.push(`CAPABILITY_BLOCKS_UPDATE:${capabilityId}`);
      continue;
    }

    const expectedTests = denseArray(capability.tests, MAX_TESTS)?.map(safeId) || null;
    const allowedProofRefs = [
      ...(denseArray(capability.evidenceRefs, MAX_TESTS) || []).map(safeId),
      ...(denseArray(capability.qualificationRefs, MAX_TESTS) || []).map(safeId),
    ].filter(Boolean);
    if (!expectedTests || expectedTests.length === 0 || new Set(expectedTests).size !== expectedTests.length) {
      blockers.push(`CAPABILITY_ACCEPTANCE_TESTS_INVALID:${capabilityId}`);
      continue;
    }
    if (allowedProofRefs.length === 0) {
      blockers.push(`CAPABILITY_PROOF_ESTATE_EMPTY:${capabilityId}`);
      continue;
    }

    const comparison = comparisonMap.get(capabilityId);
    if (!comparison) {
      blockers.push(`CAPABILITY_COMPARISON_MISSING:${capabilityId}`);
      continue;
    }
    const observedTests = comparison.testResults.map((entry) => entry.testId).sort();
    const wantedTests = [...expectedTests].sort();
    if (observedTests.length !== wantedTests.length || observedTests.some((entry, index) => entry !== wantedTests[index])) {
      blockers.push(`CAPABILITY_TEST_ESTATE_MISMATCH:${capabilityId}`);
      continue;
    }

    const invalidProof = comparison.testResults.find((entry) => !allowedProofRefs.includes(entry.proofRef));
    if (invalidProof) {
      blockers.push(`CAPABILITY_PROOF_NOT_LEDGER_BOUND:${capabilityId}:${invalidProof.testId}`);
      continue;
    }
    const baselineFailure = comparison.testResults.find((entry) => entry.baselineVerdict !== 'PASS');
    if (baselineFailure) {
      blockers.push(`BASELINE_ACCEPTANCE_NOT_PROVEN:${capabilityId}:${baselineFailure.testId}`);
      continue;
    }
    const candidateFailure = comparison.testResults.find((entry) => entry.candidateVerdict !== 'PASS');
    if (candidateFailure) {
      regression = true;
      blockers.push(`CANDIDATE_REGRESSION:${capabilityId}:${candidateFailure.testId}`);
      continue;
    }
    accepted.push(Object.freeze({
      capabilityId,
      updateDisposition: text(capability.updateDisposition),
      testCount: comparison.testResults.length,
      verdict: 'EQUAL_OR_BETTER_FOR_REQUIRED_ACCEPTANCE_TESTS',
    }));
  }

  for (const comparison of comparisons) {
    if (!protectedCapabilities.some((row) => safeId(dataRecord(row)?.capabilityId) === comparison.capabilityId)) {
      blockers.push(`UNREQUESTED_CAPABILITY_COMPARISON:${comparison.capabilityId}`);
    }
  }

  if (blockers.length) {
    return blocked(
      blockers,
      regression
        ? OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.REGRESSION
        : OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.BLOCK_UPDATE,
    );
  }

  const requiredQualificationReplay = denseArray(ledger.requiredQualificationReplay, 16) || [];
  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_OUTCOME_SCHEMA,
    status: OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.EQUAL_OR_BETTER,
    blockers: Object.freeze([]),
    acceptedCapabilities: Object.freeze(accepted.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))),
    requiredQualificationReplay: Object.freeze([...requiredQualificationReplay]),
    updatePromotionAllowed: true,
    authority: Object.freeze({
      updateExecutionAllowed: false,
      runtimeMutationAllowed: false,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      providerQualificationAllowed: false,
    }),
  });
}
