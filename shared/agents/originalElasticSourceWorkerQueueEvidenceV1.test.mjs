import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectOriginalR7QueueEvidenceV1,
  ORIGINAL_R7_EVIDENCE_IDENTITY,
} from './originalElasticSourceWorkerQueueEvidenceV1.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'original-r7-forensic-'));
  try { return await fn({ root, env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: root } }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function item(overrides = {}) {
  const original = ORIGINAL_R7_EVIDENCE_IDENTITY;
  return {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    missionId: original.missionId,
    actionId: 'original-r7-worker-action',
    adapter: 'foundry-forge',
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: 'original-r7-worker-action',
      leaseKey: original.leaseKey,
      grantId: 'original-r7-grant',
      missionId: original.missionId,
      missionRevision: 7,
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 2962,
      prNumber: 2987,
      branch: original.branch,
      headSha: original.headSha,
    },
    ...overrides,
  };
}
async function writePair(root, state, record, result) {
  const dir = join(root, 'foundry-forge', state);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'original-r7-worker-action.json'), JSON.stringify(record));
  if (result !== undefined) {
    await writeFile(join(dir, 'original-r7-worker-action.result.json'), JSON.stringify(result));
  }
}

test('fixed original-r7 probe reports absence only as unproven and never authorises lease release', async () => fixture(async ({ root, env }) => {
  const proof = await inspectOriginalR7QueueEvidenceV1({ env });
  assert.equal(proof.queueObserved, true);
  assert.equal(proof.inventoryComplete, true);
  assert.equal(proof.exactResultPairCandidates, 0);
  assert.equal(proof.blocker, 'ORIGINAL_QUEUE_RESULT_NOT_PROVEN');
  assert.equal(proof.writerInactivityProven, false);
  assert.equal(proof.canonicalTerminalExecutionReceiptProven, false);
  assert.equal(proof.leaseReleaseAuthority, false);
  assert.equal(proof.sourceMutationAuthority, false);
  assert.equal(proof.rawPathsReturned, false);
  assert.equal(proof.rawRecordsReturned, false);
  assert.equal(proof.secretMaterialReturned, false);
  assert.equal(proof.originalLeaseKey, 'critical-2962-elastic-goal-r7-lease');
}));

test('fixed original-r7 probe finds exact immutable terminal item/result candidate without promoting it to a receipt', async () => fixture(async ({ root, env }) => {
  await writePair(root, 'completed', item(), {
    schemaVersion: 'stephanos.provider-neutral-source-builder.v1',
    missionId: ORIGINAL_R7_EVIDENCE_IDENTITY.missionId,
    actionId: 'original-r7-worker-action',
    adapter: 'foundry-forge',
    processed: true,
    success: false,
    finalVerdict: 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED',
  });
  const proof = await inspectOriginalR7QueueEvidenceV1({ env });
  assert.equal(proof.inventoryComplete, true);
  assert.equal(proof.matchingOriginalItems, 1);
  assert.equal(proof.exactBindingItems, 1);
  assert.equal(proof.completedOriginalItems, 1);
  assert.equal(proof.exactResultPairCandidates, 1);
  assert.equal(proof.missingResultPairs, 0);
  assert.equal(proof.blocker, '');
  assert.match(proof.actionHashes[0], /^[0-9a-f]{64}$/);
  assert.equal(proof.canonicalTerminalExecutionReceiptProven, false);
  assert.equal(proof.writerInactivityProven, false);
  assert.equal(proof.leaseReleaseAuthority, false);
  assert.equal('result' in proof, false);
}));

test('wrong original head never becomes an exact terminal candidate', async () => fixture(async ({ root, env }) => {
  const forged = item({ executionBinding: { ...item().executionBinding, headSha: 'f'.repeat(40) } });
  await writePair(root, 'completed', forged, {
    missionId: ORIGINAL_R7_EVIDENCE_IDENTITY.missionId,
    actionId: 'original-r7-worker-action',
    processed: true, success: true,
  });
  const proof = await inspectOriginalR7QueueEvidenceV1({ env });
  assert.equal(proof.matchingOriginalItems, 1);
  assert.equal(proof.exactBindingItems, 0);
  assert.equal(proof.mismatchedOriginalItems, 1);
  assert.equal(proof.exactResultPairCandidates, 0);
  assert.equal(proof.blocker, 'ORIGINAL_QUEUE_IDENTITY_UNVERIFIED');
}));

test('active original work is never declared idle just because no terminal result exists', async () => fixture(async ({ root, env }) => {
  await writePair(root, 'processing', item());
  const proof = await inspectOriginalR7QueueEvidenceV1({ env });
  assert.equal(proof.processingOriginalItems, 1);
  assert.equal(proof.exactResultPairCandidates, 0);
  assert.equal(proof.writerInactivityProven, false);
  assert.equal(proof.blocker, 'ORIGINAL_QUEUE_RESULT_NOT_PROVEN');
}));

test('wrong action result fails closed instead of supplying original terminal proof', async () => fixture(async ({ root, env }) => {
  await writePair(root, 'failed', item(), {
    missionId: ORIGINAL_R7_EVIDENCE_IDENTITY.missionId,
    actionId: 'unrelated-action',
    processed: true, success: true,
  });
  const proof = await inspectOriginalR7QueueEvidenceV1({ env });
  assert.equal(proof.failedOriginalItems, 1);
  assert.equal(proof.missingResultPairs, 1);
  assert.equal(proof.exactResultPairCandidates, 0);
  assert.equal(proof.leaseReleaseAuthority, false);
}));

test('missing canonical queue root is never an empty-queue clearance', async () => {
  const proof = await inspectOriginalR7QueueEvidenceV1({
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: join(tmpdir(), 'original-r7-never-created-unlikely-abcxyz') },
  });
  assert.equal(proof.queueObserved, false);
  assert.equal(proof.inventoryComplete, false);
  assert.equal(proof.blocker, 'ORIGINAL_QUEUE_ROOT_UNAVAILABLE');
  assert.equal(proof.writerInactivityProven, false);
});
