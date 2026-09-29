import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS,
  WORKER_WATCHDOG_PUBLICATION_RESERVE_MS,
  WORKER_WATCHDOG_START_TIMEOUT_MS,
} from './battle-bridge-worker-watchdog.mjs';

const restartSource = await readFile(
  new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url),
  'utf8',
);

test('watchdog preserves restart authority plus cleanup and terminal-publication margin', () => {
  const cleanupBudgetSeconds = Number(
    restartSource.match(/\$missionWorkerCleanupTimeoutSeconds\s*=\s*(\d+)/)?.[1],
  );

  assert.equal(cleanupBudgetSeconds, 10);
  assert.equal(WORKER_WATCHDOG_PUBLICATION_RESERVE_MS, 5_000);
  assert.equal(WORKER_WATCHDOG_START_TIMEOUT_MS, 100_000);
  assert.equal(WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS, 15_000);
  assert.equal(
    WORKER_WATCHDOG_START_TIMEOUT_MS - WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS,
    85_000,
    'the fixed restart authority budget must remain 85 seconds',
  );
  assert.equal(
    WORKER_WATCHDOG_CHILD_EXIT_RESERVE_MS,
    cleanupBudgetSeconds * 1_000 + WORKER_WATCHDOG_PUBLICATION_RESERVE_MS,
    'child-exit reserve must include the full cleanup observation plus terminal-publication margin',
  );
});
