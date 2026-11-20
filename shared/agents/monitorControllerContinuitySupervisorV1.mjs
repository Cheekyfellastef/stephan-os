import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  BATTLE_BRIDGE_GITHUB_SYNC_HEALTHY,
  BATTLE_BRIDGE_GITHUB_SYNC_REPAIRED,
  BATTLE_BRIDGE_GITHUB_SYNC_TASK,
  reconcileBattleBridgeGitHubSyncTask,
} from './battleBridgeGitHubSyncSelfRepairV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';

export const MONITOR_CONTROLLER_CONTINUITY_SUPERVISOR_SCHEMA =
  'stephanos.monitor-controller-continuity-supervisor.v1';
export const MONITOR_CONTROLLER_CONTINUITY_CONTROLLER_ID = 'builder-continuity';

const SHA40 = /^[0-9a-f]{40}$/i;
const MAX_OUTPUT_BYTES = 16 * 1024;

function text(value) {
  return String(value ?? '').trim();
}

function blocked(blocker, details = {}) {
  return Object.freeze({
    schemaVersion: MONITOR_CONTROLLER_CONTINUITY_SUPERVISOR_SCHEMA,
    ok: false,
    controllerId: MONITOR_CONTROLLER_CONTINUITY_CONTROLLER_ID,
    desiredState: 'RUNNING',
    continuityState: 'BLOCKED',
    blocker,
    sourceHead: '',
    heartbeatTaskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK,
    builderHeartbeatHealthy: false,
    repairAttempted: false,
    mutationPerformed: false,
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    mergeAuthority: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    pcRestartAllowed: false,
    finalVerdict: 'MONITOR_CONTROLLER_CONTINUITY_BLOCKED',
    ...details,
  });
}

function readCanonicalHead(repoRoot, spawnSyncFn) {
  const result = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, [
    '-C', repoRoot, 'rev-parse', 'HEAD',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const sourceHead = text(result?.stdout).toLowerCase();
  if (result?.error || result?.status !== 0 || !SHA40.test(sourceHead)) return '';
  return sourceHead;
}

export function runMonitorControllerContinuitySupervisorV1({
  repoRoot = '',
  platform = process.platform,
  now = new Date(),
  spawnSyncFn = spawnSync,
  lstatFn,
  reconcileSyncTask = reconcileBattleBridgeGitHubSyncTask,
} = {}) {
  if (platform !== 'win32') return blocked('WINDOWS_BATTLE_BRIDGE_REQUIRED');
  const canonicalRoot = resolve(repoRoot);
  let sourceHead = '';
  try {
    sourceHead = readCanonicalHead(canonicalRoot, spawnSyncFn);
  } catch {
    return blocked('CONTINUITY_CANONICAL_HEAD_PROBE_FAILED');
  }
  if (!sourceHead) return blocked('CONTINUITY_CANONICAL_HEAD_UNPROVEN');

  let reconciliation;
  try {
    reconciliation = reconcileSyncTask({
      repoRoot: canonicalRoot,
      expectedHead: sourceHead,
      platform,
      now,
      spawnSyncFn,
      lstatFn,
    });
  } catch {
    return blocked('CONTINUITY_GITHUB_SYNC_RECONCILIATION_FAILED', { sourceHead });
  }
  if (reconciliation?.ok !== true) {
    return blocked(text(reconciliation?.blocker) || 'CONTINUITY_GITHUB_SYNC_RECONCILIATION_BLOCKED', {
      sourceHead,
      repairAttempted: reconciliation?.repairAttempted === true,
      mutationPerformed: reconciliation?.mutationPerformed === true,
      reconciliation,
    });
  }

  const healthy = reconciliation.finalVerdict === BATTLE_BRIDGE_GITHUB_SYNC_HEALTHY;
  const repaired = reconciliation.finalVerdict === BATTLE_BRIDGE_GITHUB_SYNC_REPAIRED;
  if (!healthy && !repaired) {
    return blocked('CONTINUITY_GITHUB_SYNC_VERDICT_UNRECOGNISED', {
      sourceHead,
      repairAttempted: reconciliation?.repairAttempted === true,
      mutationPerformed: reconciliation?.mutationPerformed === true,
      reconciliation,
    });
  }

  return Object.freeze({
    schemaVersion: MONITOR_CONTROLLER_CONTINUITY_SUPERVISOR_SCHEMA,
    ok: true,
    controllerId: MONITOR_CONTROLLER_CONTINUITY_CONTROLLER_ID,
    desiredState: 'RUNNING',
    continuityState: repaired ? 'RECOVERED' : 'RUNNING',
    blocker: '',
    sourceHead,
    heartbeatTaskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK,
    builderHeartbeatHealthy: true,
    repairAttempted: reconciliation.repairAttempted === true,
    mutationPerformed: reconciliation.mutationPerformed === true,
    mutationScope: reconciliation.mutationScope || '',
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    mergeAuthority: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    pcRestartAllowed: false,
    reconciliation,
    finalVerdict: repaired
      ? 'MONITOR_CONTROLLER_CONTINUITY_RECOVERED'
      : 'MONITOR_CONTROLLER_CONTINUITY_RUNNING',
  });
}
