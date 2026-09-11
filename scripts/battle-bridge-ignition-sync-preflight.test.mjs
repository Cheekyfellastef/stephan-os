import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
  runBattleBridgeIgnitionSyncPreflight,
} from './battle-bridge-ignition-sync-preflight.mjs';

const HEAD = 'a'.repeat(40);

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

test('Windows ignition sync preflight reuses the canonical sync-and-refresh coordinator', async () => {
  const calls = [];
  const result = await runBattleBridgeIgnitionSyncPreflight({
    platform: 'win32',
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
  });

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

test('Windows ignition sync preflight fails closed when canonical sync-and-refresh is blocked', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight({
    platform: 'win32',
    syncAndRefreshFn: async () => ({
      ok: false,
      blocker: 'BLOCKED_SOURCE_DIRTY',
      sourceHead: HEAD,
      syncClassification: 'BLOCKED_SOURCE_DIRTY',
      refreshes: [],
      finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BLOCKED_SOURCE_DIRTY');
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_BLOCKED');
});

test('Windows ignition sync preflight rejects a claimed success without exact-head proof', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight({
    platform: 'win32',
    syncAndRefreshFn: async () => ({
      ok: true,
      sourceHead: 'short-head',
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [],
      controlPlaneRepairObserved: true,
      finalVerdict: 'SYNC_AND_REFRESH_PASS',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.sourceHead, '');
  assert.equal(result.blocker, 'IGNITION_SYNC_AND_REFRESH_PROOF_INVALID');
  assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_BLOCKED');
});

test('Windows ignition sync preflight rejects a non-pass coordinator verdict', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight({
    platform: 'win32',
    syncAndRefreshFn: async () => ({
      ok: true,
      sourceHead: HEAD,
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [],
      controlPlaneRepairObserved: true,
      finalVerdict: 'UNEXPECTED_SUCCESS_VERDICT',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'IGNITION_SYNC_AND_REFRESH_PROOF_INVALID');
});
