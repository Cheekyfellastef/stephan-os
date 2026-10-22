import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createExecutionReceipt, toSharedWorkspaceExecutionReceipt } from '../../shared/agents/executionReceiptV1.mjs';
import { createSharedWorkspaceMessageRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_PROVIDER_POOL_CONSERVATIVE_START_LATENCY_SECONDS,
  refreshOpenClawProviderPoolCapacity,
} from './openClawProviderPoolAdmissionService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '3dc12a7c84c54f406b10dee1293789e2338f7824';
const NOW = new Date('2026-09-28T17:00:00.000Z');
const EXECUTION_AT = '2026-09-28T16:59:30.000Z';
const PROVIDER_INSTANCE = 'openclaw-gateway:4321';
const TASK_HASH = 'a'.repeat(32);
const EXECUTION_ID = `oc1-${TASK_HASH}`;
const RECEIPT_ID = `oc1-receipt-${TASK_HASH}`;

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

const WORKER_ID = `openclaw-${sha256(PROVIDER_INSTANCE).slice(0, 24)}`;

function execution(overrides = {}) {
  return createExecutionReceipt({
    receiptId: RECEIPT_ID,
    repository: REPOSITORY,
    issueNumber: 1725,
    prNumber: 0,
    branch: 'main',
    sourceHead: HEAD,
    workerId: WORKER_ID,
    workerType: 'openclaw',
    executionId: EXECUTION_ID,
    leaseKey: EXECUTION_ID,
    state: 'completed',
    phase: 'OC1_REPOSITORY_SCOUT',
    sequence: 1,
    predecessorReceiptId: '',
    timestampUtc: EXECUTION_AT,
    heartbeatExpiresAtUtc: '2026-09-28T17:01:30.000Z',
    blocker: '',
    operatorActionRequired: false,
    proofRefs: [`proofs/openclaw-oc1/${EXECUTION_ID}.json`],
    expectedNextAction: 'Await independent Stephanos task-class adjudication.',
    ...overrides,
  });
}

function withOutputIdentity(core) {
  return Object.freeze({ ...core, exactOutputIdentity: sha256(JSON.stringify(core)) });
}

function providerResult(exec = execution(), overrides = {}) {
  return withOutputIdentity({
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
    providerIdentitySource: 'openclaw-gateway-identity',
    providerVersion: '1.0.0',
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
  });
}

function providerProof(exec = execution()) {
  const result = providerResult(exec);
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
  });
}

function supervisor(head = HEAD) {
  return {
    schema: 'stephanos.battle-bridge-ignition-supervisor.v1',
    sourceTruthVerdict: { state: 'ready', expectedHead: head },
    services: { openClaw18789: { state: 'ready', ready: true } },
  };
}

function harness(overrides = {}) {
  const exec = overrides.exec || execution();
  const proof = overrides.proof || providerProof(exec);
  const workspaceReceipt = toSharedWorkspaceExecutionReceipt(exec).record;
  const publications = [];
  const readFileImpl = async (file) => {
    const value = String(file).replace(/\\/g, '/');
    if (value.endsWith('/status/battle-bridge-ignition-supervisor-current.json')) {
      return JSON.stringify(overrides.supervisor || supervisor());
    }
    if (value.endsWith(`/proofs/openclaw-oc1/${EXECUTION_ID}.json`)) return JSON.stringify(proof);
    if (value.endsWith(`/receipts/${RECEIPT_ID}.json`)) return JSON.stringify(workspaceReceipt);
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  return {
    publications,
    options: {
      paths: { repoRoot: 'C:\\repo', workspaceRoot: 'C:\\workspace' },
      now: overrides.now || NOW,
      readSourceHead: async () => overrides.sourceHead || HEAD,
      readdirImpl: async () => [{ name: `${EXECUTION_ID}.json`, isFile: () => true }],
      readFileImpl,
      probeOpenClawGateway: async () => overrides.probe || ({ ok: true, runtimeId: PROVIDER_INSTANCE, probeLatencyMs: 3 }),
      readQueue: async () => overrides.queue || [],
      writeAdmissionProof: async () => overrides.admissionProofResult || ({ ok: true, path: 'proof/openclaw-provider-pool-admission.json' }),
      publishPool: async (record) => {
        publications.push(record);
        return overrides.publishResult || { ok: true, path: 'status/openclaw-provider-pool-current.json' };
      },
    },
  };
}

test('admits one fresh real-work-qualified OpenClaw context through Stephanos-owned pool publication', async () => {
  const h = harness();
  const result = await refreshOpenClawProviderPoolCapacity(h.options);
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.workerId, WORKER_ID);
  assert.equal(result.taskClass, 'OC1_REPOSITORY_SCOUT');
  assert.equal(result.p95StartLatencySeconds, OPENCLAW_PROVIDER_POOL_CONSERVATIVE_START_LATENCY_SECONDS);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(h.publications.length, 1);
  assert.equal(h.publications[0].schemaVersion, 'stephanos.openclaw-elastic-provider-pool.v1');
  assert.equal(h.publications[0].hostContexts.length, 1);
  assert.equal(h.publications[0].hostContexts[0].qualificationReceipt.providerInstance, WORKER_ID);
  assert.deepEqual(h.publications[0].hostContexts[0].capacityReceipt.supportedTaskClasses, ['OC1_REPOSITORY_SCOUT']);
});

test('stale real-work evidence removes OpenClaw from the pool instead of renewing stale qualification', async () => {
  const h = harness({ now: new Date('2026-09-28T17:11:00.000Z') });
  const result = await refreshOpenClawProviderPoolCapacity(h.options);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'OPENCLAW_PROVIDER_POOL_FRESH_REAL_WORK_QUALIFICATION_MISSING');
  assert.equal(h.publications.at(-1).hostContexts.length, 0);
});

test('exact-head ignition mismatch removes OpenClaw without affecting other providers', async () => {
  const h = harness({ supervisor: supervisor('0'.repeat(40)) });
  const result = await refreshOpenClawProviderPoolCapacity(h.options);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'OPENCLAW_PROVIDER_POOL_EXACT_HEAD_SUPERVISOR_UNPROVEN');
  assert.equal(h.publications.at(-1).hostContexts.length, 0);
});

test('live runtime identity drift cannot inherit another OpenClaw instance qualification', async () => {
  const h = harness({ probe: { ok: true, runtimeId: 'openclaw-gateway:9999', probeLatencyMs: 2 } });
  const result = await refreshOpenClawProviderPoolCapacity(h.options);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'OPENCLAW_PROVIDER_POOL_RUNTIME_IDENTITY_DRIFT');
  assert.equal(h.publications.at(-1).hostContexts.length, 0);
});

test('publication failure never reports admitted OpenClaw capacity', async () => {
  const h = harness({ publishResult: { ok: false, reason: 'workspace-write-failed' } });
  const result = await refreshOpenClawProviderPoolCapacity(h.options);
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
  assert.match(result.reason, /^OPENCLAW_PROVIDER_POOL_PUBLICATION_FAILED:/);
});
