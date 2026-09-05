#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { reconcileBattleBridgeControlPlane } from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';
import { readMailboxReceiptIndex } from '../shared/agents/mailboxReceiptIndex.mjs';
import { ensureCriticalBacklogMission } from '../stephanos-server/services/criticalBacklogConveyorService.js';
import {
  resolveCanonicalWorkerWatchdogPaths,
  runBattleBridgeWorkerWatchdog,
} from './battle-bridge-worker-watchdog.mjs';
import { runChatGptSharedWorkspaceGitHubRelay } from './chatgpt-shared-workspace-github-relay.mjs';
import { observeRemoteCodexTaskVisibility } from './remote-codex-task-visibility-observer.mjs';

export const BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA = 'stephanos.battle-bridge-worker-watchdog-runner-with-critical-backlog.v1';
export const BATTLE_BRIDGE_CONTROL_PLANE_MAILBOX_STALE_AFTER_MS = 10 * 60 * 1000;

const SHA40 = /^[0-9a-f]{40}$/;
const REPAIRABLE_MAILBOX_BLOCKERS = new Set([
  'MAILBOX_RECEIPT_INDEX_NOT_FOUND',
  'MAILBOX_RECEIPT_INDEX_STALE',
]);

function workerAssessment(watchdog = {}) {
  return watchdog?.finalAssessment || watchdog?.decision?.assessment || null;
}

export async function runBattleBridgeControlPlaneBootstrapRecovery({
  watchdog = null,
  paths = resolveCanonicalWorkerWatchdogPaths(),
  mailboxIndexReader = readMailboxReceiptIndex,
  controlPlaneReconciler = reconcileBattleBridgeControlPlane,
  nowMs = Date.now(),
  platform = process.platform,
} = {}) {
  const assessment = workerAssessment(watchdog || {});
  if (watchdog?.ok !== true || assessment?.healthy !== true) {
    return Object.freeze({
      ok: true,
      classification: 'CONTROL_PLANE_BOOTSTRAP_SKIPPED_WORKER_UNHEALTHY',
      repairAttempted: false,
      sourceHead: '',
    });
  }

  const sourceHead = String(assessment.sourceHead || '').trim().toLowerCase();
  if (!SHA40.test(sourceHead)) {
    return Object.freeze({
      ok: false,
      classification: 'CONTROL_PLANE_BOOTSTRAP_SOURCE_HEAD_UNPROVEN',
      repairAttempted: false,
      sourceHead: '',
    });
  }

  const mailboxIndex = await mailboxIndexReader({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    nowMs,
    staleAfterMs: BATTLE_BRIDGE_CONTROL_PLANE_MAILBOX_STALE_AFTER_MS,
  });
  if (mailboxIndex?.ok === true) {
    return Object.freeze({
      ok: true,
      classification: 'CONTROL_PLANE_MAILBOX_HEALTHY',
      repairAttempted: false,
      sourceHead,
      mailboxIndex,
    });
  }

  const mailboxBlocker = String(mailboxIndex?.blocker || 'MAILBOX_RECEIPT_INDEX_BLOCKED');
  if (!REPAIRABLE_MAILBOX_BLOCKERS.has(mailboxBlocker)) {
    return Object.freeze({
      ok: false,
      classification: 'CONTROL_PLANE_BOOTSTRAP_BLOCKED',
      repairAttempted: false,
      sourceHead,
      blocker: mailboxBlocker,
      mailboxIndex,
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
      classification: 'CONTROL_PLANE_BOOTSTRAP_BLOCKED',
      repairAttempted: true,
      sourceHead,
      blocker: String(repair?.blocker || 'CONTROL_PLANE_REPAIR_BLOCKED'),
      mailboxIndex,
      repair,
    });
  }

  return Object.freeze({
    ok: true,
    classification: 'CONTROL_PLANE_BOOTSTRAP_REPAIRED',
    repairAttempted: true,
    sourceHead,
    mailboxIndex,
    repair,
    arbitraryTaskNameAllowed: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
  });
}

export async function runBattleBridgeWorkerWatchdogRunner({
  visibilityObserver = observeRemoteCodexTaskVisibility,
  participantRelay = runChatGptSharedWorkspaceGitHubRelay,
  backlogConveyor = ensureCriticalBacklogMission,
  workerWatchdog = runBattleBridgeWorkerWatchdog,
  controlPlaneRecovery = runBattleBridgeControlPlaneBootstrapRecovery,
} = {}) {
  // Worker recovery is the time-critical purpose of this installed runner.
  // Publish watchdog recovery truth before auxiliary reconciliation so a slow
  // visibility/relay/backlog lane cannot consume the bounded acceptance window.
  const watchdog = await workerWatchdog();
  let controlPlaneBootstrapRecovery = null;
  try {
    controlPlaneBootstrapRecovery = await controlPlaneRecovery({ watchdog });
  } catch (error) {
    controlPlaneBootstrapRecovery = {
      ok: false,
      classification: 'CONTROL_PLANE_BOOTSTRAP_REPAIR_FAILED',
      repairAttempted: false,
      reason: error?.message || String(error),
    };
  }

  let codexVisibility = null;
  try {
    codexVisibility = await visibilityObserver();
  } catch (error) {
    codexVisibility = {
      ok: false,
      classification: 'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED',
      reason: error?.message || String(error),
    };
  }

  let chatGptSharedWorkspaceRelay = null;
  try {
    chatGptSharedWorkspaceRelay = await participantRelay();
  } catch (error) {
    chatGptSharedWorkspaceRelay = {
      ok: false,
      classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_FAILED',
      reason: error?.message || String(error),
    };
  }

  let criticalBacklogConveyor = null;
  try {
    criticalBacklogConveyor = await backlogConveyor();
  } catch (error) {
    criticalBacklogConveyor = {
      ok: false,
      classification: 'CRITICAL_BACKLOG_CONVEYOR_FAILED',
      reason: error?.message || String(error),
    };
  }

  const visibilityOk = codexVisibility?.ok === true;
  const participantRelayOk = chatGptSharedWorkspaceRelay?.ok === true;
  const criticalBacklogConveyorOk = criticalBacklogConveyor?.ok === true;
  const workerWatchdogOk = watchdog?.ok === true;
  const controlPlaneRecoveryOk = controlPlaneBootstrapRecovery?.ok === true;
  return Object.freeze({
    ...watchdog,
    ok: visibilityOk && participantRelayOk && criticalBacklogConveyorOk && workerWatchdogOk && controlPlaneRecoveryOk,
    schemaVersion: BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA,
    codexVisibility,
    codexVisibilityObserved: true,
    visibilityOk,
    chatGptSharedWorkspaceRelay,
    chatGptSharedWorkspaceRelayObserved: true,
    participantRelayOk,
    criticalBacklogConveyor,
    criticalBacklogConveyorObserved: true,
    criticalBacklogConveyorOk,
    workerWatchdogOk,
    controlPlaneBootstrapRecovery,
    controlPlaneBootstrapRecoveryObserved: true,
    controlPlaneRecoveryOk,
  });
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await runBattleBridgeWorkerWatchdogRunner();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
