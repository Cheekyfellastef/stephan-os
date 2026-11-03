import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { resolve } from 'node:path';

import {
  BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA,
  BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_VERDICT,
  BATTLE_BRIDGE_CONTROL_PLANE_TASKS as CORE_CONTROL_PLANE_TASKS,
  classifyFixedInstallerFailure,
  reconcileBattleBridgeControlPlane as reconcileCoreControlPlane,
} from './battleBridgeControlPlaneSelfRepairCoreV1.mjs';

// Preservation anchors for the existing fixed core. The core remains responsible for
// classifyDirt and these five reviewed installers, unchanged byte-for-byte:
// scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1
// scripts/windows/install-battle-bridge-recovery-mesh.ps1
// scripts/windows/install-battle-bridge-worker-watchdog.ps1
// scripts/windows/install-battle-bridge-github-command-mailbox.ps1
// scripts/windows/install-battle-bridge-outbound-health-beacon.ps1

export {
  BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA,
  BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_VERDICT,
  classifyFixedInstallerFailure,
};

export const BATTLE_BRIDGE_CONTROL_PLANE_TASKS = CORE_CONTROL_PLANE_TASKS;
export const BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK = Object.freeze({
  id: 'monitorMultiplexer',
  taskName: 'Stephanos Battle Bridge Monitor Multiplexer',
  installerRelativePath: 'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1',
  intervalMinutes: 1,
});
export const BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK = Object.freeze({
  id: 'sovereignCommanderWatchdog',
  taskName: 'Stephanos Sovereign Commander',
  runnerRelativePath: 'scripts/windows/run-sovereign-commander-hidden.ps1',
  intervalMinutes: 1,
});
export const BATTLE_BRIDGE_RUNTIME_CONTROL_PLANE_TASKS = Object.freeze([
  ...CORE_CONTROL_PLANE_TASKS,
  BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK,
  BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK,
]);

const POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const MAX_OUTPUT_BYTES = 128 * 1024;
const REQUIRED_SOVEREIGN_COMMANDER_CAPABILITY_VERSION = '2026-10-18-island-action-contract-v6';
const CARETAKER_EXECUTION_SCHEMA = 'stephanos.sovereign-caretaker-execution.v1';
const CHILD_ERROR_CODES = new Set(['ETIMEDOUT', 'ENOBUFS', 'ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'E2BIG', 'EIO', 'EMFILE', 'ENFILE', 'ENOMEM', 'EAGAIN', 'ENOSYS', 'ABORT_ERR', 'CHILD_PROCESS_ERROR']);
const CHILD_SIGNALS = new Set(['SIGABRT', 'SIGTERM', 'SIGKILL', 'SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGSEGV', 'SIGILL', 'SIGFPE', 'UNKNOWN']);
const CARETAKER_FAILURE_VERDICTS = new Set([
  'SOVEREIGN_COMMANDER_WATCHDOG_BLOCKED',
  'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_BLOCKED',
  'SOVEREIGN_COMMANDER_CORE_DAEMON_BLOCKED',
  'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISION_BLOCKED',
]);
// This is diagnostic data from one fixed child, never another health/admission
// authority. Keep the vocabulary closed; no stderr, paths or free text travels.
const CARETAKER_FAILURE_CODES = new Set([
  'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN', 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN', 'SOVEREIGN_MAINTENANCE_OWNER_BUSY',
  'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN', 'SOVEREIGN_COMMANDER_SERVER_SCRIPT_MISSING',
  'SOVEREIGN_COMMANDER_TOKEN_MISSING', 'SOVEREIGN_COMMANDER_CANONICAL_NODE_MISSING',
  'SOVEREIGN_COMMANDER_STALE_CONTRACT_RECYCLE_FAILED', 'SOVEREIGN_COMMANDER_START_FAILED',
  'SOVEREIGN_COMMANDER_NOT_HEALTHY', 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_BLOCKED',
  'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_NOT_RUNNING', 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_POWERSHELL_MISSING',
  'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_SCRIPT_MISSING', 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_STALE_RECYCLE_FAILED',
  'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_START_FAILED', 'SOVEREIGN_COMMANDER_CORE_DAEMON_BLOCKED',
  'SOVEREIGN_COMMANDER_CORE_DAEMON_CUSTODY_AMBIGUOUS', 'SOVEREIGN_COMMANDER_CORE_DAEMON_NODE_MISSING',
  'SOVEREIGN_COMMANDER_CORE_DAEMON_NOT_HEALTHY', 'SOVEREIGN_COMMANDER_CORE_DAEMON_PROCESS_INVENTORY_UNPROVEN',
  'SOVEREIGN_COMMANDER_CORE_DAEMON_SCRIPT_MISSING', 'SOVEREIGN_COMMANDER_CORE_DAEMON_SINGLE_WRITER_UNVERIFIED',
  'SOVEREIGN_COMMANDER_CORE_DAEMON_START_FAILED', 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_EXECUTION_FAILED',
  'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_FAILED', 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RECEIPT_MISSING',
  'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCRIPT_MISSING',
]);

function text(value) {
  return String(value ?? '').trim();
}

function canonicalBattleBridgeRoot({ env = process.env, home = os.homedir() } = {}) {
  const userHome = resolve(env.USERPROFILE || env.HOME || home);
  return resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
}

function parseInstallerJson(stdout) {
  const payload = text(stdout);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  const lines = payload.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

export function projectSovereignCaretakerExecutionEvidence(value, expectedSourceHead = '') {
  if (!value || value.schemaVersion !== CARETAKER_EXECUTION_SCHEMA
      || typeof value.expectedSourceHead !== 'string' || !/^[a-f0-9]{40}$/.test(value.expectedSourceHead)
      || (expectedSourceHead && value.expectedSourceHead !== expectedSourceHead)
      || typeof value.observedAtUtc !== 'string' || value.observedAtUtc.length !== 24
      || !Number.isFinite(Date.parse(value.observedAtUtc))
      || new Date(value.observedAtUtc).toISOString() !== value.observedAtUtc) return null;
  const failureReceiptRecognized = value.failureReceiptRecognized === true
    && CARETAKER_FAILURE_VERDICTS.has(value.reportedVerdict)
    && CARETAKER_FAILURE_CODES.has(value.reportedBlocker);
  return Object.freeze({
    schemaVersion: CARETAKER_EXECUTION_SCHEMA,
    expectedSourceHead: value.expectedSourceHead,
    observedAtUtc: value.observedAtUtc,
    exitStatus: Number.isInteger(value.exitStatus) && value.exitStatus >= -2147483648 && value.exitStatus <= 4294967295 ? value.exitStatus : null,
    spawnErrorCode: value.spawnErrorCode ? (CHILD_ERROR_CODES.has(value.spawnErrorCode) ? value.spawnErrorCode : 'CHILD_PROCESS_ERROR') : '',
    terminationSignal: value.terminationSignal ? (CHILD_SIGNALS.has(value.terminationSignal) ? value.terminationSignal : 'UNKNOWN') : '',
    failureReceiptRecognized,
    reportedBlocker: failureReceiptRecognized ? value.reportedBlocker : '',
    reportedVerdict: failureReceiptRecognized ? value.reportedVerdict : '',
    diagnosticOnly: true,
  });
}

function caretakerExecutionEvidence(command, payload, expectedSourceHead) {
  const earlyOperatorDenial = payload?.normalOperatorObserved === false
    && payload?.runtimeActivationGranted === false && payload?.sourceMutationAllowed === false
    && ['SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN', 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED'].includes(payload?.blocker)
    && payload?.finalVerdict === 'SOVEREIGN_COMMANDER_WATCHDOG_BLOCKED';
  const identified = payload?.schemaVersion === 'stephanos.sovereign-commander-watchdog.v1'
    && (payload?.taskName === BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName || (payload?.taskName === undefined && earlyOperatorDenial));
  const failureReceiptRecognized = identified && payload?.healthy === false
    && payload?.arbitraryShellAllowed === false && payload?.pcRestartAllowed === false
    && CARETAKER_FAILURE_VERDICTS.has(payload?.finalVerdict)
    && CARETAKER_FAILURE_CODES.has(payload?.blocker);
  return projectSovereignCaretakerExecutionEvidence({
    schemaVersion: CARETAKER_EXECUTION_SCHEMA,
    expectedSourceHead,
    observedAtUtc: new Date().toISOString(),
    exitStatus: command?.status,
    spawnErrorCode: command?.error ? (command.error.code || 'CHILD_PROCESS_ERROR') : '',
    terminationSignal: command?.signal || '',
    failureReceiptRecognized,
    reportedBlocker: payload?.blocker,
    reportedVerdict: payload?.finalVerdict,
  }, expectedSourceHead);
}

export function validateMonitorMultiplexerInstallerReceipt(payload) {
  return Boolean(
    payload
    && payload.taskName === BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.taskName
    && payload.installed === true
    && payload.startedNow === true
    && Number(payload.intervalMinutes) === 1
    && payload.atLogon === true
    && payload.hidden === true
    && payload.runLevel === 'Limited'
    && payload.arbitraryShellAllowed === false
    && payload.arbitraryPowerShellAllowed === false
    && payload.sourceMutationAllowed === false
    && payload.mergeAuthority === false
    && Number(payload.externalTaskSlotsRequired) === 1
    && Number(payload.maximumLogicalMonitors) === 1000
    && Number(payload.maximumConcurrentHandlers) === 16
    && payload.headlessLauncher === true
  );
}

export function validateSovereignCommanderWatchdogReceipt(payload) {
  return Boolean(
    payload
    && payload.schemaVersion === 'stephanos.sovereign-commander-watchdog.v1'
    && payload.taskName === BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName
    && payload.daemonHealthy === true
    && payload.coreDaemonHealthy === true
    && payload.fleetGoalSupervisorOk === true
    && payload.healthy === true
    && payload.canonicalGoalFabricOnly === true
    && payload.sourceMutationDelegatedToMissionWorker === true
    && payload.duplicateSchedulerAllowed === false
    && payload.duplicateLeaseAllowed === false
    && payload.vendorMeterRequired === false
    && payload.externalSaasRelayRequired === false
    && payload.networkInstallAllowed === false
    && payload.packageMutationAllowed === false
    && payload.arbitraryExecutableAllowed === false
    && payload.arbitraryShellAllowed === false
    && payload.unrelatedProcessRestartAllowed === false
    && payload.pcRestartAllowed === false
    && payload.visiblePowerShellRequired === false
    && payload.finalVerdict === 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY'
  );
}

function projectMonitorFailure(core, blocker, details = {}) {
  const monitorResult = Object.freeze({
    id: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.id,
    taskName: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.taskName,
    installerRelativePath: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.installerRelativePath,
    intervalMinutes: 1,
    installed: false,
    startRequested: true,
    receiptValid: false,
    installerExitOk: details.installerExitOk === true,
  });
  return Object.freeze({
    ...core,
    ok: false,
    blocker,
    failedTaskId: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.id,
    taskCount: Number(core?.taskCount || 0) + 1,
    tasks: Object.freeze([...(Array.isArray(core?.tasks) ? core.tasks : []), monitorResult]),
    canonicalTaskNames: Object.freeze([
      ...(Array.isArray(core?.canonicalTaskNames) ? core.canonicalTaskNames : []),
      BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.taskName,
    ]),
    finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_BLOCKED',
  });
}

function projectSovereignFailure(current, blocker, details = {}) {
  const sovereignCaretakerExecution = projectSovereignCaretakerExecutionEvidence(details.executionEvidence, current.sourceHead);
  const commanderResult = Object.freeze({
    id: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.id,
    taskName: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName,
    runnerRelativePath: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.runnerRelativePath,
    intervalMinutes: 1,
    healthy: false,
    startRequested: true,
    receiptValid: false,
    runnerExitOk: details.runnerExitOk === true,
    executionEvidence: sovereignCaretakerExecution,
  });
  return Object.freeze({
    ...current,
    ok: false,
    blocker,
    failedTaskId: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.id,
    sovereignCaretakerExecution,
    taskCount: Number(current?.taskCount || 0) + 1,
    tasks: Object.freeze([...(Array.isArray(current?.tasks) ? current.tasks : []), commanderResult]),
    canonicalTaskNames: Object.freeze([
      ...(Array.isArray(current?.canonicalTaskNames) ? current.canonicalTaskNames : []),
      BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName,
    ]),
    sovereignCommanderRequired: true,
    remoteCommanderRequired: false,
    finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_BLOCKED',
  });
}

function runSovereignCaretaker(canonicalRoot, spawnSyncFn, expectedSourceHead) {
  const runnerPath = resolve(
    canonicalRoot,
    BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.runnerRelativePath,
  );
  let command;
  try {
    command = spawnSyncFn(POWERSHELL_EXE, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', runnerPath,
      '-RequireCapabilityVersion', REQUIRED_SOVEREIGN_COMMANDER_CAPABILITY_VERSION,
    ], {
      cwd: canonicalRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    command = { status: null, error };
  }
  const runnerExitOk = !command?.error && command?.status === 0;
  const payload = typeof command?.stdout === 'string' && Buffer.byteLength(command.stdout, 'utf8') <= MAX_OUTPUT_BYTES
    ? parseInstallerJson(command.stdout) : null;
  const receiptValid = runnerExitOk && validateSovereignCommanderWatchdogReceipt(payload);
  return Object.freeze({ runnerExitOk, receiptValid, payload,
    executionEvidence: caretakerExecutionEvidence(command, payload, expectedSourceHead) });
}

export function reconcileBattleBridgeControlPlane({
  repoRoot = '',
  expectedHead = '',
  platform = process.platform,
  spawnSyncFn = spawnSync,
  env = process.env,
  home = os.homedir(),
  skipTaskIds = [],
} = {}) {
  const core = reconcileCoreControlPlane({ repoRoot, expectedHead, platform, spawnSyncFn, skipTaskIds });
  const coreInstallerFailure = core?.ok !== true
    && core?.blocker === 'CONTROL_PLANE_FIXED_INSTALLER_FAILED'
    && core?.sourceDirtSafe === true
    && core?.workConservingRepairAttempted === true;
  if (!core.ok && !coreInstallerFailure) return core;

  const canonicalRoot = canonicalBattleBridgeRoot({ env, home });
  if (resolve(repoRoot) !== canonicalRoot) return core;

  if (coreInstallerFailure) {
    const emergency = runSovereignCaretaker(canonicalRoot, spawnSyncFn, expectedHead);
    const emergencyCommanderResult = Object.freeze({
      id: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.id,
      taskName: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName,
      runnerRelativePath: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.runnerRelativePath,
      intervalMinutes: 1,
      healthy: emergency.receiptValid,
      startRequested: true,
      receiptValid: emergency.receiptValid,
      runnerExitOk: emergency.runnerExitOk,
      executionEvidence: emergency.executionEvidence,
    });
    return Object.freeze({
      ...core,
      taskCount: Number(core.taskCount || 0) + 1,
      tasks: Object.freeze([...(Array.isArray(core.tasks) ? core.tasks : []), emergencyCommanderResult]),
      canonicalTaskNames: Object.freeze([
        ...(Array.isArray(core.canonicalTaskNames) ? core.canonicalTaskNames : []),
        BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName,
      ]),
      independentSovereignRepairAttempted: true,
      independentSovereignRepairSucceeded: emergency.receiptValid,
      sovereignRunnerExitOk: emergency.runnerExitOk,
      sovereignReceiptValid: emergency.receiptValid,
      sovereignCaretakerExecution: emergency.executionEvidence,
      sovereignCommanderRequired: true,
      remoteCommanderRequired: false,
      finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_BLOCKED',
    });
  }

  const installerPath = resolve(canonicalRoot, BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.installerRelativePath);
  const command = spawnSyncFn(POWERSHELL_EXE, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', installerPath,
    '-StartNow',
  ], {
    cwd: canonicalRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  const installerExitOk = !command?.error && command?.status === 0;
  if (!installerExitOk) {
    return projectMonitorFailure(core, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED', { installerExitOk: false });
  }
  const payload = parseInstallerJson(command.stdout);
  if (!validateMonitorMultiplexerInstallerReceipt(payload)) {
    return projectMonitorFailure(core, 'CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID', { installerExitOk: true });
  }

  const monitorResult = Object.freeze({
    id: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.id,
    taskName: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.taskName,
    installerRelativePath: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.installerRelativePath,
    intervalMinutes: 1,
    installed: true,
    startRequested: true,
    receiptValid: true,
    installerExitOk: true,
  });
  const withMonitor = Object.freeze({
    ...core,
    ok: true,
    schemaVersion: BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA,
    blocker: '',
    taskCount: Number(core.taskCount) + 1,
    tasks: Object.freeze([...core.tasks, monitorResult]),
    canonicalTaskNames: Object.freeze([
      ...core.canonicalTaskNames,
      BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK.taskName,
    ]),
    finalVerdict: BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_VERDICT,
  });

  const sovereign = runSovereignCaretaker(canonicalRoot, spawnSyncFn, expectedHead);
  if (!sovereign.runnerExitOk) {
    return projectSovereignFailure(withMonitor, 'SOVEREIGN_COMMANDER_WATCHDOG_EXECUTION_FAILED', {
      runnerExitOk: false,
      executionEvidence: sovereign.executionEvidence,
    });
  }
  if (!sovereign.receiptValid) {
    return projectSovereignFailure(withMonitor, 'SOVEREIGN_COMMANDER_WATCHDOG_RECEIPT_INVALID', {
      runnerExitOk: true,
      executionEvidence: sovereign.executionEvidence,
    });
  }

  const commanderResult = Object.freeze({
    id: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.id,
    taskName: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName,
    runnerRelativePath: BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.runnerRelativePath,
    intervalMinutes: 1,
    healthy: true,
    startRequested: true,
    receiptValid: true,
    runnerExitOk: true,
    executionEvidence: sovereign.executionEvidence,
  });
  return Object.freeze({
    ...withMonitor,
    taskCount: Number(withMonitor.taskCount) + 1,
    tasks: Object.freeze([...withMonitor.tasks, commanderResult]),
    canonicalTaskNames: Object.freeze([
      ...withMonitor.canonicalTaskNames,
      BATTLE_BRIDGE_SOVEREIGN_COMMANDER_WATCHDOG_TASK.taskName,
    ]),
    sovereignCommanderRequired: true,
    sovereignCommanderHealthy: true,
    sovereignCaretakerExecution: sovereign.executionEvidence,
    remoteCommanderRequired: false,
    finalVerdict: BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_VERDICT,
  });
}
