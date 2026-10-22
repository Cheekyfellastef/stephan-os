import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
  runBattleBridgeIgnitionSyncPreflight,
} from './battle-bridge-ignition-sync-preflight.mjs';

const HEAD = 'a'.repeat(40);
const CANONICAL_REPO = '/canonical/stephan-os';

function canonicalWindowsOptions(overrides = {}) {
  return {
    platform: 'win32',
    repoRoot: CANONICAL_REPO,
    canonicalRepoRoot: CANONICAL_REPO,
    ...overrides,
  };
}

test('non-Windows ignition sync preflight skips without invoking the Battle Bridge updater', async () => {
  let invoked = false;
  const result = await runBattleBridgeIgnitionSyncPreflight({
    platform: 'linux',
    syncAndRefreshFn: async () => {
      invoked = true;
      return { ok: true };
    },
  });

  assert.equal(invoked, false);
  assert.equal(result.schemaVersion, BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.classification, 'IGNITION_SYNC_PREFLIGHT_SKIPPED_NON_WINDOWS');
});

test('Windows proof worktree skips canonical updater instead of reaching sideways into main', async () => {
  let invoked = false;
  const result = await runBattleBridgeIgnitionSyncPreflight({
    platform: 'win32',
    repoRoot: '/proof/stephan-os-pr-2173',
    canonicalRepoRoot: CANONICAL_REPO,
    syncAndRefreshFn: async () => {
      invoked = true;
      return { ok: true };
    },
  });

  assert.equal(invoked, false);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.classification, 'IGNITION_SYNC_PREFLIGHT_SKIPPED_NON_CANONICAL_CHECKOUT');
  assert.equal(result.sourceHead, '');
});

test('Windows ignition sync preflight reuses the canonical sync-and-refresh coordinator', async () => {
  const calls = [];
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async (options) => {
      calls.push(options);
      return {
        ok: true,
        sourceHead: HEAD,
        syncClassification: 'SYNC_NO_CHANGE',
        refreshes: [{ beforeHead: 'b'.repeat(40), afterHead: HEAD }],
        pendingRefreshObserved: true,
        sourceForwardedBeforeRefresh: true,
        refreshDebtCoalesced: false,
        controlPlaneRepairObserved: true,
        finalVerdict: 'SYNC_AND_REFRESH_PASS',
      };
    },
  }));

  assert.deepEqual(calls, [{ platform: 'win32' }]);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.classification, 'IGNITION_SYNC_PREFLIGHT_PASS');
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.refreshCount, 1);
  assert.equal(result.pendingRefreshObserved, true);
  assert.equal(result.sourceForwardedBeforeRefresh, true);
  assert.equal(result.controlPlaneRepairObserved, true);
  assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_PASS');
});

test('Windows ignition keeps core startup moving when only auxiliary control-plane repair is degraded', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: false,
      blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
      sourceHead: HEAD,
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [],
      controlPlaneRepair: {
        ok: false,
        classification: 'CONTROL_PLANE_REPAIR_BLOCKED',
        blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
        repairAttempted: true,
      },
      finalVerdict: 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED',
    }),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.classification, 'IGNITION_SYNC_PREFLIGHT_PASS_CONTROL_PLANE_DEGRADED');
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.syncClassification, 'SYNC_NO_CHANGE');
  assert.equal(result.controlPlaneDegraded, true);
  assert.equal(result.controlPlaneBlocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.equal(result.blocker, '');
  assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_PASS');
});

test('Windows ignition does not waive control-plane failure without proven current source', async () => {
  for (const candidate of [
    {
      sourceHead: 'short-head',
      syncClassification: 'SYNC_NO_CHANGE',
    },
    {
      sourceHead: HEAD,
      syncClassification: 'BLOCKED_SOURCE_DIRTY',
    },
  ]) {
    const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
      syncAndRefreshFn: async () => ({
        ok: false,
        blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
        refreshes: [],
        finalVerdict: 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED',
        ...candidate,
      }),
    }));

    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
    assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_BLOCKED');
  }
});

test('Windows ignition sync preflight fails closed when canonical sync-and-refresh is blocked', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: false,
      blocker: 'BLOCKED_SOURCE_DIRTY',
      sourceHead: HEAD,
      syncClassification: 'BLOCKED_SOURCE_DIRTY',
      refreshes: [],
      finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
    }),
  }));

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BLOCKED_SOURCE_DIRTY');
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_BLOCKED');
});

test('Windows ignition sync preflight rejects a claimed success without exact-head proof', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: true,
      sourceHead: 'short-head',
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [],
      controlPlaneRepairObserved: true,
      finalVerdict: 'SYNC_AND_REFRESH_PASS',
    }),
  }));

  assert.equal(result.ok, false);
  assert.equal(result.sourceHead, '');
  assert.equal(result.blocker, 'IGNITION_SYNC_AND_REFRESH_PROOF_INVALID');
  assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_BLOCKED');
});

test('Windows ignition sync preflight rejects a non-pass coordinator verdict', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: true,
      sourceHead: HEAD,
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [],
      controlPlaneRepairObserved: true,
      finalVerdict: 'UNEXPECTED_SUCCESS_VERDICT',
    }),
  }));

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'IGNITION_SYNC_AND_REFRESH_PROOF_INVALID');
});
