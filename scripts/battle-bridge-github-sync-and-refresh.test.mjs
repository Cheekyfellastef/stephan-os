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

function nonWindowsRepairArgs() {
  return { platform: 'linux', controlPlaneReconciler() { throw new Error('must not run on non-Windows'); } };
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

test('converged Windows sync reconciles the fixed recovery mesh and mailbox control plane', async () => {
  const repairs = [];
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
  });
  assert.equal(result.ok, true);
  assert.equal(result.controlPlaneRepair.classification, 'CONTROL_PLANE_RECONCILED');
  assert.equal(result.controlPlaneRepair.repairAttempted, true);
  assert.deepEqual(repairs, [{ repoRoot: paths.repoRoot, expectedHead: B, platform: 'win32' }]);
});

test('control-plane repair failure blocks sync completion instead of masking a detached mailbox', async () => {
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
      return { ok: false, blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED');
  assert.equal(result.controlPlaneRepair.repairAttempted, true);
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

test('default transport launches only fixed Node scripts without a shell and uses fixed control-plane reconciler', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./battle-bridge-github-sync-and-refresh.mjs', import.meta.url), 'utf8');
  assert.match(source, /battle-bridge-github-sync-executor\.mjs/);
  assert.match(source, /battle-bridge-post-sync-refresh\.mjs/);
  assert.match(source, /battleBridgeControlPlaneSelfRepairV1\.mjs/);
  assert.match(source, /reconcileBattleBridgeControlPlane/);
  assert.match(source, /platform !== 'win32'/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression|cmd\.exe/i);
});
