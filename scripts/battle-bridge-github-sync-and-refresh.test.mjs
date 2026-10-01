import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBattleBridgeSyncAndRefresh,
} from './battle-bridge-github-sync-and-refresh.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const paths = { repoRoot: '/canonical/repo', workspaceRoot: '/canonical/workspace' };

function noChange(head = B) {
  return { ok: true, evaluation: { classification: 'SYNC_NO_CHANGE' }, facts: { localHead: head, remoteHead: head } };
}

function updated(before = A, after = B) {
  return {
    ok: false,
    sourceUpdated: true,
    evaluation: { classification: 'BLOCKED_POST_SYNC_REFRESH_REQUIRED' },
    facts: { localHead: before, localHeadBefore: before, localHeadAfter: after, remoteHead: after },
  };
}

function blocked(classification = 'BLOCKED_DIRTY_SOURCE', head = A) {
  return {
    ok: false,
    sourceUpdated: false,
    evaluation: { classification },
    facts: { localHead: head, remoteHead: head },
  };
}

function safeGoalDiscoveryArgs() {
  return { goalDiscoveryHeartbeat: async () => ({ ok: true, finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE' }) };
}

function nonWindowsRepairArgs() {
  return {
    platform: 'linux',
    controlPlaneReconciler() { throw new Error('must not run on non-Windows'); },
    ...safeGoalDiscoveryArgs(),
  };
}

test('pending old-executor refresh is paid after a safe source observation and then reconverges', async () => {
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: true, beforeHead: A, afterHead: B }),
    adapter: {
      runRefresh(input) { calls.push(['refresh', input.beforeHead, input.afterHead]); return { ok: true, result: { ok: true, sourceHead: B } }; },
      runSync() { calls.push(['sync']); return { ok: true, result: noChange(B) }; },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['sync'], ['refresh', A, B], ['sync']]);
  assert.equal(result.pendingRefreshObserved, true);
  assert.equal(result.sourceForwardedBeforeRefresh, false);
  assert.equal(result.refreshDebtCoalesced, false);
  assert.equal(result.freshCoordinatorProcessUsed, true);
  assert.equal(result.controlPlaneRepair.classification, 'CONTROL_PLANE_REPAIR_SKIPPED_NON_WINDOWS');
  assert.equal(result.goalDiscoveryObserved, true);
});

test('stale refresh debt cannot strand delivery of its own repair and is coalesced to newest exact head', async () => {
  const calls = [];
  const syncResults = [updated(B, C), noChange(C)];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: true, beforeHead: A, afterHead: B }),
    adapter: {
      runSync() { calls.push('sync'); return { ok: true, result: syncResults.shift() }; },
      runRefresh(input) {
        calls.push(`refresh:${input.beforeHead}:${input.afterHead}`);
        return { ok: true, result: { ok: true, sourceHead: input.afterHead } };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['sync', `refresh:${A}:${C}`, 'sync']);
  assert.equal(result.sourceHead, C);
  assert.equal(result.pendingRefreshObserved, true);
  assert.equal(result.sourceForwardedBeforeRefresh, true);
  assert.equal(result.refreshDebtCoalesced, true);
  assert.equal(result.refreshes[0].pendingAfterHead, B);
  assert.equal(result.refreshes[0].debtCoalesced, true);
});

test('new source update without old debt refreshes and then runs a second sync for current-state convergence', async () => {
  const calls = [];
  const syncResults = [updated(), noChange()];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync() { calls.push('sync'); return { ok: true, result: syncResults.shift() }; },
      runRefresh(input) { calls.push(`refresh:${input.beforeHead}:${input.afterHead}`); return { ok: true, result: { ok: true, sourceHead: B } }; },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['sync', `refresh:${A}:${B}`, 'sync']);
  assert.equal(result.sourceForwardedBeforeRefresh, false);
  assert.equal(result.refreshDebtCoalesced, false);
});

test('converged Windows sync wakes goal discovery and reconciles the fixed recovery mesh', async () => {
  const repairs = [];
  const wakeups = [];
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    platform: 'win32',
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runRefresh() { throw new Error('refresh should not run'); },
    },
    controlPlaneReconciler(input) {
      calls.push('repair');
      repairs.push(input);
      return {
        ok: true,
        finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED',
        arbitraryTaskNameAllowed: false,
        arbitraryShellAllowed: false,
        sourceMutationAllowed: false,
        gitMutationAllowed: false,
        pcRestartAllowed: false,
      };
    },
    goalDiscoveryHeartbeat: async () => {
      calls.push('goal-discovery');
      wakeups.push('goal-discovery');
      return { ok: true, finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.controlPlaneRepair.classification, 'CONTROL_PLANE_RECONCILED');
  assert.equal(result.controlPlaneRepair.repairAttempted, true);
  assert.deepEqual(repairs, [{ repoRoot: paths.repoRoot, expectedHead: B, platform: 'win32' }]);
  assert.deepEqual(wakeups, ['goal-discovery']);
  assert.deepEqual(calls, ['goal-discovery', 'repair']);
  assert.equal(result.goalDiscoveryObserved, true);
  assert.equal(result.workConservingGoalDiscoveryPreserved, true);
});

test('control-plane repair failure still blocks wrapper completion after one work-conserving goal-discovery tick', async () => {
  let wakeups = 0;
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    platform: 'win32',
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runRefresh() { throw new Error('refresh should not run'); },
    },
    controlPlaneReconciler() {
      calls.push('repair');
      return { ok: false, blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED' };
    },
    goalDiscoveryHeartbeat: async () => {
      calls.push('goal-discovery');
      wakeups += 1;
      return { ok: true, finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED');
  assert.equal(result.controlPlaneRepair.repairAttempted, true);
  assert.equal(wakeups, 1);
  assert.deepEqual(calls, ['goal-discovery', 'repair']);
  assert.equal(result.goalDiscoveryObserved, true);
  assert.equal(result.workConservingGoalDiscoveryPreserved, true);
});

test('goal discovery failure blocks otherwise converged completion', async () => {
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync() { return { ok: true, result: noChange() }; },
      runRefresh() { throw new Error('refresh should not run'); },
    },
    goalDiscoveryHeartbeat: async () => ({ ok: false, blocker: 'NO_QUALIFIED_CAPACITY', finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'NO_QUALIFIED_CAPACITY');
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_GOAL_DISCOVERY_BLOCKED');
});

test('refresh blocker stops without starting another sync cycle', async () => {
  let syncCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => null,
    adapter: {
      runSync() { syncCalls += 1; return { ok: true, result: updated() }; },
      runRefresh() { return { ok: true, result: { ok: false, blocker: 'OPENCLAW_REFRESH_APPROVAL_REQUIRED' } }; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_REFRESH_APPROVAL_REQUIRED');
  assert.equal(syncCalls, 1);
});

test('malformed refresh debt cannot block a safe source-forward but still blocks runtime completion', async () => {
  let refreshCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: false, blocker: 'PENDING_POST_SYNC_HEADS_INVALID' }),
    adapter: {
      runSync() { return { ok: true, result: updated(A, B) }; },
      runRefresh() { refreshCalls += 1; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PENDING_POST_SYNC_HEADS_INVALID');
  assert.equal(result.sourceHead, B);
  assert.equal(result.sourceForwardedBeforeRefresh, true);
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED');
  assert.equal(refreshCalls, 0);
});

test('unsafe source state still fails closed before any pending refresh execution', async () => {
  let refreshCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    ...nonWindowsRepairArgs(),
    pendingReader: async () => ({ ok: true, beforeHead: A, afterHead: B }),
    adapter: {
      runSync() { return { ok: true, result: blocked('BLOCKED_DIRTY_SOURCE', B) }; },
      runRefresh() { refreshCalls += 1; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BLOCKED_DIRTY_SOURCE');
  assert.equal(refreshCalls, 0);
});

test('default transport launches only fixed Node scripts without a shell and uses fixed control-plane and goal-discovery owners', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./battle-bridge-github-sync-and-refresh.mjs', import.meta.url), 'utf8');
  assert.match(source, /battle-bridge-github-sync-executor\.mjs/);
  assert.match(source, /battle-bridge-post-sync-refresh\.mjs/);
  assert.match(source, /battleBridgeControlPlaneSelfRepairV1\.mjs/);
  assert.match(source, /battle-bridge-goal-discovery-heartbeat\.mjs/);
  assert.match(source, /reconcileBattleBridgeControlPlane/);
  assert.match(source, /runBattleBridgeGoalDiscoveryHeartbeat/);
  assert.match(source, /platform !== 'win32'/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression|cmd\.exe/i);
});
