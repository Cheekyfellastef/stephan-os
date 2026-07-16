#!/usr/bin/env node
import process from 'node:process';

import { runBattleBridgeWorkerWatchdog } from './battle-bridge-worker-watchdog.mjs';
import { observeRemoteCodexTaskVisibility } from './remote-codex-task-visibility-observer.mjs';

export const BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA = 'stephanos.battle-bridge-worker-watchdog-runner-with-codex-visibility.v1';

export async function runBattleBridgeWorkerWatchdogRunner({
  visibilityObserver = observeRemoteCodexTaskVisibility,
  workerWatchdog = runBattleBridgeWorkerWatchdog,
} = {}) {
  let codexVisibility = null;
  try {
    codexVisibility = await visibilityObserver();
  } catch (error) {
    codexVisibility = {
      ok: false,
      classification: 'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED',
      reason: error?.message || String(error),
    };
  }

  const watchdog = await workerWatchdog();
  return Object.freeze({
    ...watchdog,
    schemaVersion: BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA,
    codexVisibility,
    codexVisibilityObserved: true,
  });
}

const result = await runBattleBridgeWorkerWatchdogRunner();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 2;
