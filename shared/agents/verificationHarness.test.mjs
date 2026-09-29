import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFICATION_HARNESS_SCHEMA_VERSION,
  VERIFICATION_STATUS,
  aggregateVerificationResults,
  buildVerificationHarnessContract,
  createVerifierResult,
  validateVerifierResult,
} from './verificationHarness.mjs';

test('verification harness contract exposes required verifier types and guardrails', () => {
  const contract = buildVerificationHarnessContract();

  assert.equal(contract.schemaVersion, VERIFICATION_HARNESS_SCHEMA_VERSION);
  for (const verifier of ['BuildVerifier', 'BackendVerifier', 'FrontendVerifier', 'WorkerVerifier', 'OpenClawVerifier', 'GitVerifier', 'PortVerifier', 'ProcessVerifier', 'HealthEndpointVerifier', 'RelayVerifier']) {
    assert.equal(contract.allowedVerifierTypes.includes(verifier), true);
  }
  assert.equal(contract.guardrails.arbitraryShellAllowed, false);
  assert.equal(contract.guardrails.arbitraryPowerShellAllowed, false);
  assert.equal(contract.guardrails.mutationAllowedByDefault, false);
  assert.equal(contract.guardrails.secretOutputAllowed, false);
  assert.equal(contract.guardrails.successWithoutEvidenceAllowed, false);
  assert.equal(contract.finalVerdict, 'VERIFICATION_HARNESS_CONTRACT_READY');
});

test('valid PASS verifier result preserves deterministic evidence and proof refs', () => {
  const result = createVerifierResult({
    checkId: 'backend-health',
    verifierType: 'BackendVerifier',
    status: 'PASS',
    target: 'http://127.0.0.1:8787/api/health',
    evidence: ['HTTP=200', 'ok=true'],
    durationMs: 42,
    timestampUtc: '2026-06-28T18:30:00Z',
    exitCode: 0,
    commandOutputHash: 'a'.repeat(64),
    proofRefs: ['proof/verification/backend-health.json'],
  });

  assert.equal(result.status, VERIFICATION_STATUS.PASS);
  assert.equal(result.reason, '');
  assert.deepEqual(result.evidence, ['HTTP=200', 'ok=true']);
  assert.deepEqual(result.proofRefs, ['proof/verification/backend-health.json']);
  assert.equal(validateVerifierResult(result).finalVerdict, 'VERIFIER_RESULT_PASS');
});

test('FAIL verifier result requires a concise reason', () => {
  const result = createVerifierResult({
    checkId: 'worker-health',
    verifierType: 'WorkerVerifier',
    status: 'FAIL',
    target: 'Stephanos Mission Orchestrator Worker',
    evidence: ['WORKER_RECOVERED=False'],
    reason: 'worker did not recover after process kill',
  });

  assert.equal(result.status, VERIFICATION_STATUS.FAIL);
  assert.equal(result.reason, 'worker did not recover after process kill');
  assert.equal(validateVerifierResult(result).valid, true);
});

test('unsafe evidence and proof refs are sanitized from created verifier results', () => {
  const result = createVerifierResult({
    checkId: 'unsafe-output',
    verifierType: 'OpenClawVerifier',
    status: 'PASS',
    evidence: ['HTTP=200', 'token=do-not-emit', 'secret appeared'],
    proofRefs: ['proof/openclaw/health.json', '../outside.json', 'C:/Users/Stephan/.env'],
  });

  assert.deepEqual(result.evidence, ['HTTP=200']);
  assert.deepEqual(result.proofRefs, ['proof/openclaw/health.json']);
  assert.equal(validateVerifierResult(result).valid, true);
});

test('validator blocks unsanitized invalid result payloads', () => {
  const result = validateVerifierResult({
    schemaVersion: VERIFICATION_HARNESS_SCHEMA_VERSION,
    kind: 'stephanos.verification.result',
    checkId: 'bad-check',
    verifierType: 'UnknownVerifier',
    status: 'PASS',
    evidence: ['password=bad'],
    proofRefs: ['../outside.json'],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('invalid-verifier-type'), true);
  assert.equal(result.errors.includes('unsafe-evidence-line'), true);
  assert.equal(result.errors.includes('unsafe-proof-ref'), true);
  assert.equal(result.finalVerdict, 'VERIFIER_RESULT_BLOCKED');
});

test('aggregate passes only when all checks are valid PASS results', () => {
  const aggregate = aggregateVerificationResults({
    aggregateId: 'battle-bridge-health',
    checks: [
      { checkId: 'backend', verifierType: 'BackendVerifier', status: 'PASS', evidence: ['HTTP=200'] },
      { checkId: 'openclaw', verifierType: 'OpenClawVerifier', status: 'PASS', evidence: ['HTTP=200'] },
      { checkId: 'frontend', verifierType: 'FrontendVerifier', status: 'PASS', evidence: ['HTTP=200'] },
    ],
  });

  assert.equal(aggregate.status, VERIFICATION_STATUS.PASS);
  assert.equal(aggregate.finalVerdict, 'VERIFICATION_HARNESS_PASS');
  assert.deepEqual(aggregate.evidence, ['backend: PASS', 'openclaw: PASS', 'frontend: PASS']);
});

test('aggregate fails when any check fails or when no checks are supplied', () => {
  const failed = aggregateVerificationResults({
    aggregateId: 'battle-bridge-health',
    checks: [
      { checkId: 'backend', verifierType: 'BackendVerifier', status: 'PASS', evidence: ['HTTP=200'] },
      { checkId: 'worker', verifierType: 'WorkerVerifier', status: 'FAIL', reason: 'worker not running', evidence: ['WORKER_RECOVERED=False'] },
    ],
  });
  const empty = aggregateVerificationResults({ aggregateId: 'empty' });

  assert.equal(failed.status, VERIFICATION_STATUS.FAIL);
  assert.equal(failed.finalVerdict, 'VERIFICATION_HARNESS_FAIL');
  assert.equal(empty.status, VERIFICATION_STATUS.FAIL);
  assert.equal(empty.finalVerdict, 'VERIFICATION_HARNESS_FAIL');
});
