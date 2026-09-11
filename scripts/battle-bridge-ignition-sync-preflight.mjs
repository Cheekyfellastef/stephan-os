#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runBattleBridgeSyncAndRefresh } from './battle-bridge-github-sync-and-refresh.mjs';

export const BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA = 'stephanos.battle-bridge-ignition-sync-preflight.v1';
export const BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT_MARKER = 'BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT=';

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_BLOCKER = /^[A-Z0-9_:-]{1,160}$/;

function text(value) {
  return String(value ?? '').trim();
}

function safeHead(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function safeBlocker(value, fallback) {
  const normalized = text(value);
  return SAFE_BLOCKER.test(normalized) ? normalized : fallback;
}

function projectSyncAndRefreshResult(result = {}) {
  return Object.freeze({
    sourceHead: safeHead(result?.sourceHead),
    syncClassification: text(result?.syncClassification),
    refreshCount: Array.isArray(result?.refreshes) ? result.refreshes.length : 0,
    pendingRefreshObserved: result?.pendingRefreshObserved === true,
    sourceForwardedBeforeRefresh: result?.sourceForwardedBeforeRefresh === true,
    refreshDebtCoalesced: result?.refreshDebtCoalesced === true,
    controlPlaneRepairObserved: result?.controlPlaneRepairObserved === true,
  });
}

export async function runBattleBridgeIgnitionSyncPreflight({
  platform = process.platform,
  syncAndRefreshFn = runBattleBridgeSyncAndRefresh,
} = {}) {
  if (platform !== 'win32') {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
      ok: true,
      skipped: true,
      classification: 'IGNITION_SYNC_PREFLIGHT_SKIPPED_NON_WINDOWS',
      sourceHead: '',
      blocker: '',
      finalVerdict: 'IGNITION_SYNC_PREFLIGHT_SKIPPED',
    });
  }

  const result = await syncAndRefreshFn({ platform });
  const projection = projectSyncAndRefreshResult(result);

  if (result?.ok !== true) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
      ok: false,
      skipped: false,
      classification: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
      ...projection,
      blocker: safeBlocker(result?.blocker, 'IGNITION_SYNC_AND_REFRESH_BLOCKED'),
      finalVerdict: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
    });
  }

  if (result?.finalVerdict !== 'SYNC_AND_REFRESH_PASS' || !projection.sourceHead) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
      ok: false,
      skipped: false,
      classification: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
      ...projection,
      blocker: 'IGNITION_SYNC_AND_REFRESH_PROOF_INVALID',
      finalVerdict: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
    });
  }

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
    ok: true,
    skipped: false,
    classification: 'IGNITION_SYNC_PREFLIGHT_PASS',
    ...projection,
    blocker: '',
    finalVerdict: 'IGNITION_SYNC_PREFLIGHT_PASS',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runBattleBridgeIgnitionSyncPreflight();
    process.stdout.write(`${BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT_MARKER}${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 2;
  } catch (error) {
    const blocker = safeBlocker(error?.message, 'IGNITION_SYNC_PREFLIGHT_FAILED');
    const result = Object.freeze({
      schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
      ok: false,
      skipped: false,
      classification: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
      sourceHead: '',
      blocker,
      finalVerdict: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
    });
    process.stdout.write(`${BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT_MARKER}${JSON.stringify(result)}\n`);
    process.exitCode = 2;
  }
}
