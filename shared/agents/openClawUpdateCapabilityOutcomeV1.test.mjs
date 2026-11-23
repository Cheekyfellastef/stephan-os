import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOpenClawUpdateCapabilityLedgerV1,
} from './openClawUpdateCapabilityLedgerV1.mjs';
import {
  evaluateOpenClawUpdateCapabilityOutcomeV1,
  OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA,
  OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS,
  OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
} from './openClawUpdateCapabilityOutcomeV1.mjs';

function capability(overrides = {}) {
  return {
    capabilityId: 'openclaw.repo-scout',
    purpose: 'Read a bounded repository identity and return canonical evidence.',
    currentImplementation: 'plugin.repo-scout.v1',
    candidateImplementation: 'plugin.repo-scout.v2',
    origin: 'stephanos-extension',
    candidateOrigin: 'stephanos-extension',
    protected: true,
    qualificationRefs: ['qualification.oc1.current'],
    tests: ['test.oc1.repo-scout'],
    dependencies: ['shared.workspace'],
    migrationPolicy: 'Preserve the bounded task contract across upstream updates.',
    replacementCriteria: 'Candidate must pass the same acceptance contract without authority widening.',
    lastQualifiedVersion: '1.2.3',
    updateDisposition: 'IMPROVE',
    evidenceRefs: ['proof.oc1.candidate'],
    affectedTaskClasses: ['OC1_REPOSITORY_SCOUT'],
    ...overrides,
  };
}

function ledger(capabilities = [capability()]) {
  return buildOpenClawUpdateCapabilityLedgerV1({
    currentVersion: '1.2.3',
    targetVersion: '1.2.4',
    capabilities,
  });
}

function comparison(overrides = {}) {
  return {
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA,
    capabilityId: 'openclaw.repo-scout',
    testResults: [{
      schemaVersion: OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
      testId: 'test.oc1.repo-scout',
      baselineVerdict: 'PASS',
      candidateVerdict: 'PASS',
      proofRef: 'proof.oc1.candidate',
    }],
    ...overrides,
  };
}

test('accepts only when every protected capability passes the same required acceptance tests', () => {
  const result = evaluateOpenClawUpdateCapabilityOutcomeV1({
    capabilityLedger: ledger(),
    comparisons: [comparison()],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.EQUAL_OR_BETTER);
  assert.equal(result.updatePromotionAllowed, true);
  assert.deepEqual(result.requiredQualificationReplay, ['OC1_REPOSITORY_SCOUT']);
  assert.equal(result.acceptedCapabilities[0].verdict, 'EQUAL_OR_BETTER_FOR_REQUIRED_ACCEPTANCE_TESTS');
  assert.equal(result.authority.updateExecutionAllowed, false);
  assert.equal(result.authority.providerQualificationAllowed, false);
});

test('candidate regression blocks update promotion', () => {
  const failed = comparison({
    testResults: [{
      schemaVersion: OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
      testId: 'test.oc1.repo-scout',
      baselineVerdict: 'PASS',
      candidateVerdict: 'FAIL',
      proofRef: 'proof.oc1.candidate',
    }],
  });
  const result = evaluateOpenClawUpdateCapabilityOutcomeV1({
    capabilityLedger: ledger(),
    comparisons: [failed],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.REGRESSION);
  assert.equal(result.updatePromotionAllowed, false);
  assert.match(result.blockers.join('\n'), /CANDIDATE_REGRESSION:openclaw\.repo-scout:test\.oc1\.repo-scout/);
});

test('missing acceptance-test coverage fails closed', () => {
  const wider = capability({ tests: ['test.oc1.repo-scout', 'test.oc1.identity'] });
  const result = evaluateOpenClawUpdateCapabilityOutcomeV1({
    capabilityLedger: ledger([wider]),
    comparisons: [comparison()],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.BLOCK_UPDATE);
  assert.match(result.blockers.join('\n'), /CAPABILITY_TEST_ESTATE_MISMATCH/);
});

test('proof must be bound to the capability ledger evidence estate', () => {
  const forged = comparison({
    testResults: [{
      schemaVersion: OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
      testId: 'test.oc1.repo-scout',
      baselineVerdict: 'PASS',
      candidateVerdict: 'PASS',
      proofRef: 'proof.caller-invented',
    }],
  });
  const result = evaluateOpenClawUpdateCapabilityOutcomeV1({
    capabilityLedger: ledger(),
    comparisons: [forged],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.BLOCK_UPDATE);
  assert.match(result.blockers.join('\n'), /CAPABILITY_PROOF_NOT_LEDGER_BOUND/);
});

test('accessor-bearing comparison input is rejected without invocation', () => {
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'schemaVersion', {
    enumerable: true,
    get() { invoked = true; return OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA; },
  });
  Object.assign(hostile, { capabilityId: 'openclaw.repo-scout', testResults: [] });
  const result = evaluateOpenClawUpdateCapabilityOutcomeV1({
    capabilityLedger: ledger(),
    comparisons: [hostile],
  });
  assert.equal(invoked, false);
  assert.equal(result.status, OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.BLOCK_UPDATE);
  assert.match(result.blockers.join('\n'), /CAPABILITY_COMPARISON_INVALID/);
});
