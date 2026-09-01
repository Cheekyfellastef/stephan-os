import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

test('canonical Windows Mission Worker watchdog probe selects only the existing Mission Worker refresh target', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
    'scripts/mission-worker-probe-legacy-heartbeat.test.mjs',
    'scripts/battle-bridge-worker-watchdog-policy.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.MISSION_WORKER]);
  assert.equal(plan.changedPathCount, 3);
  assert.equal(plan.noRuntimePathCount, 2);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('nearby unregistered Windows runtime path still fails closed', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/windows/probe-some-other-unregistered-worker.ps1',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.unknownPathCount, 1);
  assert.equal(plan.automaticExecutionAllowed, false);
});
