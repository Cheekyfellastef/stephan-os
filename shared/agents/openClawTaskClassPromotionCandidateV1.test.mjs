import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createExecutionReceipt } from './executionReceiptV1.mjs';
import {
  createSharedWorkspaceMessageRecord,
} from './sharedAgentWorkspaceStore.mjs';
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
const PROVIDER_INSTANCE = 'openclaw-gateway:4321';
const PROVIDER_VERSION = '1.0.0';

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

const WORKER_ID = `openclaw-${sha256(PROVIDER_INSTANCE).slice(0, 24)}`;

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

function withOutputIdentity(core) {
  return Object.freeze({ ...core, exactOutputIdentity: sha256(JSON.stringify(core)) });
}

function oc1Result(exec, overrides = {}) {
  const core = {
    schemaVersion: 'stephanos.openclaw-oc1-provider-result.v1',
    missionId: 'mission-oc1-real-001',
    goalId: '#1725',
    taskId: 'task-oc1-real-001',
    taskClass: 'OC1_REPOSITORY_SCOUT',
    repository: REPOSITORY,
    requestedSourceHead: exec.sourceHead,
    observedSourceHead: exec.sourceHead,
    exactInputIdentity: sha256('oc1-real-input'),
    provider: 'openclaw-standalone',
    providerInstance: PROVIDER_INSTANCE,
    providerIdentitySource: 'gateway-status',
    providerVersion: PROVIDER_VERSION,
    authorityUsed: {
      grantId: 'grant-oc1-real-001',
      adapter: 'openclaw-readonly',
      canonicalMissionWorkerClaim: true,
      boundedActionCount: 1,
      mergeAuthority: false,
      deploymentAuthority: false,
      sourceMutationAuthority: false,
      selfQualificationAuthority: false,
    },
    commandsOrTestIds: [
      'git-rev-parse-toplevel',
      'git-remote-get-url-origin',
      'git-rev-parse-branch',
      'git-rev-parse-head',
      'git-status-porcelain-v1',
      'read-package-json-script-names',
      'check-fixed-relevant-file-estate',
    ],
    artifacts: [exec.proofRefs[0], `receipts/${exec.receiptId}.json`],
    dirt: { blocksSync: false, source: [], runtimeOnly: [] },
    packageScripts: [],
    relevantFiles: [],
    startedAtUtc: exec.timestampUtc,
    completedAtUtc: exec.timestampUtc,
    blockers: [],
    finalVerdict: 'OPENCLAW_OC1_PROVIDER_TASK_COMPLETED',
    sourceMutationPerformed: false,
    arbitraryShellAllowed: false,
    arbitraryCommandAllowed: false,
    networkMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    selfQualificationAllowed: false,
    ...overrides,
  };
  return withOutputIdentity(core);
}

function oc2Result(exec, overrides = {}) {
  const core = {
    schemaVersion: 'stephanos.openclaw-oc2-provider-result.v1',
    missionId: 'mission-oc2-real-001',
    goalId: '#1725',
    taskId: 'task-oc2-real-001',
    taskClass: 'OC2_DETERMINISTIC_TEST_BUILD',
    repository: REPOSITORY,
    requestedSourceHead: exec.sourceHead,
    observedSourceHead: exec.sourceHead,
    exactInputIdentity: sha256('oc2-real-input'),
    provider: 'openclaw-standalone',
    providerInstance: PROVIDER_INSTANCE,
    providerVersion: PROVIDER_VERSION,
    operation: 'oc2-provider-regression-v1',
    testResults: [
      { testId: 'OC2_PROVIDER_SOURCE_PARSE_V1', status: 0, outputSha256: sha256('oc2-parse') },
      { testId: 'OC2_PROVIDER_REGRESSION_V1', status: 0, outputSha256: sha256('oc2-tests') },
    ],
    changedFiles: [],
    sourceMutationPerformed: false,
    arbitraryShellAllowed: false,
    arbitraryCommandAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    selfQualificationAllowed: false,
    finalVerdict: 'OPENCLAW_OC2_PROVIDER_TASK_COMPLETED',
    completedAtUtc: exec.timestampUtc,
    ...overrides,
  };
  return withOutputIdentity(core);
}

function providerProof(exec = execution(), overrides = {}) {
  const result = exec.phase === 'OC2_DETERMINISTIC_TEST_BUILD'
    ? oc2Result(exec, overrides.result || {})
    : oc1Result(exec, overrides.result || {});
  return createSharedWorkspaceMessageRecord({
    messageId: exec.executionId,
    participantId: 'openclaw',
    timestampUtc: exec.timestampUtc,
    correlationId: result.taskId,
    relatedIssue: '1725',
    relatedPr: '',
    proofRefs: [...exec.proofRefs],
    channel: 'openclaw-provider-qualification',
    summary: 'Canonical OpenClaw provider qualification proof.',
    body: JSON.stringify(result),
    ...(overrides.record || {}),
  });
}

function mutateProof(proof, mutateResult) {
  const parsed = JSON.parse(proof.body);
  const { exactOutputIdentity: _old, ...core } = parsed;
  const nextCore = mutateResult({ ...core });
  const next = withOutputIdentity(nextCore);
  return Object.freeze({ ...proof, body: JSON.stringify(next) });
}

function promote(exec = execution(), proof = providerProof(exec), observedAtUtc = NOW) {
  return adjudicateOpenClawTaskClassPromotionCandidateV1({
    executionReceipt: exec,
    providerProofRecord: proof,
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

test('turns canonical OC1 execution plus provider proof into a gate-compatible Stephanos promotion candidate without routing authority', () => {
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
  assert.equal(validateOpenClawQualificationAuthorityChain(
    candidate.qualificationReceipt,
    hostContext,
    { repository: REPOSITORY, taskClass: 'OC1_REPOSITORY_SCOUT', sourceHead: HEAD, nowUtc: NOW },
  ).valid, true);
  assert.equal(validateOpenClawProviderCapacity(capacity(candidate), {
    repository: REPOSITORY,
    taskClass: 'OC1_REPOSITORY_SCOUT',
    qualificationId: candidate.qualificationReceipt.qualificationId,
    authorityReceiptId: candidate.qualificationReceipt.authorityReceiptId,
    workerId: WORKER_ID,
    nowUtc: NOW,
  }).valid, true);
});

test('supports OC2 only after a completed fixed test/build execution and matching canonical provider proof', () => {
  const exec = execution({
    receiptId: 'oc2-receipt-real-001',
    executionId: 'oc2-real-execution-001',
    leaseKey: 'oc2-real-execution-001',
    phase: 'OC2_DETERMINISTIC_TEST_BUILD',
    proofRefs: ['proofs/openclaw-oc2/oc2-real-execution-001.json'],
  });
  const candidate = promote(exec, providerProof(exec));
  assert.equal(candidate.ok, true);
  assert.equal(candidate.qualificationReceipt.taskClass, 'OC2_DETERMINISTIC_TEST_BUILD');
});

test('fails closed on failed execution, unsupported class, mutation, self-qualification, worker/head drift, test failure or stale proof', () => {
  const base = execution();
  const baseProof = providerProof(base);
  const failedExecution = execution({ state: 'failed', blocker: 'test-failed' });
  const cases = [
    [failedExecution, providerProof(failedExecution)],
    [base, mutateProof(baseProof, (result) => ({ ...result, taskClass: 'OC3_BOUNDED_REPAIR' }))],
    [base, mutateProof(baseProof, (result) => ({ ...result, sourceMutationPerformed: true }))],
    [base, mutateProof(baseProof, (result) => ({ ...result, selfQualificationAllowed: true }))],
    [base, mutateProof(baseProof, (result) => ({ ...result, providerInstance: 'openclaw-gateway:9999' }))],
    [base, mutateProof(baseProof, (result) => ({ ...result, requestedSourceHead: '0'.repeat(40), observedSourceHead: '0'.repeat(40) }))],
  ];
  for (const [exec, proof] of cases) assert.equal(promote(exec, proof).ok, false);

  const oc2 = execution({
    receiptId: 'oc2-receipt-real-001',
    executionId: 'oc2-real-execution-001',
    leaseKey: 'oc2-real-execution-001',
    phase: 'OC2_DETERMINISTIC_TEST_BUILD',
    proofRefs: ['proofs/openclaw-oc2/oc2-real-execution-001.json'],
  });
  const failedTestProof = mutateProof(providerProof(oc2), (result) => ({
    ...result,
    testResults: result.testResults.map((entry, index) => index === 1 ? { ...entry, status: 1 } : entry),
  }));
  assert.equal(promote(oc2, failedTestProof).ok, false);
  assert.equal(promote(base, baseProof, '2026-08-21T02:20:00.000Z').ok, false);
});

test('rejects result digest drift, extra authority fields and proof-record lineage drift', () => {
  const exec = execution();
  const proof = providerProof(exec);
  const parsed = JSON.parse(proof.body);
  parsed.finalVerdict = 'OPENCLAW_OC1_PROVIDER_TASK_BLOCKED';
  assert.equal(promote(exec, { ...proof, body: JSON.stringify(parsed) }).ok, false);

  const extra = mutateProof(proof, (result) => ({ ...result, surpriseAuthority: true }));
  assert.equal(promote(exec, extra).ok, false);
  assert.equal(promote(exec, { ...proof, participantId: 'foreign-agent' }).ok, false);
  assert.equal(promote(exec, { ...proof, messageId: 'foreign-execution' }).ok, false);
  assert.equal(promote(exec, { ...proof, proofRefs: ['proofs/openclaw-oc1/foreign.json'] }).ok, false);
});

test('rejects accessor-bearing, sparse and revoked proof records without executing accessors', () => {
  const exec = execution();
  const proof = providerProof(exec);
  let accessorExecuted = false;
  const accessor = {};
  for (const [key, value] of Object.entries(proof)) {
    if (key === 'body') continue;
    Object.defineProperty(accessor, key, { value, enumerable: true });
  }
  Object.defineProperty(accessor, 'body', {
    enumerable: true,
    get() {
      accessorExecuted = true;
      throw new Error('must not execute proof accessor');
    },
  });
  assert.equal(promote(exec, accessor).ok, false);
  assert.equal(accessorExecuted, false);

  const sparseRefs = new Array(2);
  sparseRefs[1] = proof.proofRefs[0];
  assert.equal(promote(exec, { ...proof, proofRefs: sparseRefs }).ok, false);

  const { proxy, revoke } = Proxy.revocable(proof, {});
  revoke();
  assert.doesNotThrow(() => promote(exec, proxy));
  assert.equal(promote(exec, proxy).ok, false);
});
