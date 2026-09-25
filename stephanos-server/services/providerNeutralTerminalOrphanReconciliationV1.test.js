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
