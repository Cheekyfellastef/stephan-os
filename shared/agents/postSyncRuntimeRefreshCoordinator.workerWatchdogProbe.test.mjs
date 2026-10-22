import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
  parseGitChangedPathStatus,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const WATCHDOG_PROBE = 'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1';

test('canonical Windows Mission Worker watchdog probe selects only the existing Mission Worker refresh target', () => {
  const plan = classifyPostSyncRefresh([
    WATCHDOG_PROBE,
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

test('deleting or renaming away the authority-bearing watchdog probe fails closed before refresh', () => {
  for (const statusLine of [
    `D\t${WATCHDOG_PROBE}`,
    `R100\t${WATCHDOG_PROBE}\tscripts/windows/probe-mission-orchestrator-worker-watchdog-renamed.ps1`,
  ]) {
    const parsed = parseGitChangedPathStatus(statusLine);
    assert.equal(parsed.ok, false, statusLine);
    assert.equal(parsed.blocker, 'POST_SYNC_CANONICAL_WORKER_WATCHDOG_PROBE_REMOVED', statusLine);
    assert.deepEqual(parsed.paths, [], statusLine);
  }

  const modified = parseGitChangedPathStatus(`M\t${WATCHDOG_PROBE}`);
  assert.equal(modified.ok, true);
  assert.deepEqual(modified.paths, [WATCHDOG_PROBE]);
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
