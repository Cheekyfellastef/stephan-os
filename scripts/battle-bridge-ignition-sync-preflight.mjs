#!/usr/bin/env node
import process from 'node:process';
import { projectPostSyncRemainingIgnitionObligationsV1, projectIgnitionSettledRefreshEvidenceV1, projectIgnitionPreflightResultV1 }
  from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveCanonicalSyncAndRefreshPaths,
  runBattleBridgeSyncAndRefresh,
} from './battle-bridge-github-sync-and-refresh.mjs';

export const BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA = 'stephanos.battle-bridge-ignition-sync-preflight.v1';
export const BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT_MARKER = 'BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_RESULT=';

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_BLOCKER = /^[A-Z0-9_:-]{1,160}$/;
const SAFE_SYNC_FAILURE_REASONS = new Set(['SYNC_ALREADY_RUNNING', 'LOCK_ACQUISITION_FAILED',
  'NON_CANONICAL_REPOSITORY_PATH', 'NON_CANONICAL_WORKSPACE_PATH', 'REPOSITORY_WORKSPACE_OVERLAP']);
const CURRENT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeHead(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function safeBlocker(value, fallback) {
  const normalized = text(value);
  return SAFE_BLOCKER.test(normalized) ? normalized : fallback;
}

function sameCheckout(left, right, platform) {
  const normalizedLeft = resolve(text(left)).replace(/[\\/]+$/, '');
  const normalizedRight = resolve(text(right)).replace(/[\\/]+$/, '');
  if (platform === 'win32') return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  return normalizedLeft === normalizedRight;
}

function projectSyncAndRefreshResult(result = {}) {
  return Object.freeze({
    sourceHead: safeHead(result?.sourceHead),
    syncClassification: text(result?.syncClassification),
    syncBlockerReason: SAFE_SYNC_FAILURE_REASONS.has(result?.syncBlockerReason) ? result.syncBlockerReason : '',
    refreshCount: Array.isArray(result?.refreshes) ? result.refreshes.length : 0,
    pendingRefreshObserved: result?.pendingRefreshObserved === true,
    sourceForwardedBeforeRefresh: result?.sourceForwardedBeforeRefresh === true,
    refreshDebtCoalesced: result?.refreshDebtCoalesced === true,
    controlPlaneRepairObserved: result?.controlPlaneRepairObserved === true,
  });
}

// One residual-obligation rule governs every optional startup waiver. Scope
// flags and typed target proofs come from the canonical refresh projection;
// an earlier displayed blocker must never hide a second unpaid obligation.
function canWaiveSoleOptionalHold(result, projection, optionalHold) {
  try {
    if (optionalHold === 'auxiliary-control-plane') {
      return projectIgnitionSettledRefreshEvidenceV1(result.settledRefreshEvidence, projection.sourceHead) !== null;
    }
    if (!Array.isArray(result.refreshes)) return false;
    const refresh = result.refreshes.at(-1)?.result;
    const obligations = projectPostSyncRemainingIgnitionObligationsV1(refresh, projection.sourceHead);
    return obligations?.remaining.length === 1 && obligations.remaining[0] === optionalHold;
  } catch { return false; }
}

function canDegradeAuxiliaryControlPlane(result = {}, projection = {}) {
  return result?.ok !== true
    && result?.finalVerdict === 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED'
    && projection?.syncClassification === 'SYNC_NO_CHANGE'
    && SHA40.test(String(projection?.sourceHead || ''))
    && result.controlPlaneRepair?.ok === false
    && result.controlPlaneRepair?.classification === 'CONTROL_PLANE_REPAIR_BLOCKED'
    && result.controlPlaneRepair?.repairAttempted === true
    && result.controlPlaneRepair?.sourceHead === projection.sourceHead
    && canWaiveSoleOptionalHold(result, projection, 'auxiliary-control-plane');
}

const COMMANDER_CUSTODY_HOLD = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
const PLUGIN_HOST_ACTIVATION_HOLD = 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN';

function canDegradeHeldCommanderRefresh(result = {}, projection = {}) {
  if (result?.ok === true
      || result?.finalVerdict !== 'SYNC_AND_REFRESH_BLOCKED'
      || result?.blocker !== COMMANDER_CUSTODY_HOLD
      || projection?.syncClassification !== 'SYNC_NO_CHANGE'
      || !SHA40.test(String(projection?.sourceHead || ''))
      || !canWaiveSoleOptionalHold(result, projection, 'target:sovereign-commander')) return false;
  const refresh = Array.isArray(result?.refreshes) ? result.refreshes.at(-1)?.result : null;
  if (!refresh || refresh.classification !== 'BLOCKED_REFRESH_FAILED'
      || refresh.blocker !== COMMANDER_CUSTODY_HOLD
      || !Array.isArray(refresh.targetIds) || !Array.isArray(refresh.resultTargets)
      || !refresh.targetIds.includes('sovereign-commander')) return false;

  const commanderIndex = refresh.targetIds.indexOf('sovereign-commander');
  if (refresh.targetIds.length !== refresh.resultTargets.length) return false;

  const executedTargetIds = refresh.targetIds.slice(0, refresh.resultTargets.length);
  if (refresh.resultTargets.some((row, index) => row?.targetId !== executedTargetIds[index])) return false;
  const byId = new Map(refresh.resultTargets.map(row => [row?.targetId, row]));
  if (byId.size !== refresh.resultTargets.length) return false;

  for (const targetId of executedTargetIds) {
    const row = byId.get(targetId);
    if (!row) return false;
    if (targetId === 'sovereign-commander') {
      if (row.ok !== false || row.exactHeadProofOk !== false || row.blocker !== COMMANDER_CUSTODY_HOLD
          || safeHead(row.sourceHead) !== projection.sourceHead) return false;
    } else if (row.ok !== true || row.exactHeadProofOk !== true || row.blocker !== ''
        || safeHead(row.sourceHead) !== projection.sourceHead) return false;
  }
  return true;
}


function canDegradeUnattachedPluginHost(result = {}, projection = {}) {
  if (result?.ok === true
      || result?.finalVerdict !== 'SYNC_AND_REFRESH_BLOCKED'
      || result?.blocker !== PLUGIN_HOST_ACTIVATION_HOLD
      || projection?.syncClassification !== 'SYNC_NO_CHANGE'
      || !SHA40.test(String(projection?.sourceHead || ''))
      || !canWaiveSoleOptionalHold(result, projection, 'desktop-plugin-host')) return false;

  const refresh = Array.isArray(result?.refreshes) ? result.refreshes.at(-1)?.result : null;
  if (!refresh
      || refresh.classification !== 'BLOCKED_REFRESH_FAILED'
      || refresh.blocker !== PLUGIN_HOST_ACTIVATION_HOLD
      || refresh.pluginHostActivationRequired !== true
      || refresh.safeRefreshesCompleted !== true
      || !Array.isArray(refresh.targetIds)
      || !Array.isArray(refresh.resultTargets)
      || refresh.targetIds.length < 1
      || refresh.targetIds.length !== refresh.resultTargets.length) return false;

  for (let index = 0; index < refresh.targetIds.length; index += 1) {
    const targetId = refresh.targetIds[index];
    const row = refresh.resultTargets[index];
    if (!row || row.targetId !== targetId
        || row.ok !== true
        || row.exactHeadProofOk !== true
        || row.blocker !== ''
        || safeHead(row.sourceHead) !== projection.sourceHead) return false;
  }
  return true;
}

export async function runBattleBridgeIgnitionSyncPreflight({
  platform = process.platform,
  repoRoot = CURRENT_REPO_ROOT,
  canonicalRepoRoot = resolveCanonicalSyncAndRefreshPaths().repoRoot,
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

  if (!sameCheckout(repoRoot, canonicalRepoRoot, platform)) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
      ok: true,
      skipped: true,
      classification: 'IGNITION_SYNC_PREFLIGHT_SKIPPED_NON_CANONICAL_CHECKOUT',
      sourceHead: '',
      blocker: '',
      finalVerdict: 'IGNITION_SYNC_PREFLIGHT_SKIPPED',
    });
  }

  const result = projectIgnitionPreflightResultV1(await syncAndRefreshFn({ platform }))
    || Object.freeze({ ok: false, blocker: 'IGNITION_SYNC_AND_REFRESH_PROOF_INVALID' });
  const projection = projectSyncAndRefreshResult(result);

  if (result?.ok !== true) {
    if (canDegradeAuxiliaryControlPlane(result, projection)) {
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
        ok: true,
        skipped: false,
        classification: 'IGNITION_SYNC_PREFLIGHT_PASS_CONTROL_PLANE_DEGRADED',
        ...projection,
        controlPlaneDegraded: true,
        controlPlaneBlocker: safeBlocker(result?.blocker, 'CONTROL_PLANE_REPAIR_BLOCKED'),
        blocker: '',
        finalVerdict: 'IGNITION_SYNC_PREFLIGHT_PASS',
      });
    }

    if (canDegradeHeldCommanderRefresh(result, projection)) {
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
        ok: true,
        skipped: false,
        classification: 'IGNITION_SYNC_PREFLIGHT_PASS_COMMANDER_CUSTODY_DEGRADED',
        ...projection,
        commanderDegraded: true,
        commanderBlocker: COMMANDER_CUSTODY_HOLD,
        blocker: '',
        finalVerdict: 'IGNITION_SYNC_PREFLIGHT_PASS',
      });
    }

    if (canDegradeUnattachedPluginHost(result, projection)) {
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
        ok: true,
        skipped: false,
        classification: 'IGNITION_SYNC_PREFLIGHT_PASS_PLUGIN_HOST_DEGRADED',
        ...projection,
        pluginHostDegraded: true,
        pluginHostBlocker: PLUGIN_HOST_ACTIVATION_HOLD,
        blocker: '',
        finalVerdict: 'IGNITION_SYNC_PREFLIGHT_PASS',
      });
    }

    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_IGNITION_SYNC_PREFLIGHT_SCHEMA,
      ok: false,
      skipped: false,
      classification: 'IGNITION_SYNC_PREFLIGHT_BLOCKED',
      ...projection,
      degradationBlocker: result?.finalVerdict === 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED'
        ? 'IGNITION_SETTLED_REFRESH_WITNESS_UNPROVEN'
        : [COMMANDER_CUSTODY_HOLD, PLUGIN_HOST_ACTIVATION_HOLD].includes(result?.blocker)
          ? 'IGNITION_MANDATORY_REFRESH_OBLIGATIONS_UNPROVEN' : '',
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
