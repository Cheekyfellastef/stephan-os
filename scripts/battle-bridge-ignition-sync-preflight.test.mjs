import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
  runBattleBridgeIgnitionSyncPreflight,
} from './battle-bridge-ignition-sync-preflight.mjs';

const HEAD = 'a'.repeat(40);
const CANONICAL_REPO = '/canonical/stephan-os';
function canonicalRefreshFields() {
  return { schemaVersion: 'stephanos.post-sync-runtime-refresh.v1', beforeHead: 'b'.repeat(40), afterHead: HEAD,
    changedPathCount: 1, noRuntimePathCount: 0, unknownPathCount: 0, unsafePathCount: 0, openClawPathCount: 0,
    spatialAdoptionPathCount: 0, spatialAdoptionRequired: false, pluginHostActivationRequired: false,
    governorRefreshRequired: false, sovereignRelayRefreshRequired: false,
    exactHeadProofOk: false, finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_BLOCKED' };
}
function canonicalSettledRefresh() {
  const beforeHead = 'b'.repeat(40);
  return { schemaVersion: 'stephanos.ignition-settled-refresh.v1', sourceHead: HEAD,
    syncStatusRecord: { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status',
      statusId: 'battle-bridge-github-sync-current', classification: 'SYNC_NO_CHANGE', localHeadBefore: HEAD,
      remoteHeadObserved: HEAD, pendingRefresh: null },
    refreshCompletionRecord: { ...canonicalRefreshFields(), schemaVersion: 'shared-agent-workspace-record.v1',
      kind: 'stephanos.shared_workspace.status', statusId: 'post-sync-runtime-refresh-current', phase: 'complete',
      classification: 'NO_RUNTIME_REFRESH_REQUIRED', finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS',
      exactHeadProofOk: true, blocker: '', noRuntimePathCount: 1, targetIds: [], resultTargets: [] },
    ancestry: [{ beforeHead, afterHead: HEAD, ancestor: true }, { beforeHead: HEAD, afterHead: beforeHead, ancestor: false }] };
}


function canonicalWindowsOptions(overrides = {}) {
  return {
    platform: 'win32',
    repoRoot: CANONICAL_REPO,
    canonicalRepoRoot: CANONICAL_REPO,
    ...overrides,
  };
}

test('sync preflight preserves only closed typed sync refusal reasons without treating them as startup permission', async () => {
  for (const reason of ['SYNC_ALREADY_RUNNING', 'LOCK_ACQUISITION_FAILED', 'C:\\private\\path', 'SECRET_TOKEN']) {
    const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
      syncAndRefreshFn: async () => ({ ok: false, blocker: 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED',
        syncClassification: 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED', syncBlockerReason: reason,
        finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' }),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED');
    assert.equal(result.syncBlockerReason, ['SYNC_ALREADY_RUNNING', 'LOCK_ACQUISITION_FAILED'].includes(reason) ? reason : '');
    assert.doesNotMatch(JSON.stringify(result), /private|SECRET_TOKEN/);
  }
});

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
      settledRefreshEvidence: canonicalSettledRefresh(),
      controlPlaneRepair: {
        ok: false,
        classification: 'CONTROL_PLANE_REPAIR_BLOCKED',
        blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
        repairAttempted: true,
        sourceHead: HEAD,
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

test('Windows ignition proceeds degraded when only Sovereign Commander is held by timeout custody', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: false,
      blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
      sourceHead: HEAD,
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [{
        beforeHead: 'b'.repeat(40),
        afterHead: HEAD,
        result: {
          ...canonicalRefreshFields(),
          ok: false,
          classification: 'BLOCKED_REFRESH_FAILED',
          blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
          targetIds: ['stephanos-ui-4173','stephanos-backend-8787','mission-orchestrator-worker','github-command-mailbox','sovereign-commander'],
          resultTargets: [
            { targetId:'stephanos-ui-4173', ok:true, exactHeadProofOk:true, sourceHead:HEAD, blocker:'' },
            { targetId:'stephanos-backend-8787', ok:true, exactHeadProofOk:true, sourceHead:HEAD, blocker:'' },
            { targetId:'mission-orchestrator-worker', ok:true, exactHeadProofOk:true, sourceHead:HEAD, blocker:'' },
            { targetId:'github-command-mailbox', ok:true, exactHeadProofOk:true, sourceHead:HEAD, blocker:'' },
            { targetId:'sovereign-commander', ok:false, exactHeadProofOk:false, sourceHead:HEAD, blocker:'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' },
          ],
        },
      }],
      finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
    }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'IGNITION_SYNC_PREFLIGHT_PASS_COMMANDER_CUSTODY_DEGRADED');
  assert.equal(result.commanderDegraded, true);
  assert.equal(result.commanderBlocker, 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN');
  assert.equal(result.blocker, '');
});

test('Windows ignition proceeds degraded when only desktop plugin-host activation remains after every runtime target is exact-head green', async () => {
  const targetIds = [
    'stephanos-ui-4173',
    'stephanos-backend-8787',
    'mission-orchestrator-worker',
    'github-command-mailbox',
    'sovereign-commander',
    'natural-reload',
  ];
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: false,
      blocker: 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN',
      sourceHead: HEAD,
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [{
        result: {
          ...canonicalRefreshFields(),
          ok: false,
          classification: 'BLOCKED_REFRESH_FAILED',
          blocker: 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN',
          pluginHostActivationRequired: true,
          safeRefreshesCompleted: true,
          targetIds,
          resultTargets: targetIds.map(targetId => ({
            targetId,
            ok: true,
            exactHeadProofOk: true,
            sourceHead: HEAD,
            blocker: '',
          })),
        },
      }],
      finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
    }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'IGNITION_SYNC_PREFLIGHT_PASS_PLUGIN_HOST_DEGRADED');
  assert.equal(result.pluginHostDegraded, true);
  assert.equal(result.pluginHostBlocker, 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN');
  assert.equal(result.blocker, '');
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_PASS');
});

test('Windows ignition never degrades plugin-host debt when runtime proof is incomplete or plugin hold is not exact', async () => {
  const targetIds = ['stephanos-ui-4173', 'sovereign-commander'];
  const greenRows = targetIds.map(targetId => ({
    targetId, ok: true, exactHeadProofOk: true, sourceHead: HEAD, blocker: '',
  }));
  const cases = [
    { pluginHostActivationRequired: false },
    { safeRefreshesCompleted: false },
    { resultTargets: [{ ...greenRows[0], ok: false, exactHeadProofOk: false, blocker: 'UI_4173_EXACT_HEAD_PROOF_FAILED' }, greenRows[1]] },
    { resultTargets: greenRows.slice(0, 1) },
    { resultTargets: [{ ...greenRows[0], sourceHead: 'b'.repeat(40) }, greenRows[1]] },
  ];
  for (const change of cases) {
    const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
      syncAndRefreshFn: async () => ({
        ok: false,
        blocker: 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN',
        sourceHead: HEAD,
        syncClassification: 'SYNC_NO_CHANGE',
        refreshes: [{
          result: {
            ok: false,
            classification: 'BLOCKED_REFRESH_FAILED',
            blocker: 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN',
            pluginHostActivationRequired: true,
            safeRefreshesCompleted: true,
            targetIds,
            resultTargets: greenRows,
            ...change,
          },
        }],
        finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
      }),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.finalVerdict, 'IGNITION_SYNC_PREFLIGHT_BLOCKED');
  }
});

test('Windows ignition does not degrade when a target before Commander is missing even if natural reload is trailing', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: false,
      blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
      sourceHead: HEAD,
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [{
        result: {
          ok: false,
          classification: 'BLOCKED_REFRESH_FAILED',
          blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
          targetIds: ['stephanos-ui-4173','stephanos-backend-8787','sovereign-commander','natural-reload'],
          resultTargets: [
            { targetId:'stephanos-ui-4173', ok:true, exactHeadProofOk:true, sourceHead:HEAD, blocker:'' },
            { targetId:'sovereign-commander', ok:false, exactHeadProofOk:false, sourceHead:HEAD, blocker:'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' },
          ],
        },
      }],
      finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
    }),
  }));
  assert.equal(result.ok, false);
});

test('Windows ignition keeps blocking when any non-Commander refresh target also fails', async () => {
  const result = await runBattleBridgeIgnitionSyncPreflight(canonicalWindowsOptions({
    syncAndRefreshFn: async () => ({
      ok: false,
      blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
      sourceHead: HEAD,
      syncClassification: 'SYNC_NO_CHANGE',
      refreshes: [{
        result: {
          ok: false,
          classification: 'BLOCKED_REFRESH_FAILED',
          blocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
          targetIds: ['stephanos-ui-4173','sovereign-commander'],
          resultTargets: [
            { targetId:'stephanos-ui-4173', ok:false, exactHeadProofOk:false, sourceHead:HEAD, blocker:'UI_4173_EXACT_HEAD_PROOF_FAILED' },
            { targetId:'sovereign-commander', ok:false, exactHeadProofOk:false, sourceHead:HEAD, blocker:'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' },
          ],
        },
      }],
      finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
    }),
  }));
  assert.equal(result.ok, false);
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
