import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export const BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA = 'stephanos.battle-bridge-control-plane-reconcile.v1';
export const BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_VERDICT = 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED';
export const BATTLE_BRIDGE_CONTROL_PLANE_TASKS = Object.freeze([
  Object.freeze({
    id: 'recoveryMesh',
    taskName: 'Stephanos Battle Bridge Recovery Mesh',
    installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    intervalMinutes: 1,
  }),
  Object.freeze({
    id: 'githubCommandMailbox',
    taskName: 'Stephanos Battle Bridge GitHub Command Mailbox',
    installerRelativePath: 'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
    intervalMinutes: 5,
  }),
]);

const SHA = /^[0-9a-f]{40}$/;
const POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT_EXE = 'C:\\Program Files\\Git\\cmd\\git.exe';
const MAX_OUTPUT_BYTES = 128 * 1024;

function text(value) {
  return String(value ?? '').trim();
}

function capture(spawnSyncFn, executable, args, { cwd, timeout = 180_000 } = {}) {
  const result = spawnSyncFn(executable, [...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? '').slice(0, 1000),
    errorCode: result?.error?.code || '',
  });
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

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    schemaVersion: BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA,
    blocker,
    repository: 'Cheekyfellastef/stephan-os',
    branch: '',
    sourceHead: '',
    trackedSourceClean: false,
    taskCount: BATTLE_BRIDGE_CONTROL_PLANE_TASKS.length,
    tasks: Object.freeze([]),
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    pcRestartAllowed: false,
    publicExposureChanged: false,
    finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_BLOCKED',
    ...details,
  });
}

function validateRecoveryMeshReceipt(payload) {
  return Boolean(
    payload
    && payload.schemaVersion === 'stephanos.battle-bridge-recovery-mesh-install.v1'
    && payload.taskName === 'Stephanos Battle Bridge Recovery Mesh'
    && payload.installed === true
    && payload.startedNow === true
    && payload.taskPresentAfter === true
    && payload.whatIf === false
    && Number(payload.intervalMinutes) === 1
    && payload.atLogon === true
    && payload.hidden === true
    && payload.runLevel === 'Limited'
    && payload.multipleInstances === 'IgnoreNew'
    && Number(payload.maximumConcurrentExecutors) === 1
    && payload.arbitraryShellAllowed === false
    && payload.arbitraryTaskNameAllowed === false
    && payload.sourceMutationAllowed === false
    && payload.pcRestartAllowed === false
    && payload.visiblePowerShellRequired === false
  );
}

function validateMailboxReceipt(payload) {
  return Boolean(
    payload
    && payload.taskName === 'Stephanos Battle Bridge GitHub Command Mailbox'
    && payload.installed === true
    && payload.startedNow === true
    && payload.receiptIndexEnabled === true
    && Number(payload.intervalMinutes) === 5
    && payload.atLogon === true
    && payload.hidden === true
    && payload.runLevel === 'Limited'
    && payload.arbitraryShellAllowed === false
    && payload.destructiveGitAllowed === false
    && payload.liveOpenClawUpdateAllowed === false
    && payload.headlessLauncher === true
  );
}

function sourceIdentity({ repoRoot, expectedHead, spawnSyncFn }) {
  if (!SHA.test(text(expectedHead).toLowerCase())) return blocked('CONTROL_PLANE_EXPECTED_HEAD_INVALID');
  const branch = capture(spawnSyncFn, GIT_EXE, ['-C', repoRoot, 'branch', '--show-current'], { cwd: repoRoot });
  if (!branch.ok || text(branch.stdout) !== 'main') return blocked('CONTROL_PLANE_SOURCE_BRANCH_NOT_MAIN');
  const head = capture(spawnSyncFn, GIT_EXE, ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot });
  const sourceHead = text(head.stdout).toLowerCase();
  if (!head.ok || sourceHead !== text(expectedHead).toLowerCase()) {
    return blocked('CONTROL_PLANE_SOURCE_HEAD_MISMATCH', { branch: 'main', sourceHead });
  }
  const status = capture(spawnSyncFn, GIT_EXE, ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=no'], { cwd: repoRoot });
  if (!status.ok) return blocked('CONTROL_PLANE_TRACKED_SOURCE_STATUS_FAILED', { branch: 'main', sourceHead });
  if (text(status.stdout)) return blocked('CONTROL_PLANE_TRACKED_SOURCE_DIRTY', { branch: 'main', sourceHead });
  return Object.freeze({ ok: true, branch: 'main', sourceHead, trackedSourceClean: true });
}

export function reconcileBattleBridgeControlPlane({
  repoRoot = '',
  expectedHead = '',
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  if (platform !== 'win32') return blocked('WINDOWS_REQUIRED');
  const canonicalRoot = resolve(repoRoot);
  const identity = sourceIdentity({ repoRoot: canonicalRoot, expectedHead, spawnSyncFn });
  if (!identity.ok) return identity;

  const results = [];
  for (const task of BATTLE_BRIDGE_CONTROL_PLANE_TASKS) {
    const installerPath = resolve(canonicalRoot, task.installerRelativePath);
    const command = capture(spawnSyncFn, POWERSHELL_EXE, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', installerPath,
      '-StartNow',
    ], { cwd: canonicalRoot, timeout: 180_000 });
    if (!command.ok) {
      return blocked('CONTROL_PLANE_FIXED_INSTALLER_FAILED', {
        branch: identity.branch,
        sourceHead: identity.sourceHead,
        trackedSourceClean: true,
        failedTaskId: task.id,
      });
    }
    const payload = parseInstallerJson(command.stdout);
    const receiptValid = task.id === 'recoveryMesh'
      ? validateRecoveryMeshReceipt(payload)
      : validateMailboxReceipt(payload);
    if (!receiptValid) {
      return blocked('CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID', {
        branch: identity.branch,
        sourceHead: identity.sourceHead,
        trackedSourceClean: true,
        failedTaskId: task.id,
      });
    }
    results.push(Object.freeze({
      id: task.id,
      taskName: task.taskName,
      installerRelativePath: task.installerRelativePath,
      intervalMinutes: task.intervalMinutes,
      installed: true,
      startRequested: true,
      receiptValid: true,
    }));
  }

  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA,
    blocker: '',
    repository: 'Cheekyfellastef/stephan-os',
    branch: identity.branch,
    sourceHead: identity.sourceHead,
    trackedSourceClean: true,
    taskCount: results.length,
    tasks: Object.freeze(results),
    canonicalTaskNames: Object.freeze(BATTLE_BRIDGE_CONTROL_PLANE_TASKS.map((task) => task.taskName)),
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    pcRestartAllowed: false,
    publicExposureChanged: false,
    finalVerdict: BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_VERDICT,
  });
}
