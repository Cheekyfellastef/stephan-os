#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { reconcileBattleBridgeControlPlane } from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';
import {
  projectRepairAgentBootstrapCanonicalEvidenceV1,
} from '../shared/agents/repairAgentBootstrapHealthProjectionV1.mjs';
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
const CONTROL_PLANE_HEALTH_EVIDENCE_MAX_BYTES = 128 * 1024;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
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

async function readBoundedJsonFile(pathname) {
  let raw = '';
  try {
    raw = await readFile(pathname, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ ok: true, missing: true, value: undefined });
    return Object.freeze({ ok: false, missing: false, blocker: 'CONTROL_PLANE_HEALTH_EVIDENCE_READ_FAILED' });
  }

  if (Buffer.byteLength(raw, 'utf8') <= 0 || Buffer.byteLength(raw, 'utf8') > CONTROL_PLANE_HEALTH_EVIDENCE_MAX_BYTES) {
    return Object.freeze({ ok: false, missing: false, blocker: 'CONTROL_PLANE_HEALTH_EVIDENCE_SIZE_INVALID' });
  }

  try {
    const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return Object.freeze({ ok: false, missing: false, blocker: 'CONTROL_PLANE_HEALTH_EVIDENCE_SHAPE_INVALID' });
    }
    return Object.freeze({ ok: true, missing: false, value });
  } catch {
    return Object.freeze({ ok: false, missing: false, blocker: 'CONTROL_PLANE_HEALTH_EVIDENCE_JSON_INVALID' });
  }
}

function malformedRecoveryMeshEvidence(blocker) {
  return Object.freeze({
    classification: String(blocker || 'RECOVERY_MESH_EVIDENCE_INVALID'),
    blocker: String(blocker || 'RECOVERY_MESH_EVIDENCE_INVALID'),
    timestampUtc: '',
  });
}

function malformedRecoveryLifeboatEvidence(blocker) {
  return Object.freeze({
    schemaVersion: 'stephanos.invalid-recovery-lifeboat-heartbeat.v1',
    completedAtUtc: '',
    healthy: false,
    payloadVerified: false,
    arbitraryShellAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
    blocker: String(blocker || 'RECOVERY_LIFEBOAT_EVIDENCE_INVALID'),
  });
}

export async function readCanonicalRecoveryMeshStatus({
  workspaceRoot,
} = {}) {
  const statusPath = path.resolve(String(workspaceRoot || ''), 'status', 'battle-bridge-recovery-mesh-current.json');
  const result = await readBoundedJsonFile(statusPath);
  if (result.ok !== true) return malformedRecoveryMeshEvidence(result.blocker);
  if (result.missing) return undefined;
  return result.value;
}

export async function readCanonicalRecoveryLifeboatHeartbeat({
  env = process.env,
} = {}) {
  const localAppData = String(env?.LOCALAPPDATA || '').trim();
  if (!localAppData) return malformedRecoveryLifeboatEvidence('RECOVERY_LIFEBOAT_LOCALAPPDATA_MISSING');

  const lifeboatRoot = path.resolve(localAppData, 'Stephanos', 'BattleBridgeRecoveryLifeboat');
  const stateResult = await readBoundedJsonFile(path.resolve(lifeboatRoot, 'state', 'active-bank.json'));
  if (stateResult.ok !== true) return malformedRecoveryLifeboatEvidence(stateResult.blocker);
  if (stateResult.missing) return undefined;

  const activeState = stateResult.value;
  const activeBank = String(activeState?.activeBank || '');
  const manifestSha256 = String(activeState?.manifestSha256 || '').trim().toLowerCase();
  if (
    activeState?.schemaVersion !== 'stephanos.battle-bridge-lifeboat-active-bank.v1'
    || !['A', 'B'].includes(activeBank)
    || !SHA64.test(manifestSha256)
    || activeState?.selfTestVerdict !== 'PASS'
  ) {
    return malformedRecoveryLifeboatEvidence('RECOVERY_LIFEBOAT_ACTIVE_STATE_INVALID');
  }

  const heartbeatResult = await readBoundedJsonFile(
    path.resolve(lifeboatRoot, 'status', `bank-${activeBank}-heartbeat.json`),
  );
  if (heartbeatResult.ok !== true) return malformedRecoveryLifeboatEvidence(heartbeatResult.blocker);
  if (heartbeatResult.missing) return undefined;

  const heartbeat = heartbeatResult.value;
  if (
    String(heartbeat?.bankId || '') !== activeBank
    || String(heartbeat?.manifestSha256 || '').trim().toLowerCase() !== manifestSha256
  ) {
    return malformedRecoveryLifeboatEvidence('RECOVERY_LIFEBOAT_HEARTBEAT_IDENTITY_MISMATCH');
  }
  return heartbeat;
}

export async function runBattleBridgeControlPlaneBootstrapRecovery({
  watchdog = null,
  paths = resolveCanonicalWorkerWatchdogPaths(),
  mailboxIndexReader = readMailboxReceiptIndex,
  recoveryMeshStatusReader,
  recoveryLifeboatHeartbeatReader,
  healthProjection = projectRepairAgentBootstrapCanonicalEvidenceV1,
  controlPlaneReconciler = reconcileBattleBridgeControlPlane,
  nowMs = Date.now(),
  platform = process.platform,
  environment = process.env,
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
  const mailboxBlocker = String(mailboxIndex?.blocker || 'MAILBOX_RECEIPT_INDEX_BLOCKED');
  if (mailboxIndex?.ok !== true && !REPAIRABLE_MAILBOX_BLOCKERS.has(mailboxBlocker)) {
    return Object.freeze({
      ok: false,
      classification: 'CONTROL_PLANE_BOOTSTRAP_BLOCKED',
      repairAttempted: false,
      sourceHead,
      blocker: mailboxBlocker,
      mailboxIndex,
    });
  }

  const multiSurfaceObservationEnabled = (
    platform === 'win32'
    && process.platform === 'win32'
    && mailboxIndexReader === readMailboxReceiptIndex
  )
    || typeof recoveryMeshStatusReader === 'function'
    || typeof recoveryLifeboatHeartbeatReader === 'function';

  if (!multiSurfaceObservationEnabled && mailboxIndex?.ok === true) {
    return Object.freeze({
      ok: true,
      classification: 'CONTROL_PLANE_MAILBOX_HEALTHY',
      repairAttempted: false,
      sourceHead,
      mailboxIndex,
    });
  }

  let healthAssessment = null;
  let recoveryMeshStatus;
  let recoveryLifeboatHeartbeat;
  if (multiSurfaceObservationEnabled) {
    const observedAtUtc = new Date(nowMs).toISOString();
    const meshReader = recoveryMeshStatusReader || readCanonicalRecoveryMeshStatus;
    const lifeboatReader = recoveryLifeboatHeartbeatReader || readCanonicalRecoveryLifeboatHeartbeat;
    [recoveryMeshStatus, recoveryLifeboatHeartbeat] = await Promise.all([
      meshReader({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, nowMs, platform, env: environment }),
      lifeboatReader({ workspaceRoot: paths.workspaceRoot, repoRoot: paths.repoRoot, nowMs, platform, env: environment }),
    ]);
    const projectedMailboxIndex = mailboxIndex && typeof mailboxIndex === 'object' && !Array.isArray(mailboxIndex)
      && !mailboxIndex.timestampUtc && !mailboxIndex.generatedAtUtc && !mailboxIndex.observedAtUtc
      ? { ...mailboxIndex, observedAtUtc }
      : mailboxIndex;
    healthAssessment = healthProjection({
      expectedHead: sourceHead,
      observedAtUtc,
      mailboxIndex: projectedMailboxIndex,
      recoveryMeshStatus,
      recoveryLifeboatHeartbeat,
    });

    if (healthAssessment?.ok !== true) {
      return Object.freeze({
        ok: false,
        classification: 'CONTROL_PLANE_BOOTSTRAP_BLOCKED',
        repairAttempted: false,
        sourceHead,
        blocker: String(healthAssessment?.blocker || 'CONTROL_PLANE_BOOTSTRAP_HEALTH_EVIDENCE_BLOCKED'),
        mailboxIndex,
        recoveryMeshStatus,
        recoveryLifeboatHeartbeat,
        healthAssessment,
      });
    }

    if (healthAssessment.allRequiredHealthy === true) {
      return Object.freeze({
        ok: true,
        classification: 'CONTROL_PLANE_MAILBOX_HEALTHY',
        repairAttempted: false,
        sourceHead,
        mailboxIndex,
        recoveryMeshStatus,
        recoveryLifeboatHeartbeat,
        healthAssessment,
      });
    }

    const unsafeCandidate = (healthAssessment.repairCandidates || []).find(
      (candidate) => candidate?.repairRoute !== 'CONTROL_PLANE_SELF_REPAIR',
    );
    if (unsafeCandidate) {
      return Object.freeze({
        ok: false,
        classification: 'CONTROL_PLANE_BOOTSTRAP_BLOCKED',
        repairAttempted: false,
        sourceHead,
        blocker: 'CONTROL_PLANE_BOOTSTRAP_REPAIR_ROUTE_INVALID',
        mailboxIndex,
        recoveryMeshStatus,
        recoveryLifeboatHeartbeat,
        healthAssessment,
      });
    }
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
      recoveryMeshStatus,
      recoveryLifeboatHeartbeat,
      healthAssessment,
      repair,
    });
  }

  return Object.freeze({
    ok: true,
    classification: 'CONTROL_PLANE_BOOTSTRAP_REPAIRED',
    repairAttempted: true,
    sourceHead,
    mailboxIndex,
    recoveryMeshStatus,
    recoveryLifeboatHeartbeat,
    healthAssessment,
    repair,
    arbitraryTaskNameAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}

export async function runBattleBridgeWorkerWatchdogRunner({
  visibilityObserver = observeRemoteCodexTaskVisibility,
  participantRelay = runChatGptSharedWorkspaceGitHubRelay,
  backlogConveyor = ensureCriticalBacklogMission,
  workerWatchdog = runIsolatedBattleBridgeWorkerWatchdog,
  controlPlaneRecovery = runBattleBridgeControlPlaneBootstrapRecovery,
} = {}) {
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
