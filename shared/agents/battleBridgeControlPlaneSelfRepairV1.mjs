import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';

export const BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA = 'stephanos.battle-bridge-control-plane-reconcile.v1';
export const BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_VERDICT = 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED';
export const BATTLE_BRIDGE_CONTROL_PLANE_TASKS = Object.freeze([
  Object.freeze({
    id: 'recoveryLifeboat',
    taskName: 'Stephanos Battle Bridge Recovery Lifeboat',
    installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
    intervalMinutes: 2,
  }),
  Object.freeze({
    id: 'recoveryMesh',
    taskName: 'Stephanos Battle Bridge Recovery Mesh',
    installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    intervalMinutes: 1,
  }),
  Object.freeze({
    id: 'workerWatchdog',
    taskName: 'Stephanos Mission Orchestrator Worker Watchdog',
    installerRelativePath: 'scripts/windows/install-battle-bridge-worker-watchdog.ps1',
    intervalMinutes: 1,
  }),
  Object.freeze({
    id: 'githubCommandMailbox',
    taskName: 'Stephanos Battle Bridge GitHub Command Mailbox',
    installerRelativePath: 'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
    intervalMinutes: 5,
  }),
  Object.freeze({
    id: 'outboundHealthBeacon',
    taskName: 'Stephanos Battle Bridge Outbound Health Beacon',
    installerRelativePath: 'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1',
    intervalMinutes: 1,
  }),
]);

const SHA = /^[0-9a-f]{40}$/;
const POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT_EXE = 'C:\\Program Files\\Git\\cmd\\git.exe';
const MAX_OUTPUT_BYTES = 128 * 1024;
const GENERIC_FIXED_INSTALLER_BLOCKER = 'CONTROL_PLANE_FIXED_INSTALLER_FAILED';
const RECOVERY_LIFEBOAT_INSTALLER_FAILURE_RULES = Object.freeze([
  Object.freeze({
    fragment: 'LOCALAPPDATA is required.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_LOCALAPPDATA_REQUIRED',
  }),
  Object.freeze({
    fragment: 'Required fixed lifeboat component is missing:',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_REQUIRED_COMPONENT_MISSING',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat active-bank schema is invalid.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_STATE_SCHEMA_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat active bank is invalid.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_BANK_IDENTITY_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat active manifest is invalid.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_MANIFEST_IDENTITY_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat active bank is not self-test proven.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_SELF_TEST_NOT_PROVEN',
  }),
  Object.freeze({
    fragment: 'Installed immutable lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_ACTIVE_LAUNCHER_MISMATCH',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat active state requires the immutable active-bank launcher to already be installed.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_ACTIVE_LAUNCHER_MISSING',
  }),
  Object.freeze({
    fragment: 'Installed immutable windowless lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_WINDOWLESS_LAUNCHER_MISMATCH',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat active state requires the immutable windowless launcher to already be installed.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_WINDOWLESS_LAUNCHER_MISSING',
  }),
  Object.freeze({
    fragment: 'active manifest file is missing.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_MANIFEST_FILE_MISSING',
  }),
  Object.freeze({
    fragment: 'active manifest file is invalid.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_MANIFEST_FILE_INVALID',
  }),
  Object.freeze({
    fragment: 'active manifest file does not match active state.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_MANIFEST_MISMATCH',
  }),
  Object.freeze({
    fragment: 'heartbeat schema is invalid.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_HEARTBEAT_SCHEMA_INVALID',
  }),
  Object.freeze({
    fragment: 'heartbeat identity is invalid.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_HEARTBEAT_IDENTITY_INVALID',
  }),
  Object.freeze({
    fragment: 'heartbeat manifest mismatch.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_HEARTBEAT_MANIFEST_MISMATCH',
  }),
  Object.freeze({
    fragment: 'has no heartbeat.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_HEARTBEAT_MISSING',
  }),
  Object.freeze({
    fragment: 'heartbeat is not healthy and payload verified.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_HEARTBEAT_UNHEALTHY',
  }),
  Object.freeze({
    fragment: 'heartbeat is stale.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_HEARTBEAT_STALE',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat scheduled task action count is not canonical.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_TASK_ACTION_COUNT_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat scheduled task executable is not canonical.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_TASK_EXECUTABLE_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat scheduled task arguments are not canonical.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_TASK_ARGUMENTS_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat scheduled task principal is not canonical.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_TASK_PRINCIPAL_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat scheduled task logon type is not canonical.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_TASK_LOGON_TYPE_INVALID',
  }),
  Object.freeze({
    fragment: 'Existing lifeboat scheduled task run level is not canonical.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_TASK_RUN_LEVEL_INVALID',
  }),
  Object.freeze({
    fragment: 'Lifeboat installer must never target the active bank.',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_BANK_TARGET_GUARD',
  }),
  Object.freeze({
    fragment: 'Candidate lifeboat bank failed its installed-bank self-test:',
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_CANDIDATE_SELF_TEST_FAILED',
  }),
]);

function text(value) {
  return String(value ?? '').trim();
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).filter((line) => line.trim());
}

export function classifyFixedInstallerFailure(taskId, stderr = '') {
  if (taskId !== 'recoveryLifeboat') return GENERIC_FIXED_INSTALLER_BLOCKER;
  const source = String(stderr ?? '');
  for (const rule of RECOVERY_LIFEBOAT_INSTALLER_FAILURE_RULES) {
    if (source.includes(rule.fragment)) return rule.blocker;
  }
  return GENERIC_FIXED_INSTALLER_BLOCKER;
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
    sourceDirtSafe: false,
    runtimeOnlyDirtCount: 0,
    generatedSourceDirtCount: 0,
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

function validateRecoveryLifeboatReceipt(payload) {
  return Boolean(
    payload
    && payload.schemaVersion === 'stephanos.battle-bridge-recovery-lifeboat-install.v1'
    && payload.taskName === 'Stephanos Battle Bridge Recovery Lifeboat'
    && payload.startedNow === true
    && payload.candidateHeartbeatRequiredBeforePromotion === true
    && payload.payloadHashVerificationRequired === true
    && payload.githubClaimConsumerIncluded === true
    && payload.windowlessLauncher === true
    && payload.scheduledTaskExecutable === 'C:\\Windows\\System32\\wscript.exe'
    && payload.directPowerShellTaskLaunch === false
    && payload.repoCheckoutRequiredAfterInstall === false
    && payload.openClawGatewayRequiredAfterInstall === false
    && Number(payload.intervalMinutes) === 2
    && payload.atLogon === true
    && payload.runLevel === 'Limited'
    && payload.arbitraryPathAllowed === false
    && payload.arbitraryTaskNameAllowed === false
    && payload.arbitraryExecutableAllowed === false
    && payload.arbitraryShellAllowed === false
    && payload.gitMutationAllowed === false
    && payload.sourceMutationAllowed === false
    && payload.pcRestartAllowed === false
  );
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

function validateWorkerWatchdogReceipt(payload) {
  return Boolean(
    payload
    && payload.taskName === 'Stephanos Mission Orchestrator Worker Watchdog'
    && payload.installed === true
    && payload.startedNow === true
    && Number(payload.intervalMinutes) === 1
    && payload.atLogon === true
    && payload.hidden === true
    && payload.runLevel === 'Limited'
    && payload.multipleInstances === 'IgnoreNew'
    && payload.remoteCodexVisibilityReconciler === true
    && payload.arbitraryTaskNameAllowed === false
    && payload.arbitraryShellAllowed === false
    && payload.visiblePowerShellRequired === false
    && payload.headlessLauncher === true
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

function validateOutboundHealthBeaconReceipt(payload) {
  return Boolean(
    payload
    && payload.schemaVersion === 'stephanos.battle-bridge-outbound-health-beacon-install.v1'
    && payload.taskName === 'Stephanos Battle Bridge Outbound Health Beacon'
    && payload.installed === true
    && payload.startedNow === true
    && Number(payload.intervalMinutes) === 1
    && payload.atLogon === true
    && payload.hidden === true
    && payload.runLevel === 'Limited'
    && payload.multipleInstances === 'IgnoreNew'
    && payload.repository === 'Cheekyfellastef/stephan-os'
    && Number(payload.issueNumber) === 1889
    && payload.arbitraryShellAllowed === false
    && payload.sourceMutationAllowed === false
    && payload.taskMutationBeyondSelfAllowed === false
    && payload.processRestartAllowed === false
    && payload.destructiveGitAllowed === false
    && payload.liveOpenClawUpdateAllowed === false
    && payload.pcRestartAllowed === false
    && payload.visiblePowerShellRequired === false
  );
}

function validateTaskReceipt(taskId, payload) {
  if (taskId === 'recoveryLifeboat') return validateRecoveryLifeboatReceipt(payload);
  if (taskId === 'recoveryMesh') return validateRecoveryMeshReceipt(payload);
  if (taskId === 'workerWatchdog') return validateWorkerWatchdogReceipt(payload);
  if (taskId === 'githubCommandMailbox') return validateMailboxReceipt(payload);
  if (taskId === 'outboundHealthBeacon') return validateOutboundHealthBeaconReceipt(payload);
  return false;
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
  const status = capture(spawnSyncFn, GIT_EXE, ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot });
  if (!status.ok) return blocked('CONTROL_PLANE_SOURCE_STATUS_FAILED', { branch: 'main', sourceHead });
  const dirt = classifyDirt(splitLines(status.stdout));
  const dirtSummary = Object.freeze({
    trackedSourceCount: dirt.trackedSource.length,
    untrackedSourceCount: dirt.untrackedSource.length,
    runtimeOnlyCount: dirt.runtimeOnly.length,
    generatedSourceCount: dirt.generatedSource.length,
    unknownCount: dirt.unknown.length,
    blocksSync: dirt.blocksSync === true,
  });
  if (dirt.blocksSync) {
    return blocked('CONTROL_PLANE_SOURCE_DIRT_BLOCKED', {
      branch: 'main',
      sourceHead,
      sourceDirtSafe: false,
      runtimeOnlyDirtCount: dirt.runtimeOnly.length,
      generatedSourceDirtCount: dirt.generatedSource.length,
      dirtSummary,
    });
  }
  return Object.freeze({
    ok: true,
    branch: 'main',
    sourceHead,
    sourceDirtSafe: true,
    runtimeOnlyDirtCount: dirt.runtimeOnly.length,
    generatedSourceDirtCount: dirt.generatedSource.length,
    dirtSummary,
  });
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
  const installerFailures = [];
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
      const failureBlocker = classifyFixedInstallerFailure(task.id, command.stderr);
      installerFailures.push(Object.freeze({
        id: task.id,
        taskName: task.taskName,
        blocker: failureBlocker,
      }));
      results.push(Object.freeze({
        id: task.id,
        taskName: task.taskName,
        installerRelativePath: task.installerRelativePath,
        intervalMinutes: task.intervalMinutes,
        installed: false,
        startRequested: true,
        receiptValid: false,
        installerExitOk: false,
      }));
      continue;
    }
    const payload = parseInstallerJson(command.stdout);
    const receiptValid = validateTaskReceipt(task.id, payload);
    if (!receiptValid) {
      return blocked('CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID', {
        branch: identity.branch,
        sourceHead: identity.sourceHead,
        sourceDirtSafe: true,
        runtimeOnlyDirtCount: identity.runtimeOnlyDirtCount,
        generatedSourceDirtCount: identity.generatedSourceDirtCount,
        dirtSummary: identity.dirtSummary,
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

  if (installerFailures.length > 0) {
    const primaryFailure = installerFailures[0];
    return blocked(primaryFailure.blocker, {
      branch: identity.branch,
      sourceHead: identity.sourceHead,
      sourceDirtSafe: true,
      runtimeOnlyDirtCount: identity.runtimeOnlyDirtCount,
      generatedSourceDirtCount: identity.generatedSourceDirtCount,
      dirtSummary: identity.dirtSummary,
      failedTaskId: primaryFailure.id,
      failedTaskIds: Object.freeze(installerFailures.map((failure) => failure.id)),
      installerFailureCount: installerFailures.length,
      taskCount: results.length,
      tasks: Object.freeze(results),
      workConservingRepairAttempted: true,
      independentFixedRepairContinued: true,
    });
  }

  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_CONTROL_PLANE_REPAIR_SCHEMA,
    blocker: '',
    repository: 'Cheekyfellastef/stephan-os',
    branch: identity.branch,
    sourceHead: identity.sourceHead,
    sourceDirtSafe: true,
    runtimeOnlyDirtCount: identity.runtimeOnlyDirtCount,
    generatedSourceDirtCount: identity.generatedSourceDirtCount,
    dirtSummary: identity.dirtSummary,
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
