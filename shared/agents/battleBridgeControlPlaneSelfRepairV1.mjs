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
export const BATTLE_BRIDGE_RUNTIME_CONTROL_PLANE_TASKS = Object.freeze([
  ...CORE_CONTROL_PLANE_TASKS,
  BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK,
]);

const POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const MAX_OUTPUT_BYTES = 128 * 1024;

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

export function reconcileBattleBridgeControlPlane({
  repoRoot = '',
  expectedHead = '',
  platform = process.platform,
  spawnSyncFn = spawnSync,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const core = reconcileCoreControlPlane({ repoRoot, expectedHead, platform, spawnSyncFn });
  if (!core.ok) return core;

  const canonicalRoot = canonicalBattleBridgeRoot({ env, home });
  if (resolve(repoRoot) !== canonicalRoot) return core;

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
  return Object.freeze({
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
}
