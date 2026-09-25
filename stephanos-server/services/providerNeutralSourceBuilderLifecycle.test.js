import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { processMissionWorkerAgentClaim } from './missionOrchestratorWorkerConsumer.js';
import { processNextProviderNeutralSourceBuild } from './providerNeutralSourceBuilderService.js';

test('provider-neutral source builder delegates external work to the canonical Mission Worker lifecycle', async () => {
  const calls = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    processAgentClaim: async (adapter, lifecycleOptions, execute) => {
      calls.push({ adapter, lifecycleOptions, execute });
      return {
        processed: true,
        claim: {
          item: {
            payload: {
              missionId: 'critical-2002-provider-neutral-resilience',
              actionId: 'critical-2002-provider-neutral-resilience-r1',
            },
          },
        },
        result: {
          finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
          changedFiles: ['shared/agents/example.mjs'],
        },
        executionReceipt: {
          receiptId: 'receipt-provider-neutral-resilience-r1',
          state: 'completed',
        },
        resultPath: 'completed/critical-2002-provider-neutral-resilience-r1.result.json',
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].adapter, 'foundry-forge');
  assert.equal(typeof calls[0].execute, 'function');
  assert.equal(typeof calls[0].lifecycleOptions.runCommand, 'function');
  assert.equal(result.success, true);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED');
  assert.equal(result.executionReceiptId, 'receipt-provider-neutral-resilience-r1');
  assert.equal(result.executionReceiptState, 'completed');
  assert.deepEqual(result.changedFiles, ['shared/agents/example.mjs']);
});

test('provider-neutral source builder keeps independent external adapters productive when one queue is empty', async () => {
  const adapters = [];
  const result = await processNextProviderNeutralSourceBuild({
    processAgentClaim: async (adapter) => {
      adapters.push(adapter);
      if (adapter === 'foundry-forge') return { processed: false, reason: 'queue-empty' };
      return {
        processed: true,
        claim: {
          item: {
            payload: {
              missionId: 'critical-2002-provider-neutral-fallback',
              actionId: 'critical-2002-provider-neutral-fallback-r1',
            },
          },
        },
        result: {
          finalVerdict: 'MISSION_WORKER_ITEM_BLOCKED',
          error: 'bounded provider failure',
          changedFiles: [],
        },
        executionReceipt: {
          receiptId: 'receipt-provider-neutral-fallback-r1',
          state: 'failed',
        },
        resultPath: 'failed/critical-2002-provider-neutral-fallback-r1.result.json',
      };
    },
  });

  assert.deepEqual(adapters, ['foundry-forge', 'chatgpt-github']);
  assert.equal(result.processed, true);
  assert.equal(result.success, false);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.executionReceiptState, 'failed');
  assert.equal(result.failureStage, 'WORKER_PRE_PROVIDER');
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED');
});

test('provider-neutral source builder cannot bypass canonical claim/result lifecycle helpers', async () => {
  const source = await readFile(new URL('./providerNeutralSourceBuilderService.js', import.meta.url), 'utf8');
  assert.match(source, /processMissionWorkerAgentClaim/);
  assert.doesNotMatch(source, /claimNextMissionWorkerItem/);
  assert.doesNotMatch(source, /collectAgentWorkerResult/);
});

test('canonical exported agent lifecycle remains limited to registered execution adapters', async () => {
  await assert.rejects(
    () => processMissionWorkerAgentClaim('unregistered-provider', {}, async () => ({ success: true })),
    /MISSION_WORKER_AGENT_ADAPTER_UNSUPPORTED/,
  );
});


test('provider-neutral source builder surfaces an orphan recovery hold instead of reporting queue empty', async () => {
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    processAgentClaim: async () => ({
      processed: false,
      reason: 'MISSION_WORKER_ORPHAN_RECONCILIATION_REQUIRED:progress',
      orphanRecovery: {
        receiptState: 'progress',
        actionId: 'critical-2002-orphan-r1',
      },
    }),
  });

  assert.equal(result.processed, false);
  assert.equal(result.finalVerdict, 'PROVIDER_NEUTRAL_ORPHAN_RECOVERY_HOLD');
  assert.equal(result.reason, 'MISSION_WORKER_ORPHAN_RECONCILIATION_REQUIRED:progress');
  assert.equal(result.orphanRecovery.adapter, 'foundry-forge');
  assert.equal(result.orphanRecovery.detail.receiptState, 'progress');
});


test('provider-neutral builder preserves terminal orphan reconciliation telemetry without pretending source changed', async () => {
  const terminal = {
    reconciled: true,
    missionId: 'critical-2002-terminal',
    actionId: 'critical-2002-terminal-r1',
    finalVerdict: 'PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILED',
  };
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    reconcileTerminalOrphan: async () => terminal,
    processAgentClaim: async () => ({ processed: false, reason: 'queue-empty' }),
  });

  assert.equal(result.processed, false);
  assert.equal(result.reason, 'queue-empty');
  assert.deepEqual(result.terminalReconciliation, terminal);
});
