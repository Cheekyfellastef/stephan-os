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
      worktreePath: '/tmp/stephanos-orphan-worktree',
      expectedHeadSha: HEAD,
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


function cleanRecoveryGitRun({ head = HEAD, tracked = '', untracked = '' } = {}) {
  return (_command, args) => {
    if (args.includes('rev-parse')) return { status: 0, stdout: `${head}\n`, stderr: '' };
    if (args.includes('diff')) return { status: 0, stdout: tracked, stderr: '' };
    if (args.includes('ls-files')) return { status: 0, stdout: untracked, stderr: '' };
    throw new Error(`unexpected git recovery probe: ${args.join(' ')}`);
  };
}

for (const state of ['started', 'progress']) {
  test(`dead owner with ${state} receipt can be reclaimed when exact-head source worktree is still clean`, async () => {
    const root = await fixture();
    let takeoverCalls = 0;
    try {
      const result = await inspectRecoverableProcessingClaim('foundry-forge', {
        queueRoot: root,
        sharedWorkspaceRoot: join(root, 'workspace'),
        runCommand: cleanRecoveryGitRun(),
        inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
        readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt(state) }),
        acquireClaimOwnership: async () => {
          takeoverCalls += 1;
          return { acquired: true, release: async () => true };
        },
      });

      assert.equal(result.hold, null);
      assert.equal(result.claim?.recoveredFromOrphan, true);
      assert.equal(result.claim?.recoveredReceiptState, state);
      assert.equal(result.claim?.activeResumeProof?.allowed, true);
      assert.equal(result.claim?.activeResumeProof?.sourceMutationObserved, false);
      assert.equal(takeoverCalls, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('active provider-neutral orphan remains blocked when source dirt proves mutation may have started', async () => {
  const root = await fixture();
  let takeoverCalls = 0;
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      runCommand: cleanRecoveryGitRun({ tracked: 'shared/agents/example.mjs\n' }),
      inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt('progress') }),
      acquireClaimOwnership: async () => {
        takeoverCalls += 1;
        return { acquired: true, release: async () => true };
      },
    });

    assert.equal(result.claim, null);
    assert.equal(result.hold?.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_MISSING');
    assert.equal(result.hold?.activeResumeProof?.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_MISSING');
    assert.equal(takeoverCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('recycled PID owner with queued receipt is recoverable through serialized ownership takeover', async () => {
  const root = await fixture();
  let takeoverCalls = 0;
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      inspectClaimOwnership: async () => ({
        ok: true,
        state: 'reused',
        reason: 'MISSION_WORKER_CLAIM_OWNER_REUSED',
      }),
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


test('dirty active orphan falls through to exact applied-mutation checkpoint recovery', async () => {
  const root = await fixture();
  let checkpointInspections = 0;
  let takeoverCalls = 0;
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      runCommand: cleanRecoveryGitRun({ tracked: 'shared/agents/example.mjs\n' }),
      inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt('progress') }),
      inspectAppliedMutationRecovery: async (input) => {
        checkpointInspections += 1;
        assert.equal(input.adapter, 'foundry-forge');
        assert.equal(input.item.actionId, ACTION_ID);
        assert.equal(input.latestReceipt.state, 'progress');
        return {
          allowed: true,
          reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_EXACT_MATCH',
          resumeStage: 'SOURCE_CHANGED',
          providerReplayMayOccur: false,
          sourceMutationReplayAllowed: false,
          expectedHead: HEAD,
          changedFiles: ['shared/agents/example.mjs'],
          checkpoint: { patchSha256: 'c'.repeat(64) },
        };
      },
      acquireClaimOwnership: async () => {
        takeoverCalls += 1;
        return { acquired: true, release: async () => true };
      },
    });

    assert.equal(result.hold, null);
    assert.equal(result.claim?.recoveredFromOrphan, true);
    assert.equal(result.claim?.activeResumeProof?.resumeStage, 'SOURCE_CHANGED');
    assert.equal(result.claim?.activeResumeProof?.providerReplayMayOccur, false);
    assert.deepEqual(result.claim?.activeResumeProof?.changedFiles, ['shared/agents/example.mjs']);
    assert.equal(checkpointInspections, 1);
    assert.equal(takeoverCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('dirty active orphan falls through from missing checkpoint to exact prepared-mutation intent', async () => {
  const root = await fixture();
  let checkpointInspections = 0;
  let intentInspections = 0;
  let takeoverCalls = 0;
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      runCommand: cleanRecoveryGitRun({ tracked: 'shared/agents/example.mjs\n' }),
      inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt('progress') }),
      inspectAppliedMutationRecovery: async () => {
        checkpointInspections += 1;
        return {
          allowed: false,
          reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_MISSING',
        };
      },
      inspectPreparedMutationRecovery: async (input) => {
        intentInspections += 1;
        assert.equal(input.adapter, 'foundry-forge');
        assert.equal(input.item.actionId, ACTION_ID);
        assert.equal(input.latestReceipt.state, 'progress');
        return {
          allowed: true,
          reason: 'PROVIDER_NEUTRAL_MUTATION_INTENT_EXACT_MATCH',
          resumeStage: 'SOURCE_CHANGED_PREPARED',
          providerReplayMayOccur: false,
          sourceMutationReplayAllowed: false,
          expectedHead: HEAD,
          changedFiles: ['shared/agents/example.mjs'],
          intent: { patchSha256: 'd'.repeat(64) },
          sourceArtifactIdentity: { exactResultTree: 'e'.repeat(40) },
        };
      },
      acquireClaimOwnership: async () => {
        takeoverCalls += 1;
        return { acquired: true, release: async () => true };
      },
    });

    assert.equal(result.hold, null);
    assert.equal(result.claim?.recoveredFromOrphan, true);
    assert.equal(result.claim?.activeResumeProof?.resumeStage, 'SOURCE_CHANGED_PREPARED');
    assert.equal(result.claim?.activeResumeProof?.providerReplayMayOccur, false);
    assert.deepEqual(result.claim?.activeResumeProof?.changedFiles, ['shared/agents/example.mjs']);
    assert.equal(checkpointInspections, 1);
    assert.equal(intentInspections, 1);
    assert.equal(takeoverCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prepared mutation intent never overrides a conflicting applied checkpoint', async () => {
  const root = await fixture();
  let intentInspections = 0;
  try {
    const result = await inspectRecoverableProcessingClaim('foundry-forge', {
      queueRoot: root,
      sharedWorkspaceRoot: join(root, 'workspace'),
      runCommand: cleanRecoveryGitRun({ tracked: 'shared/agents/example.mjs\n' }),
      inspectClaimOwnership: async () => ({ ok: true, state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: receipt('progress') }),
      inspectAppliedMutationRecovery: async () => ({
        allowed: false,
        reason: 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_WORKTREE_MISMATCH',
      }),
      inspectPreparedMutationRecovery: async () => {
        intentInspections += 1;
        return { allowed: true, reason: 'should-never-run' };
      },
      acquireClaimOwnership: async () => {
        throw new Error('ownership must not be acquired across conflicting checkpoint proof');
      },
    });

    assert.equal(result.claim, null);
    assert.equal(result.hold?.reason, 'PROVIDER_NEUTRAL_MUTATION_CHECKPOINT_WORKTREE_MISMATCH');
    assert.equal(intentInspections, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
