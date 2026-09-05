#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { reconcileBattleBridgeControlPlane } from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';

export const BATTLE_BRIDGE_SYNC_AND_REFRESH_SCHEMA = 'stephanos.battle-bridge-sync-and-refresh.v1';
export const BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT_MARKER = 'BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT=';
export const MAX_SYNC_REFRESH_CYCLES = 3;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function safeHead(value) {
  const normalized = text(value).toLowerCase();
  return SHA_PATTERN.test(normalized) ? normalized : '';
}

export function resolveCanonicalSyncAndRefreshPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const repoRoot = path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repoRoot,
    workspaceRoot,
    syncExecutor: path.resolve(repoRoot, 'scripts', 'battle-bridge-github-sync-executor.mjs'),
    refreshCoordinator: path.resolve(repoRoot, 'scripts', 'battle-bridge-post-sync-refresh.mjs'),
    syncStatusPath: path.resolve(workspaceRoot, 'status', 'battle-bridge-github-sync-current.json'),
  });
}

function fixedNodeRun(scriptPath, args, {
  cwd,
  spawnSyncFn = spawnSync,
  timeout = 600_000,
  env = process.env,
} = {}) {
  const result = spawnSyncFn(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? '').slice(0, 1000),
    errorCode: result?.error?.code || '',
  });
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseMarkedJson(stdout, marker) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith(marker)) continue;
    return parseJsonObject(lines[index].slice(marker.length));
  }
  return null;
}

export function createFixedSyncAndRefreshAdapter({ spawnSyncFn = spawnSync } = {}) {
  return Object.freeze({
    runSync(paths) {
      const execution = fixedNodeRun(paths.syncExecutor, [], { cwd: paths.repoRoot, spawnSyncFn, timeout: 300_000 });
      const result = parseJsonObject(execution.stdout);
      if (!result) return { ok: false, blocker: 'SYNC_EXECUTOR_RESPONSE_INVALID', execution };
      return { ok: true, result, execution };
    },
    runRefresh({ beforeHead, afterHead, paths }) {
      if (!safeHead(beforeHead) || !safeHead(afterHead) || beforeHead === afterHead) {
        return { ok: false, blocker: 'POST_SYNC_HEADS_INVALID' };
      }
      const execution = fixedNodeRun(paths.refreshCoordinator, ['--before', beforeHead, '--after', afterHead], {
        cwd: paths.repoRoot,
        spawnSyncFn,
        timeout: 900_000,
        env: { ...process.env, GIT_REDIRECT_STDERR: 'off' },
      });
      const result = parseMarkedJson(execution.stdout, 'POST_SYNC_REFRESH_RESULT=');
      if (!result) return { ok: false, blocker: 'POST_SYNC_REFRESH_RESPONSE_INVALID', execution };
      return { ok: true, result, execution };
    },
  });
}

export async function readPendingPostSyncRefresh(paths) {
  try {
    const status = JSON.parse(await readFile(paths.syncStatusPath, 'utf8'));
    if (status?.classification !== 'BLOCKED_POST_SYNC_REFRESH_REQUIRED') return null;
    const beforeHead = safeHead(status.localHeadBefore);
    const afterHead = safeHead(status.localHeadAfter || status.remoteHeadObserved);
    if (!beforeHead || !afterHead || beforeHead === afterHead) {
      return Object.freeze({ ok: false, blocker: 'PENDING_POST_SYNC_HEADS_INVALID' });
    }
    return Object.freeze({ ok: true, beforeHead, afterHead, proofRefs: Array.isArray(status.proofRefs) ? status.proofRefs : [] });
  } catch {
    return null;
  }
}

function refreshHeadsFromSyncResult(result = {}) {
  const beforeHead = safeHead(result?.facts?.localHeadBefore || result?.facts?.localHead);
  const afterHead = safeHead(result?.facts?.localHeadAfter || result?.facts?.remoteHead);
  if (!beforeHead || !afterHead || beforeHead === afterHead) return null;
  const needsRefresh = result?.sourceUpdated === true
    || result?.evaluation?.classification === 'BLOCKED_POST_SYNC_REFRESH_REQUIRED';
  return needsRefresh ? Object.freeze({ beforeHead, afterHead }) : null;
}

function syncIsConverged(result = {}) {
  return result?.ok === true && result?.evaluation?.classification === 'SYNC_NO_CHANGE';
}

function syncHead(result = {}) {
  return safeHead(
    result?.facts?.localHeadAfter
    || result?.facts?.remoteHead
    || result?.facts?.localHead,
  );
}

function reconcileConvergedControlPlane({ sourceHead, paths, controlPlaneReconciler, platform }) {
  if (platform !== 'win32') {
    return Object.freeze({
      ok: true,
      classification: 'CONTROL_PLANE_REPAIR_SKIPPED_NON_WINDOWS',
      repairAttempted: false,
      sourceHead,
    });
  }
  const repair = controlPlaneReconciler({
    repoRoot: paths.repoRoot,
    expectedHead: sourceHead,
    platform,
  });
  if (repair?.ok !== true) {
    return Object.freeze({
      ok: false,
      classification: 'CONTROL_PLANE_REPAIR_BLOCKED',
      repairAttempted: true,
      sourceHead,
      blocker: String(repair?.blocker || 'CONTROL_PLANE_REPAIR_BLOCKED'),
      repair: repair || null,
    });
  }
  return Object.freeze({
    ok: true,
    classification: 'CONTROL_PLANE_RECONCILED',
    repairAttempted: true,
    sourceHead,
    repair,
  });
}

export async function runBattleBridgeSyncAndRefresh({
  env = process.env,
  paths = resolveCanonicalSyncAndRefreshPaths({ env }),
  expectedPaths = resolveCanonicalSyncAndRefreshPaths({ env }),
  adapter = createFixedSyncAndRefreshAdapter(),
  pendingReader = readPendingPostSyncRefresh,
  controlPlaneReconciler = reconcileBattleBridgeControlPlane,
  platform = process.platform,
  maxCycles = MAX_SYNC_REFRESH_CYCLES,
} = {}) {
  if (path.resolve(paths.repoRoot) !== path.resolve(expectedPaths.repoRoot)
    || path.resolve(paths.workspaceRoot) !== path.resolve(expectedPaths.workspaceRoot)) {
    return Object.freeze({ ok: false, blocker: 'SYNC_AND_REFRESH_NON_CANONICAL_PATH', finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
  }

  const refreshes = [];
  const pending = await pendingReader(paths);
  const pendingInvalid = pending?.ok === false ? pending : null;
  let pendingDebt = pending?.ok === true ? pending : null;
  let sourceForwardedBeforeRefresh = false;
  let refreshDebtCoalesced = false;

  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    const sync = adapter.runSync(paths);
    if (!sync.ok) {
      return Object.freeze({ ok: false, blocker: sync.blocker, refreshes: Object.freeze(refreshes), finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
    }

    const converged = syncIsConverged(sync.result);
    const currentHeads = refreshHeadsFromSyncResult(sync.result);
    const currentSourceHead = syncHead(sync.result);

    if (!converged && !currentHeads) {
      return Object.freeze({
        ok: false,
        blocker: sync.result?.evaluation?.classification || 'SYNC_NOT_CONVERGED',
        sourceHead: currentSourceHead,
        syncClassification: sync.result?.evaluation?.classification || '',
        refreshes: Object.freeze(refreshes),
        sourceForwardedBeforeRefresh,
        refreshDebtCoalesced,
        finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
      });
    }

    if (pendingInvalid) {
      sourceForwardedBeforeRefresh = sync.result?.sourceUpdated === true;
      return Object.freeze({
        ok: false,
        blocker: pendingInvalid.blocker,
        sourceHead: currentSourceHead,
        syncClassification: sync.result?.evaluation?.classification || '',
        refreshes: Object.freeze(refreshes),
        pendingRefreshObserved: true,
        sourceForwardedBeforeRefresh,
        refreshDebtCoalesced: false,
        finalVerdict: 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED',
      });
    }

    let refreshHeads = null;
    let pendingAfterHead = '';

    if (pendingDebt) {
      const afterHead = currentHeads?.afterHead || currentSourceHead;
      if (!afterHead || afterHead === pendingDebt.beforeHead) {
        return Object.freeze({
          ok: false,
          blocker: 'PENDING_POST_SYNC_HEADS_INVALID',
          sourceHead: currentSourceHead,
          syncClassification: sync.result?.evaluation?.classification || '',
          refreshes: Object.freeze(refreshes),
          pendingRefreshObserved: true,
          sourceForwardedBeforeRefresh: sync.result?.sourceUpdated === true,
          refreshDebtCoalesced,
          finalVerdict: 'SYNC_AND_REFRESH_REFRESH_DEBT_BLOCKED',
        });
      }

      pendingAfterHead = pendingDebt.afterHead;
      refreshDebtCoalesced ||= pendingDebt.afterHead !== afterHead;
      sourceForwardedBeforeRefresh ||= sync.result?.sourceUpdated === true;
      refreshHeads = Object.freeze({ beforeHead: pendingDebt.beforeHead, afterHead });
    } else if (!converged) {
      refreshHeads = currentHeads;
    }

    if (refreshHeads) {
      const refresh = adapter.runRefresh({ ...refreshHeads, paths });
      refreshes.push(Object.freeze({
        ...refreshHeads,
        pendingAfterHead,
        debtCoalesced: Boolean(pendingAfterHead && pendingAfterHead !== refreshHeads.afterHead),
        result: refresh.result || null,
      }));
      if (!refresh.ok || refresh.result?.ok !== true) {
        return Object.freeze({
          ok: false,
          blocker: refresh.result?.blocker || refresh.blocker || 'POST_SYNC_RUNTIME_REFRESH_BLOCKED',
          sourceHead: currentSourceHead,
          syncClassification: sync.result?.evaluation?.classification || '',
          refreshes: Object.freeze(refreshes),
          pendingRefreshObserved: Boolean(pendingDebt),
          sourceForwardedBeforeRefresh,
          refreshDebtCoalesced,
          finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
        });
      }
      pendingDebt = null;
      continue;
    }

    if (converged) {
      const sourceHead = currentSourceHead;
      if (!sourceHead) {
        return Object.freeze({ ok: false, blocker: 'SYNC_CONVERGED_HEAD_UNPROVEN', refreshes: Object.freeze(refreshes), finalVerdict: 'SYNC_AND_REFRESH_BLOCKED' });
      }
      const controlPlaneRepair = reconcileConvergedControlPlane({
        sourceHead,
        paths,
        controlPlaneReconciler,
        platform,
      });
      if (!controlPlaneRepair.ok) {
        return Object.freeze({
          ok: false,
          blocker: controlPlaneRepair.blocker,
          sourceHead,
          syncClassification: sync.result.evaluation.classification,
          refreshes: Object.freeze(refreshes),
          sourceForwardedBeforeRefresh,
          refreshDebtCoalesced,
          controlPlaneRepair,
          finalVerdict: 'SYNC_AND_REFRESH_CONTROL_PLANE_REPAIR_BLOCKED',
        });
      }
      return Object.freeze({
        schemaVersion: BATTLE_BRIDGE_SYNC_AND_REFRESH_SCHEMA,
        ok: true,
        sourceHead,
        syncClassification: sync.result.evaluation.classification,
        refreshes: Object.freeze(refreshes),
        freshCoordinatorProcessUsed: refreshes.length > 0,
        pendingRefreshObserved: pending?.ok === true,
        sourceForwardedBeforeRefresh,
        refreshDebtCoalesced,
        controlPlaneRepair,
        controlPlaneRepairObserved: true,
        arbitraryShellAllowed: false,
        destructiveGitAllowed: false,
        liveOpenClawUpdateAllowed: false,
        finalVerdict: 'SYNC_AND_REFRESH_PASS',
      });
    }
  }

  return Object.freeze({
    ok: false,
    blocker: 'SYNC_AND_REFRESH_CYCLE_LIMIT_EXCEEDED',
    refreshes: Object.freeze(refreshes),
    sourceForwardedBeforeRefresh,
    refreshDebtCoalesced,
    finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBattleBridgeSyncAndRefresh();
  process.stdout.write(`${BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
