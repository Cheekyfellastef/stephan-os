import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { inspectRecoverableProcessingClaim } from './missionOrchestratorWorkerConsumer.js';

const HEAD = 'a'.repeat(40);
const MISSION_ID = 'critical-2002-orphan-recovery';
const ACTION_ID = 'critical-2002-orphan-recovery-r1';
const LEASE_KEY = `${MISSION_ID}-r1-lease`;

function grant() {
  return {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${ACTION_ID}`,
    controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD,
    missionId: MISSION_ID,
    missionRevision: 1,
    currentPhase: 'AGENT_IMPLEMENTATION',
    actionId: ACTION_ID,
    actionKind: 'agent-handoff',
    adapter: 'foundry-forge',
    operation: 'SOURCE_CONSTRUCTION',
    capacityRoute: 'FOUNDRY_FORGE',
    capacityReceiptId: 'capacity-proof-1',
    capacityProofRefs: ['proofs/capacity-1'],
    workerId: 'foundry-worker-1',
    laneId: MISSION_ID,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2002,
    prNumber: null,
    branch: 'fix/orphan-recovery',
    headSha: HEAD,
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
}

function queueItem() {
  const actionGrant = grant();
  return {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'foundry-forge',
    actionId: ACTION_ID,
    missionId: MISSION_ID,
    createdAt: '2026-09-25T15:00:00.000Z',
    actionGrant,
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: ACTION_ID,
      leaseKey: LEASE_KEY,
      grantId: actionGrant.grantId,
      missionId: MISSION_ID,
      missionRevision: 1,
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 2002,
      prNumber: null,
      branch: 'fix/orphan-recovery',
      headSha: HEAD,
      sourceRevision: HEAD,
    },
    payload: {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      actionKind: 'agent-handoff',
      missionId: MISSION_ID,
      actionId: ACTION_ID,
      adapter: 'foundry-forge',
      operation: 'SOURCE_CONSTRUCTION',
    },
  };
}

function receipt(state) {
  return {
    receiptId: `receipt-${state}`,
    state,
    executionId: ACTION_ID,
    leaseKey: LEASE_KEY,
    sourceHead: HEAD,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mission-worker-orphan-'));
  const processing = join(root, 'foundry-forge', 'processing');
  await mkdir(processing, { recursive: true });
  await writeFile(join(processing, `${ACTION_ID}.json`), `${JSON.stringify(queueItem())}\n`);
  return root;
}

test('dead owner with queued receipt is recoverable without redispatching a second queue item', async () => {
  const root = await fixture();
  let takeoverCalls = 0;
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt('queued') }),
      acquireClaimOwnership: async () => {
        takeoverCalls += 1;
        return { acquired: true, release: async () => true };
      },
    });
    assert.equal(result.hold, null);
    assert.equal(result.claim?.recoveredFromOrphan, true);
    assert.equal(result.claim?.recoveredReceiptState, 'queued');
    assert.equal(result.claim?.item?.actionId, ACTION_ID);
    assert.equal(takeoverCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dead owner with accepted receipt is recoverable because executor authority has not started', async () => {
  const root = await fixture();
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt('accepted') }),
      acquireClaimOwnership: async () => ({ acquired: true, release: async () => true }),
    });
    assert.equal(result.claim?.recoveredFromOrphan, true);
    assert.equal(result.claim?.recoveredReceiptState, 'accepted');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const state of ['started', 'progress', 'stalled', 'completed', 'failed']) {
  test(`dead owner with ${state} receipt is never automatically re-executed`, async () => {
    const root = await fixture();
    let takeoverCalls = 0;
    try {
      const result = await inspectRecoverableProcessingClaim('foundry-forge', {
        queueRoot: root,
        sharedWorkspaceRoot: join(root, 'workspace'),
        inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
        readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt(state) }),
        acquireClaimOwnership: async () => {
          takeoverCalls += 1;
          return { acquired: true, release: async () => true };
        },
      });
      assert.equal(result.claim, null);
      assert.equal(result.hold?.reason, `MISSION_WORKER_ORPHAN_RECONCILIATION_REQUIRED:${state}`);
      assert.equal(result.hold?.receiptState, state);
      assert.equal(takeoverCalls, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('missing or invalid owner truth never grants orphan takeover', async () => {
  const root = await fixture();
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      inspectClaimOwnership: async () => ({ ok: true, state: 'missing', reason: 'MISSION_WORKER_CLAIM_OWNER_MISSING' }),
      readExecutionReceiptHistory: async () => {
        throw new Error('receipt history must not be consulted without owner death proof');
      },
      acquireClaimOwnership: async () => {
        throw new Error('takeover must not be attempted without owner death proof');
      },
    });
    assert.equal(result.claim, null);
    assert.equal(result.hold?.reason, 'MISSION_WORKER_CLAIM_OWNER_MISSING');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
