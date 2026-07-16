#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
  const visibilityOk = codexVisibility?.ok === true;
  const workerWatchdogOk = watchdog?.ok === true;
  return Object.freeze({
    ...watchdog,
    ok: visibilityOk && workerWatchdogOk,
    schemaVersion: BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA,
    codexVisibility,
    codexVisibilityObserved: true,
    visibilityOk,
    workerWatchdogOk,
  });
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await runBattleBridgeWorkerWatchdogRunner();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
