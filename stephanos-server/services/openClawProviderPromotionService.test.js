import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createExecutionReceipt, toSharedWorkspaceExecutionReceipt } from '../../shared/agents/executionReceiptV1.mjs';
import { createSharedWorkspaceMessageRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_PROVIDER_PROMOTION_STATUS_FILE,
  OPENCLAW_SOURCE_CONSTRUCTION_BLOCKER,
  refreshOpenClawProviderPromotionTruth,
} from './openClawProviderPromotionService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '3dc12a7c84c54f406b10dee1293789e2338f7824';
const NOW = '2026-08-21T02:00:00.000Z';
const EXECUTION_AT = '2026-08-21T01:59:30.000Z';
const PROVIDER_INSTANCE = 'openclaw-gateway:4321';
const PROOF_NAME = 'oc1-1234567890abcdef1234567890abcdef.json';
const PROOF_REF = `proofs/openclaw-oc1/${PROOF_NAME}`;

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

const WORKER_ID = `openclaw-${sha256(PROVIDER_INSTANCE).slice(0, 24)}`;

function execution() {
  return createExecutionReceipt({
    receiptId: 'oc1-receipt-real-001',
    repository: REPOSITORY,
    issueNumber: 1725,
    prNumber: 0,
    branch: 'main',
    sourceHead: HEAD,
    workerId: WORKER_ID,
    workerType: 'openclaw',
    executionId: PROOF_NAME.replace(/\.json$/, ''),
    leaseKey: 'oc1-real-execution-001',
    state: 'completed',
    phase: 'OC1_REPOSITORY_SCOUT',
    sequence: 1,
    predecessorReceiptId: '',
    timestampUtc: EXECUTION_AT,
    heartbeatExpiresAtUtc: '2026-08-21T02:01:30.000Z',
    blocker: '',
    operatorActionRequired: false,
    proofRefs: [PROOF_REF],
    expectedNextAction: 'Await independent Stephanos task-class adjudication.',
  });
}

function providerProof(exec) {
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
    artifacts: [PROOF_REF, `receipts/${exec.receiptId}.json`],
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
  };
  const result = { ...core, exactOutputIdentity: sha256(JSON.stringify(core)) };
  return createSharedWorkspaceMessageRecord({
    messageId: exec.executionId,
    participantId: 'openclaw',
    timestampUtc: exec.timestampUtc,
    correlationId: result.taskId,
    relatedIssue: '1725',
    relatedPr: '',
    proofRefs: [PROOF_REF],
    channel: 'openclaw-provider-qualification',
    summary: 'Canonical OpenClaw provider qualification proof.',
    body: JSON.stringify(result),
  });
}

function fixtureIo() {
  const exec = execution();
  const proof = providerProof(exec);
  const workspace = toSharedWorkspaceExecutionReceipt(exec);
  assert.equal(workspace.ok, true);
  const writes = [];
  return {
    exec,
    proof,
    writes,
    readdirImpl: async (path) => String(path).endsWith('openclaw-oc1') ? [PROOF_NAME] : [],
    readFileImpl: async (path) => {
      const normalized = String(path).replaceAll('\\', '/');
      if (normalized.endsWith(`/proofs/openclaw-oc1/${PROOF_NAME}`)) return JSON.stringify(proof);
      if (normalized.endsWith(`/receipts/${exec.receiptId}.json`)) return JSON.stringify(workspace.record);
      const error = new Error(`unexpected read: ${normalized}`);
      error.code = 'ENOENT';
      throw error;
    },
    writeAtomicJsonImpl: async (_root, segments, record) => {
      writes.push({ segments: [...segments], record });
      return { ok: true, path: `/workspace/${segments.join('/')}` };
    },
  };
}

test('real OC1 proof is independently adjudicated and published while OC3 source construction remains blocked', async () => {
  const io = fixtureIo();
  const result = await refreshOpenClawProviderPromotionTruth({
    root: '/workspace',
    repoRoot: '/repo',
    nowUtc: NOW,
    readFileImpl: io.readFileImpl,
    readdirImpl: io.readdirImpl,
    writeAtomicJsonImpl: io.writeAtomicJsonImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'OPENCLAW_PROMOTION_TRUTH_PUBLISHED');
  assert.equal(result.promotion.ok, true);
  assert.equal(result.promotion.qualificationReceipt.taskClass, 'OC1_REPOSITORY_SCOUT');
  assert.equal(result.statusRecord.status, 'TASK_CLASS_PROMOTION_CURRENT');
  assert.equal(result.statusRecord.sourceConstruction.eligible, false);
  assert.equal(result.statusRecord.sourceConstruction.blocker, OPENCLAW_SOURCE_CONSTRUCTION_BLOCKER);
  assert.equal(result.statusRecord.sourceConstruction.ownerGoal, '#1725');
  assert.equal(result.statusRecord.authority.sourceMutationAllowed, false);
  assert.equal(result.statusRecord.authority.mergeAllowed, false);
  assert.ok(io.writes.some((write) => write.segments.join('/') === `status/${OPENCLAW_PROVIDER_PROMOTION_STATUS_FILE}`));
  assert.ok(io.writes.some((write) => write.segments.join('/') === `receipts/${result.promotion.qualificationAuthorityReceipt.receiptId}.json`));
});

test('stale provider proof cannot be renewed into current qualification by the publisher', async () => {
  const io = fixtureIo();
  const result = await refreshOpenClawProviderPromotionTruth({
    root: '/workspace',
    repoRoot: '/repo',
    nowUtc: '2026-08-21T02:20:00.000Z',
    readFileImpl: io.readFileImpl,
    readdirImpl: io.readdirImpl,
    writeAtomicJsonImpl: io.writeAtomicJsonImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'OPENCLAW_PROMOTION_PROVIDER_PROOF_STALE');
  assert.equal(result.promotion, null);
  assert.equal(result.statusRecord.status, 'WAITING_FOR_QUALIFYING_EVIDENCE');
  assert.equal(result.statusRecord.sourceConstruction.blocker, OPENCLAW_SOURCE_CONSTRUCTION_BLOCKER);
  assert.equal(io.writes.filter((write) => write.segments[0] === 'receipts').length, 0);
});
