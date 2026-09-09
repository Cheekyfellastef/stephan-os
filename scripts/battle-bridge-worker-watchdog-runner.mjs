#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { reconcileBattleBridgeControlPlane } from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';
import { readMailboxReceiptIndex } from '../shared/agents/mailboxReceiptIndex.mjs';
import { ensureCriticalBacklogMission } from '../stephanos-server/services/criticalBacklogConveyorService.js';
import { resolveCanonicalWorkerWatchdogPaths } from './battle-bridge-worker-watchdog.mjs';
import { runChatGptSharedWorkspaceGitHubRelay } from './chatgpt-shared-workspace-github-relay.mjs';
import { observeRemoteCodexTaskVisibility } from './remote-codex-task-visibility-observer.mjs';

export const BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA = 'stephanos.battle-bridge-worker-watchdog-runner-with-critical-backlog.v1';
export const BATTLE_BRIDGE_CONTROL_PLANE_MAILBOX_STALE_AFTER_MS = 10 * 60 * 1000;
export const BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_TIMEOUT_MS = 115_000;
export const BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_PATH = fileURLToPath(
  new URL('./battle-bridge-worker-watchdog-child.mjs', import.meta.url),
);

const BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_OUTPUT_MAX_BYTES = 256 * 1024;
const SHA40 = /^[0-9a-f]{40}$/;
const REPAIRABLE_MAILBOX_BLOCKERS = new Set([
  'MAILBOX_RECEIPT_INDEX_NOT_FOUND',
  'MAILBOX_RECEIPT_INDEX_STALE',
]);
let workerWatchdogChildInFlight = null;

function workerAssessment(watchdog = {}) {
  return watchdog?.finalAssessment || watchdog?.decision?.assessment || null;
}

function isolatedWatchdogFailure(classification) {
  return Object.freeze({
    ok: false,
    classification,
    childIsolationApplied: true,
    arbitraryExecutableAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryArgumentsAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryEnvironmentAllowed: false,
  });
}

function validWatchdogChildResult(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.ok === 'boolean'
    && typeof value.classification === 'string'
    && /^[A-Z0-9_]{3,120}$/.test(value.classification),
  );
}

export function runIsolatedBattleBridgeWorkerWatchdog({
  spawnChild = spawn,
  scheduleTimeout = (handler, delayMs) => setTimeout(handler, delayMs),
  cancelTimeout = (handle) => clearTimeout(handle),
} = {}) {
  if (workerWatchdogChildInFlight) return workerWatchdogChildInFlight;

  const childPromise = new Promise((resolve) => {
    let child = null;
    try {
      child = spawnChild(
        process.execPath,
        [BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_PATH],
        {
          cwd: path.resolve(path.dirname(BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_PATH), '..'),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch {
      resolve(isolatedWatchdogFailure('WORKER_WATCHDOG_CHILD_LAUNCH_FAILED'));
      return;
    }

    if (!child || typeof child.once !== 'function' || !child.stdout || typeof child.stdout.on !== 'function') {
      try { child?.kill?.(); } catch {}
      resolve(isolatedWatchdogFailure('WORKER_WATCHDOG_CHILD_LAUNCH_FAILED'));
      return;
    }

    let settled = false;
    let stdout = '';
    let timeoutHandle = null;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== null) cancelTimeout(timeoutHandle);
      resolve(result);
    };

    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      stdout += String(chunk ?? '');
      if (Buffer.byteLength(stdout, 'utf8') > BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_OUTPUT_MAX_BYTES) {
        settle(isolatedWatchdogFailure('WORKER_WATCHDOG_CHILD_RESULT_INVALID'));
        try { child.kill?.('SIGTERM'); } catch {}
      }
    });
    child.stderr?.resume?.();

    child.once('error', () => {
      settle(isolatedWatchdogFailure('WORKER_WATCHDOG_CHILD_LAUNCH_FAILED'));
    });
    child.once('close', () => {
      if (settled) return;
      let result = null;
      try {
        result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      } catch {}
      if (!validWatchdogChildResult(result)) {
        settle(isolatedWatchdogFailure('WORKER_WATCHDOG_CHILD_RESULT_INVALID'));
        return;
      }
      settle(Object.freeze(result));
    });

    timeoutHandle = scheduleTimeout(() => {
      settle(isolatedWatchdogFailure('WORKER_WATCHDOG_CHILD_TIMEOUT'));
      try { child.kill?.('SIGTERM'); } catch {}
    }, BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_TIMEOUT_MS);
  });

  workerWatchdogChildInFlight = childPromise.finally(() => {
    workerWatchdogChildInFlight = null;
  });
  return workerWatchdogChildInFlight;
}

function startAuxiliaryLane(run, classification) {
  try {
    return Promise.resolve(run()).catch((error) => ({
      ok: false,
      classification,
      reason: error?.message || String(error),
    }));
  } catch (error) {
    return Promise.resolve({
      ok: false,
      classification,
      reason: error?.message || String(error),
    });
  }
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
  workerWatchdog = runIsolatedBattleBridgeWorkerWatchdog,
  controlPlaneRecovery = runBattleBridgeControlPlaneBootstrapRecovery,
} = {}) {
  // Worker recovery remains the first operation started by this installed runner.
  // The default watchdog executes in one transient fixed child process so its
  // synchronous Windows restart probe cannot block this runner's event loop.
  // Construction truth therefore starts immediately and can make asynchronous
  // progress while the canonical watchdog remains within its bounded child run.
  const watchdogPromise = workerWatchdog();
  const criticalBacklogConveyorPromise = startAuxiliaryLane(
    backlogConveyor,
    'CRITICAL_BACKLOG_CONVEYOR_FAILED',
  );
  const watchdog = await watchdogPromise;
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

  const codexVisibilityPromise = startAuxiliaryLane(
    visibilityObserver,
    'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED',
  );
  const chatGptSharedWorkspaceRelayPromise = startAuxiliaryLane(
    participantRelay,
    'CHATGPT_SHARED_WORKSPACE_RELAY_FAILED',
  );

  const [
    codexVisibility,
    chatGptSharedWorkspaceRelay,
    criticalBacklogConveyor,
  ] = await Promise.all([
    codexVisibilityPromise,
    chatGptSharedWorkspaceRelayPromise,
    criticalBacklogConveyorPromise,
  ]);

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
