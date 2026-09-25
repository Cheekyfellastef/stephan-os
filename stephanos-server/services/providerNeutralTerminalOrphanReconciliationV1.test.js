import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { reconcileNextProviderNeutralTerminalOrphan } from './providerNeutralTerminalOrphanReconciliationV1.js';

const HEAD = 'b'.repeat(40);
const MISSION_ID = 'critical-2002-terminal-orphan';
const ACTION_ID = 'critical-2002-terminal-orphan-r1';
const ADAPTER = 'foundry-forge';
const LEASE_KEY = `${MISSION_ID}-r1-lease`;

function item() {
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${ACTION_ID}`,
    missionId: MISSION_ID,
    missionRevision: 1,
    actionId: ACTION_ID,
    adapter: ADAPTER,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2002,
    prNumber: null,
    branch: 'fix/terminal-orphan',
    headSha: HEAD,
    sourceRevision: HEAD,
  };
  return {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: ADAPTER,
    actionId: ACTION_ID,
    missionId: MISSION_ID,
    actionGrant: grant,
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: ACTION_ID,
      leaseKey: LEASE_KEY,
      grantId: grant.grantId,
      missionId: MISSION_ID,
      missionRevision: 1,
      repository: grant.repository,
      issueNumber: 2002,
      prNumber: null,
      branch: grant.branch,
      headSha: HEAD,
      sourceRevision: HEAD,
    },
    payload: {
      schemaVersion: 'stephanos.mission-worker-action.v1',
      missionId: MISSION_ID,
      actionId: ACTION_ID,
      adapter: ADAPTER,
    },
  };
}

async function fixture({ success = true, committed = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'terminal-orphan-'));
  const processing = join(root, ADAPTER, 'processing');
  const sharedWorkspaceRoot = join(root, 'workspace');
  await mkdir(processing, { recursive: true });
  await mkdir(sharedWorkspaceRoot, { recursive: true });
  const processingPath = join(processing, `${ACTION_ID}.json`);
  await writeFile(processingPath, `${JSON.stringify(item())}\n`);

  const eventPath = join(root, `${MISSION_ID}.events.ndjson`);
  const resultId = 'provider-result-001';
  const event = {
    eventId: `result-${ACTION_ID}`,
    eventType: 'AGENT_RESULT_RECEIVED',
    missionId: MISSION_ID,
    success,
    resultId,
    changedFiles: success ? ['shared/agents/example.mjs'] : [],
    receipt: success ? { commandOutputHash: 'c'.repeat(64) } : undefined,
    error: success ? '' : 'bounded provider failure',
  };
  await writeFile(eventPath, `${JSON.stringify(event)}\n`);

  const state = {
    revision: 9,
    currentPhase: success ? 'GITHUB_COMMIT' : 'BLOCKED',
    dispatch: {
      adapter: ADAPTER,
      status: success ? 'complete' : 'failed',
      resultId: success ? resultId : '',
    },
    storeMetadata: {
      processedEventIds: committed ? [`result-${ACTION_ID}`] : [],
    },
  };

  return { root, sharedWorkspaceRoot, processingPath, eventPath, state };
}

function terminalReceipt(state) {
  return {
    receiptId: `terminal-${state}`,
    state,
    timestampUtc: '2026-09-25T15:45:00.000Z',
  };
}

test('completed execution with exact committed mission result finalizes the stranded queue item without provider replay', async () => {
  const f = await fixture({ success: true });
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILED');
    assert.equal(result.providerReexecutionAllowed, false);
    assert.equal(result.receiptState, 'completed');
    await assert.rejects(access(f.processingPath));
    const completedItem = await readFile(join(f.root, ADAPTER, 'completed', `${ACTION_ID}.json`), 'utf8');
    assert.equal(JSON.parse(completedItem).actionId, ACTION_ID);
    const recovered = JSON.parse(await readFile(result.resultPath, 'utf8'));
    assert.equal(recovered.recoveredAfterInterruption, true);
    assert.equal(recovered.execution.success, true);
    assert.deepEqual(recovered.changedFiles, ['shared/agents/example.mjs']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('failed execution is finalized only after the exact failed result event is durable', async () => {
  const f = await fixture({ success: false });
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('failed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.receiptState, 'failed');
    assert.equal(result.result.execution.success, false);
    assert.equal(result.result.finalVerdict, 'MISSION_WORKER_ITEM_BLOCKED');
    await assert.rejects(access(f.processingPath));
    await access(join(f.root, ADAPTER, 'failed', `${ACTION_ID}.json`));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('terminal receipt without committed result event never finalizes or reexecutes the claim', async () => {
  const f = await fixture({ success: true, committed: false });
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'TERMINAL_ORPHAN_RESULT_EVENT_NOT_COMMITTED');
    assert.equal(result.providerReexecutionAllowed, false);
    await access(f.processingPath);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('live claim ownership prevents terminal queue takeover even when receipt is terminal', async () => {
  const f = await fixture({ success: true });
  let receiptReads = 0;
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'alive', reason: 'MISSION_WORKER_CLAIM_OWNER_ALIVE' }),
      readExecutionReceiptHistory: async () => {
        receiptReads += 1;
        return { ok: true, latestReceipt: terminalReceipt('completed') };
      },
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'TERMINAL_ORPHAN_NONE');
    assert.equal(receiptReads, 0);
    await access(f.processingPath);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


test('terminal orphan finalization accepts proven PID reuse as death proof for the original owner', async () => {
  const f = await fixture({ success: true });
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({
        ok: true,
        state: 'reused',
        reason: 'MISSION_WORKER_CLAIM_OWNER_REUSED',
      }),
      readExecutionReceiptHistory: async () => ({
        ok: true,
        latestReceipt: terminalReceipt('completed'),
      }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILED');
    assert.equal(result.providerReexecutionAllowed, false);
    assert.equal(result.receiptState, 'completed');
    await assert.rejects(access(f.processingPath));
    await access(join(f.root, ADAPTER, 'completed', `${ACTION_ID}.json`));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


test('terminal finalization acquires serialized claim ownership before moving the queue item', async () => {
  const f = await fixture({ success: true });
  let acquireCalls = 0;
  let releaseCalls = 0;
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async (input) => {
        acquireCalls += 1;
        assert.equal(input.adapter, ADAPTER);
        assert.equal(input.actionId, ACTION_ID);
        assert.match(input.queueItemSha256, /^[0-9a-f]{64}$/);
        return {
          acquired: true,
          reason: 'MISSION_WORKER_CLAIM_OWNER_ACQUIRED',
          release: async () => {
            releaseCalls += 1;
            return true;
          },
        };
      },
    });

    assert.equal(result.reconciled, true);
    assert.equal(acquireCalls, 1);
    assert.equal(releaseCalls, 1);
    await assert.rejects(access(f.processingPath));
    await access(join(f.root, ADAPTER, 'completed', `${ACTION_ID}.json`));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('terminal finalizer never moves the queue item when serialized ownership is lost', async () => {
  const f = await fixture({ success: true });
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: false,
        reason: 'MISSION_WORKER_CLAIM_OWNER_ALIVE',
      }),
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'MISSION_WORKER_CLAIM_OWNER_ALIVE');
    assert.equal(result.providerReexecutionAllowed, false);
    await access(f.processingPath);
    await assert.rejects(access(join(f.root, ADAPTER, 'completed', `${ACTION_ID}.json`)));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('terminal finalizer fails closed if queue identity changes after ownership acquisition', async () => {
  const f = await fixture({ success: true });
  let releaseCalls = 0;
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => {
        const changed = { ...item(), createdAt: 'changed-after-proof' };
        await writeFile(f.processingPath, `${JSON.stringify(changed)}\n`);
        return {
          acquired: true,
          release: async () => {
            releaseCalls += 1;
            return true;
          },
        };
      },
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'TERMINAL_ORPHAN_QUEUE_IDENTITY_CHANGED_AFTER_OWNERSHIP');
    assert.equal(releaseCalls, 1);
    assert.equal(result.providerReexecutionAllowed, false);
    await access(f.processingPath);
    await assert.rejects(access(join(f.root, ADAPTER, 'completed', `${ACTION_ID}.json`)));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


function expectedRecoveredCompletedResult() {
  return {
    schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
    actionId: ACTION_ID,
    missionId: MISSION_ID,
    adapter: ADAPTER,
    stateRevision: 9,
    currentPhase: 'GITHUB_COMMIT',
    execution: {
      success: true,
      commandOutputHash: 'c'.repeat(64),
      completedAt: '2026-09-25T15:45:00.000Z',
    },
    changedFiles: ['shared/agents/example.mjs'],
    evidenceReceiptCount: 0,
    recoveredAfterInterruption: true,
    executionReceiptId: 'terminal-completed',
    finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
  };
}

test('stale existing terminal result with a different receipt never authorizes queue finalization', async () => {
  const f = await fixture({ success: true });
  let releaseCalls = 0;
  try {
    const completed = join(f.root, ADAPTER, 'completed');
    await mkdir(completed, { recursive: true });
    const stale = {
      ...expectedRecoveredCompletedResult(),
      executionReceiptId: 'terminal-some-other-execution',
    };
    await writeFile(join(completed, `${ACTION_ID}.result.json`), `${JSON.stringify(stale, null, 2)}\n`);

    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: true,
        release: async () => {
          releaseCalls += 1;
          return true;
        },
      }),
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'TERMINAL_ORPHAN_EXISTING_RESULT_CONFLICT');
    assert.equal(releaseCalls, 1);
    assert.equal(result.providerReexecutionAllowed, false);
    await access(f.processingPath);
    await assert.rejects(access(join(completed, `${ACTION_ID}.json`)));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('exact existing terminal result is idempotently accepted for the same execution receipt', async () => {
  const f = await fixture({ success: true });
  try {
    const completed = join(f.root, ADAPTER, 'completed');
    await mkdir(completed, { recursive: true });
    await writeFile(
      join(completed, `${ACTION_ID}.result.json`),
      `${JSON.stringify(expectedRecoveredCompletedResult(), null, 2)}\n`,
    );

    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: true,
        release: async () => true,
      }),
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.result.executionReceiptId, 'terminal-completed');
    await assert.rejects(access(f.processingPath));
    await access(join(completed, `${ACTION_ID}.json`));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


test('completed terminal orphan retires only the checkpoint bound to the canonical result hash', async () => {
  const f = await fixture({ success: true });
  let cleanupCalls = 0;
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: true,
        release: async () => true,
      }),
      retireTerminalMutationCheckpoint: async (input) => {
        cleanupCalls += 1;
        assert.equal(input.missionId, MISSION_ID);
        assert.equal(input.actionId, ACTION_ID);
        assert.equal(input.expectedPatchSha256, 'c'.repeat(64));
        await access(f.processingPath);
        return {
          ok: true,
          reason: 'PROVIDER_NEUTRAL_TERMINAL_CHECKPOINT_RETIRED',
        };
      },
    });

    assert.equal(result.reconciled, true);
    assert.equal(cleanupCalls, 1);
    assert.equal(result.terminalCheckpointCleanup.ok, true);
    assert.equal(
      result.terminalCheckpointCleanup.reason,
      'PROVIDER_NEUTRAL_TERMINAL_CHECKPOINT_RETIRED',
    );
    await assert.rejects(access(f.processingPath));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('failed terminal orphan preserves mutation checkpoint proof', async () => {
  const f = await fixture({ success: false });
  let cleanupCalls = 0;
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('failed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: true,
        release: async () => true,
      }),
      retireTerminalMutationCheckpoint: async () => {
        cleanupCalls += 1;
        return { ok: true };
      },
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.receiptState, 'failed');
    assert.equal(cleanupCalls, 0);
    assert.equal(result.terminalCheckpointCleanup, null);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


test('terminal recovery accepts an already-published normal result for the exact terminal execution', async () => {
  const f = await fixture({ success: true });
  try {
    const completed = join(f.root, ADAPTER, 'completed');
    await mkdir(completed, { recursive: true });
    const normal = {
      ...expectedRecoveredCompletedResult(),
      recoveredAfterInterruption: false,
      executionReceiptId: 'terminal-completed',
    };
    await writeFile(
      join(completed, `${ACTION_ID}.result.json`),
      `${JSON.stringify(normal, null, 2)}\n`,
    );

    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: true,
        release: async () => true,
      }),
      retireTerminalMutationCheckpoint: async () => ({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_TERMINAL_CHECKPOINT_ALREADY_ABSENT',
      }),
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.resultPublication.reason, 'MISSION_WORKER_RESULT_EXISTING_ACCEPTED');
    await assert.rejects(access(f.processingPath));
    await access(join(completed, `${ACTION_ID}.json`));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('terminal recovery quarantines a truncated legacy result and atomically republishes canonical truth', async () => {
  const f = await fixture({ success: true });
  try {
    const completed = join(f.root, ADAPTER, 'completed');
    await mkdir(completed, { recursive: true });
    const resultPath = join(completed, `${ACTION_ID}.result.json`);
    await writeFile(resultPath, '{"schemaVersion":"truncated"', 'utf8');

    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: true,
        release: async () => true,
      }),
      retireTerminalMutationCheckpoint: async () => ({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_TERMINAL_CHECKPOINT_ALREADY_ABSENT',
      }),
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.resultPublication.reason, 'MISSION_WORKER_RESULT_PUBLISHED');
    assert.ok(result.quarantinedResultPath);
    assert.equal(await readFile(result.quarantinedResultPath, 'utf8'), '{"schemaVersion":"truncated"');
    assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), expectedRecoveredCompletedResult());
    await assert.rejects(access(f.processingPath));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('terminal recovery preserves a valid conflicting result and leaves queue item processing', async () => {
  const f = await fixture({ success: true });
  try {
    const completed = join(f.root, ADAPTER, 'completed');
    await mkdir(completed, { recursive: true });
    const conflict = {
      ...expectedRecoveredCompletedResult(),
      executionReceiptId: 'different-terminal-receipt',
    };
    await writeFile(
      join(completed, `${ACTION_ID}.result.json`),
      `${JSON.stringify(conflict, null, 2)}\n`,
    );

    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({ state: 'dead', reason: 'MISSION_WORKER_CLAIM_OWNER_DEAD' }),
      readExecutionReceiptHistory: async () => ({ ok: true, latestReceipt: terminalReceipt('completed') }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => ({
        acquired: true,
        release: async () => true,
      }),
      retireTerminalMutationCheckpoint: async () => ({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_TERMINAL_CHECKPOINT_ALREADY_ABSENT',
      }),
    });

    assert.equal(result.reconciled, false);
    assert.equal(result.reason, 'TERMINAL_ORPHAN_EXISTING_RESULT_CONFLICT');
    await access(f.processingPath);
    assert.equal(
      JSON.parse(await readFile(join(completed, `${ACTION_ID}.result.json`), 'utf8')).executionReceiptId,
      'different-terminal-receipt',
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});


test('terminal reconciliation may reacquire a released missing owner after exact terminal proof', async () => {
  const f = await fixture({ success: true });
  let acquireCalls = 0;
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({
        ok: true,
        state: 'missing',
        reason: 'MISSION_WORKER_CLAIM_OWNER_MISSING',
      }),
      readExecutionReceiptHistory: async () => ({
        ok: true,
        latestReceipt: terminalReceipt('completed'),
      }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async (input) => {
        acquireCalls += 1;
        assert.equal(input.actionId, ACTION_ID);
        return {
          acquired: true,
          reason: 'MISSION_WORKER_CLAIM_OWNER_ACQUIRED',
          release: async () => true,
        };
      },
      retireTerminalMutationCheckpoint: async () => ({
        ok: true,
        reason: 'PROVIDER_NEUTRAL_TERMINAL_CHECKPOINT_ALREADY_ABSENT',
      }),
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.ownershipState, 'missing');
    assert.equal(acquireCalls, 1);
    assert.equal(result.providerReexecutionAllowed, false);
    await assert.rejects(access(f.processingPath));
    await access(join(f.root, ADAPTER, 'completed', `${ACTION_ID}.json`));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('missing owner without terminal receipt never acquires bookkeeping ownership', async () => {
  const f = await fixture({ success: true });
  let acquireCalls = 0;
  try {
    const result = await reconcileNextProviderNeutralTerminalOrphan({
      queueRoot: f.root,
      sharedWorkspaceRoot: f.sharedWorkspaceRoot,
      adapters: [ADAPTER],
      inspectClaimOwnership: async () => ({
        ok: true,
        state: 'missing',
        reason: 'MISSION_WORKER_CLAIM_OWNER_MISSING',
      }),
      readExecutionReceiptHistory: async () => ({
        ok: true,
        latestReceipt: {
          ...terminalReceipt('completed'),
          state: 'progress',
        },
      }),
      readMissionRecord: async () => ({ state: f.state, eventPath: f.eventPath }),
      acquireClaimOwnership: async () => {
        acquireCalls += 1;
        return { acquired: true, release: async () => true };
      },
    });

    assert.equal(result.reconciled, false);
    assert.equal(acquireCalls, 0);
    assert.equal(result.providerReexecutionAllowed, false);
    await access(f.processingPath);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
