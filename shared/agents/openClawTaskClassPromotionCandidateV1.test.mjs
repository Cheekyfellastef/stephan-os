import assert from 'node:assert/strict';
import test from 'node:test';

import { createExecutionReceipt } from './executionReceiptV1.mjs';
import {
  OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
  OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
  validateOpenClawQualificationAuthorityChain,
  validateOpenClawProviderCapacity,
} from './openClawProviderPoolQualificationV1.mjs';
import {
  OPENCLAW_PROMOTION_CANDIDATE_DISPOSITION,
  adjudicateOpenClawTaskClassPromotionCandidateV1,
} from './openClawTaskClassPromotionCandidateV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '3dc12a7c84c54f406b10dee1293789e2338f7824';
const NOW = '2026-08-21T02:00:00.000Z';
const WORKER_ID = 'openclaw-8f11b5c0d3ac762a12345678';

function execution(overrides = {}) {
  return createExecutionReceipt({
    receiptId: 'oc1-receipt-real-001',
    repository: REPOSITORY,
    issueNumber: 1725,
    prNumber: 0,
    branch: 'main',
    sourceHead: HEAD,
    workerId: WORKER_ID,
    workerType: 'openclaw',
    executionId: 'oc1-real-execution-001',
    leaseKey: 'oc1-real-execution-001',
    state: 'completed',
    phase: 'OC1_REPOSITORY_SCOUT',
    sequence: 1,
    predecessorReceiptId: '',
    timestampUtc: '2026-08-21T01:59:30.000Z',
    heartbeatExpiresAtUtc: '2026-08-21T02:01:30.000Z',
    blocker: '',
    operatorActionRequired: false,
    proofRefs: ['proofs/openclaw-oc1/oc1-real-execution-001.json'],
    expectedNextAction: 'Await independent Stephanos task-class adjudication.',
    ...overrides,
  });
}

function evidence(exec = execution(), overrides = {}) {
  return {
    taskClass: exec.phase,
    taskId: exec.executionId,
    sourceHead: exec.sourceHead,
    workerId: exec.workerId,
    providerVersion: '1.0.0',
    finalVerdict: exec.phase === 'OC2_DETERMINISTIC_TEST_BUILD'
      ? 'OPENCLAW_OC2_PROVIDER_TASK_COMPLETED'
      : 'OPENCLAW_OC1_PROVIDER_TASK_COMPLETED',
    proofRefs: [...exec.proofRefs],
    changedFiles: [],
    sourceMutationPerformed: false,
    selfQualificationAllowed: false,
    ...overrides,
  };
}

function promote(exec = execution(), providerEvidence = evidence(exec), observedAtUtc = NOW) {
  return adjudicateOpenClawTaskClassPromotionCandidateV1({
    executionReceipt: exec,
    providerEvidence,
    observedAtUtc,
  });
}

function capacity(candidate, overrides = {}) {
  return {
    schemaVersion: OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
    receiptId: 'openclaw-capacity-real-001',
    provider: 'openclaw-standalone',
    repository: REPOSITORY,
    workerId: candidate.qualificationReceipt.providerInstance,
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: [candidate.qualificationReceipt.taskClass],
    observedAtUtc: NOW,
    expiresAtUtc: '2026-08-21T02:15:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 2,
    qualificationIds: [candidate.qualificationReceipt.qualificationId],
    qualificationAuthorityReceiptId: candidate.qualificationReceipt.authorityReceiptId,
    proofRefs: [...candidate.qualificationReceipt.proofRefs],
    ...overrides,
  };
}

test('turns one completed OC1 real-work receipt into a gate-compatible Stephanos promotion candidate without routing authority', () => {
  const exec = execution();
  const candidate = promote(exec);
  assert.equal(candidate.ok, true);
  assert.equal(candidate.disposition, OPENCLAW_PROMOTION_CANDIDATE_DISPOSITION);
  assert.equal(candidate.providerPoolAdmissionAllowed, false);
  assert.equal(candidate.providerQualificationAuthority, false);
  assert.equal(candidate.qualificationReceipt.state, 'PRODUCTION_ELIGIBLE');
  assert.equal(candidate.qualificationReceipt.codexRequired, false);
  assert.equal(candidate.qualificationReceipt.providerInstance, WORKER_ID);
  assert.equal(candidate.qualificationReceipt.realWorkReceiptId, exec.receiptId);
  assert.equal(candidate.qualificationReceipt.realWorkTaskId, exec.executionId);

  const hostContext = {
    schemaVersion: OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
    qualificationReceipt: candidate.qualificationReceipt,
    capacityReceipt: capacity(candidate),
    realWorkExecutionReceipt: exec,
    realWorkWorkspaceReceipt: candidate.realWorkWorkspaceReceipt,
    qualificationAuthorityReceipt: candidate.qualificationAuthorityReceipt,
  };
  const authority = validateOpenClawQualificationAuthorityChain(
    candidate.qualificationReceipt,
    hostContext,
    { repository: REPOSITORY, taskClass: 'OC1_REPOSITORY_SCOUT', sourceHead: HEAD, nowUtc: NOW },
  );
  assert.equal(authority.valid, true);
  assert.equal(validateOpenClawProviderCapacity(capacity(candidate), {
    repository: REPOSITORY,
    taskClass: 'OC1_REPOSITORY_SCOUT',
    qualificationId: candidate.qualificationReceipt.qualificationId,
    authorityReceiptId: candidate.qualificationReceipt.authorityReceiptId,
    workerId: WORKER_ID,
    nowUtc: NOW,
  }).valid, true);
});

test('supports OC2 only after a completed fixed task-class execution receipt', () => {
  const exec = execution({
    receiptId: 'oc2-receipt-real-001',
    executionId: 'oc2-real-execution-001',
    leaseKey: 'oc2-real-execution-001',
    phase: 'OC2_DETERMINISTIC_TEST_BUILD',
    proofRefs: ['proofs/openclaw-oc2/oc2-real-execution-001.json'],
  });
  const candidate = promote(exec, evidence(exec));
  assert.equal(candidate.ok, true);
  assert.equal(candidate.qualificationReceipt.taskClass, 'OC2_DETERMINISTIC_TEST_BUILD');
});

test('fails closed on unsupported, failed, mutated, self-qualified, mismatched or stale evidence', () => {
  const base = execution();
  const cases = [
    [execution({ state: 'failed', blocker: 'test-failed' }), evidence(execution({ state: 'failed', blocker: 'test-failed' }))],
    [base, evidence(base, { taskClass: 'OC3_BOUNDED_REPAIR', finalVerdict: 'OPENCLAW_OC3_PROVIDER_TASK_COMPLETED' })],
    [base, evidence(base, { finalVerdict: 'OPENCLAW_OC1_PROVIDER_TASK_BLOCKED' })],
    [base, evidence(base, { changedFiles: ['shared/agents/example.mjs'], sourceMutationPerformed: true })],
    [base, evidence(base, { selfQualificationAllowed: true })],
    [base, evidence(base, { workerId: 'foreign-openclaw' })],
    [base, evidence(base, { sourceHead: '0'.repeat(40) })],
  ];
  for (const [exec, providerEvidence] of cases) {
    assert.equal(promote(exec, providerEvidence).ok, false);
  }
  assert.equal(promote(base, evidence(base), '2026-08-21T02:20:00.000Z').ok, false);
});

test('rejects accessor-bearing or extra-field provider evidence before reading it as authority', () => {
  const base = evidence();
  const accessor = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === 'finalVerdict') continue;
    Object.defineProperty(accessor, key, { value, enumerable: true });
  }
  Object.defineProperty(accessor, 'finalVerdict', {
    enumerable: true,
    get() { throw new Error('must not execute'); },
  });
  assert.equal(promote(execution(), accessor).ok, false);
  assert.equal(promote(execution(), { ...base, surpriseAuthority: true }).ok, false);
});
