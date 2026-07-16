import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA,
  runBattleBridgeWorkerWatchdogRunner,
} from './battle-bridge-worker-watchdog-runner.mjs';

test('runner reconciles Remote Codex visibility before the worker watchdog', async () => {
  const calls = [];
  const result = await runBattleBridgeWorkerWatchdogRunner({
    visibilityObserver: async () => {
      calls.push('visibility');
      return { ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' };
    },
    workerWatchdog: async () => {
      calls.push('watchdog');
      return { ok: true, classification: 'WORKER_WATCHDOG_HEALTHY' };
    },
  });

  assert.deepEqual(calls, ['visibility', 'watchdog']);
  assert.equal(result.schemaVersion, BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA);
  assert.equal(result.codexVisibilityObserved, true);
  assert.equal(result.codexVisibility.classification, 'REMOTE_CODEX_VISIBILITY_RECONCILED');
  assert.equal(result.classification, 'WORKER_WATCHDOG_HEALTHY');
});

test('visibility reconciliation failure is surfaced but does not disable the mission worker watchdog', async () => {
  let watchdogCalled = false;
  const result = await runBattleBridgeWorkerWatchdogRunner({
    visibilityObserver: async () => { throw new Error('observer failed'); },
    workerWatchdog: async () => {
      watchdogCalled = true;
      return { ok: true, classification: 'WORKER_WATCHDOG_HEALTHY' };
    },
  });

  assert.equal(watchdogCalled, true);
  assert.equal(result.codexVisibility.ok, false);
  assert.equal(result.codexVisibility.classification, 'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED');
  assert.match(result.codexVisibility.reason, /observer failed/);
});
