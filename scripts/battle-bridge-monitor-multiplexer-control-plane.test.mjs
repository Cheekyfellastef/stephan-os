import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  BATTLE_BRIDGE_CONTROL_PLANE_TASKS,
  BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK,
  BATTLE_BRIDGE_RUNTIME_CONTROL_PLANE_TASKS,
  reconcileBattleBridgeControlPlane,
  validateMonitorMultiplexerInstallerReceipt,
} from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';

const HEAD = 'a'.repeat(40);
const USER_HOME = resolve('/user');
const REPO_ROOT = resolve(USER_HOME, 'Documents', 'GitHub', 'stephan-os');

function lifeboatReceipt() {
  return {
    schemaVersion: 'stephanos.battle-bridge-recovery-lifeboat-install.v1',
    taskName: 'Stephanos Battle Bridge Recovery Lifeboat',
    startedNow: true,
    candidateHeartbeatRequiredBeforePromotion: true,
    payloadHashVerificationRequired: true,
    githubClaimConsumerIncluded: true,
    windowlessLauncher: true,
    scheduledTaskExecutable: 'C:\\Windows\\System32\\wscript.exe',
    directPowerShellTaskLaunch: false,
    repoCheckoutRequiredAfterInstall: false,
    openClawGatewayRequiredAfterInstall: false,
    intervalMinutes: 2,
    atLogon: true,
    runLevel: 'Limited',
    arbitraryPathAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
  };
}
function recoveryReceipt() {
  return {
    schemaVersion: 'stephanos.battle-bridge-recovery-mesh-install.v1',
    taskName: 'Stephanos Battle Bridge Recovery Mesh',
    installed: true,
    startedNow: true,
    taskPresentAfter: true,
    whatIf: false,
    intervalMinutes: 1,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    multipleInstances: 'IgnoreNew',
    maximumConcurrentExecutors: 1,
    arbitraryShellAllowed: false,
    arbitraryTaskNameAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
    visiblePowerShellRequired: false,
  };
}
function watchdogReceipt() {
  return {
    taskName: 'Stephanos Mission Orchestrator Worker Watchdog',
    installed: true,
    intervalMinutes: 1,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    multipleInstances: 'IgnoreNew',
    startedNow: true,
    remoteCodexVisibilityReconciler: true,
    arbitraryTaskNameAllowed: false,
    arbitraryShellAllowed: false,
    visiblePowerShellRequired: false,
    headlessLauncher: true,
  };
}
function mailboxReceipt() {
  return {
    taskName: 'Stephanos Battle Bridge GitHub Command Mailbox',
    installed: true,
    receiptIndexEnabled: true,
    intervalMinutes: 5,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    startedNow: true,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
    headlessLauncher: true,
  };
}
function beaconReceipt() {
  return {
    schemaVersion: 'stephanos.battle-bridge-outbound-health-beacon-install.v1',
    taskName: 'Stephanos Battle Bridge Outbound Health Beacon',
    installed: true,
    startedNow: true,
    intervalMinutes: 1,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    multipleInstances: 'IgnoreNew',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1889,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    taskMutationBeyondSelfAllowed: false,
    processRestartAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
    pcRestartAllowed: false,
    visiblePowerShellRequired: false,
  };
}
function multiplexerReceipt(overrides = {}) {
  return {
    taskName: 'Stephanos Battle Bridge Monitor Multiplexer',
    installed: true,
    intervalMinutes: 1,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    startedNow: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    externalTaskSlotsRequired: 1,
    maximumLogicalMonitors: 1000,
    maximumConcurrentHandlers: 16,
    headlessLauncher: true,
    ...overrides,
  };
}

function scriptedSpawn({ multiplexer = multiplexerReceipt() } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status') && args.includes('--porcelain=v1')) return { status: 0, stdout: '', stderr: '' };
    const file = args.find((arg) => String(arg).endsWith('.ps1')) || '';
    if (String(file).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1')) return { status: 0, stdout: `${JSON.stringify(lifeboatReceipt())}\n`, stderr: '' };
    if (String(file).endsWith('install-battle-bridge-recovery-mesh.ps1')) return { status: 0, stdout: `${JSON.stringify(recoveryReceipt())}\n`, stderr: '' };
    if (String(file).endsWith('install-battle-bridge-worker-watchdog.ps1')) return { status: 0, stdout: `${JSON.stringify(watchdogReceipt())}\n`, stderr: '' };
    if (String(file).endsWith('install-battle-bridge-github-command-mailbox.ps1')) return { status: 0, stdout: `${JSON.stringify(mailboxReceipt())}\n`, stderr: '' };
    if (String(file).endsWith('install-battle-bridge-outbound-health-beacon.ps1')) return { status: 0, stdout: `${JSON.stringify(beaconReceipt())}\n`, stderr: '' };
    if (String(file).endsWith('install-battle-bridge-monitor-multiplexer.ps1')) return { status: 0, stdout: `${JSON.stringify(multiplexer)}\n`, stderr: '' };
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

test('runtime control plane extends the preserved five-task core with one fixed monitor multiplexer task', () => {
  assert.equal(BATTLE_BRIDGE_CONTROL_PLANE_TASKS.length, 5);
  assert.equal(BATTLE_BRIDGE_RUNTIME_CONTROL_PLANE_TASKS.length, 6);
  assert.deepEqual(BATTLE_BRIDGE_RUNTIME_CONTROL_PLANE_TASKS.slice(0, 5), BATTLE_BRIDGE_CONTROL_PLANE_TASKS);
  assert.deepEqual(BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK, {
    id: 'monitorMultiplexer',
    taskName: 'Stephanos Battle Bridge Monitor Multiplexer',
    installerRelativePath: 'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1',
    intervalMinutes: 1,
  });
  assert.equal(BATTLE_BRIDGE_RUNTIME_CONTROL_PLANE_TASKS[5], BATTLE_BRIDGE_MONITOR_MULTIPLEXER_TASK);
});

test('monitor multiplexer installer receipt is exact and authority-bounded', () => {
  assert.equal(validateMonitorMultiplexerInstallerReceipt(multiplexerReceipt()), true);
  for (const mutation of [
    { taskName: 'Lookalike Multiplexer' },
    { installed: false },
    { startedNow: false },
    { intervalMinutes: 5 },
    { runLevel: 'Highest' },
    { arbitraryShellAllowed: true },
    { arbitraryPowerShellAllowed: true },
    { sourceMutationAllowed: true },
    { mergeAuthority: true },
    { externalTaskSlotsRequired: 2 },
    { maximumLogicalMonitors: 1001 },
    { maximumConcurrentHandlers: 17 },
    { headlessLauncher: false },
  ]) assert.equal(validateMonitorMultiplexerInstallerReceipt(multiplexerReceipt(mutation)), false, JSON.stringify(mutation));
});

test('canonical Battle Bridge reconciliation preserves the five-task core and installs/starts multiplexer sixth', () => {
  const spawnSyncFn = scriptedSpawn();
  const result = reconcileBattleBridgeControlPlane({
    repoRoot: REPO_ROOT,
    expectedHead: HEAD,
    platform: 'win32',
    spawnSyncFn,
    env: { USERPROFILE: USER_HOME },
    home: USER_HOME,
  });
  assert.equal(result.ok, true);
  assert.equal(result.taskCount, 6);
  assert.equal(result.tasks.length, 6);
  assert.equal(result.tasks[5].id, 'monitorMultiplexer');
  assert.equal(result.tasks[5].installed, true);
  assert.equal(result.tasks[5].startRequested, true);
  assert.equal(result.tasks[5].receiptValid, true);
  assert.equal(result.canonicalTaskNames.at(-1), 'Stephanos Battle Bridge Monitor Multiplexer');
  const installers = spawnSyncFn.calls.filter((call) => call.command.includes('WindowsPowerShell'));
  assert.equal(installers.length, 6);
  assert.equal(installers[5].args.some((arg) => String(arg).endsWith('install-battle-bridge-monitor-multiplexer.ps1')), true);
  assert.equal(installers[5].args.at(-1), '-StartNow');
  assert.equal(installers[5].options.shell, false);
});

test('malformed multiplexer installer receipt fails closed after the preserved core is healthy', () => {
  const spawnSyncFn = scriptedSpawn({ multiplexer: multiplexerReceipt({ mergeAuthority: true }) });
  const result = reconcileBattleBridgeControlPlane({
    repoRoot: REPO_ROOT,
    expectedHead: HEAD,
    platform: 'win32',
    spawnSyncFn,
    env: { USERPROFILE: USER_HOME },
    home: USER_HOME,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID');
  assert.equal(result.failedTaskId, 'monitorMultiplexer');
  assert.equal(result.taskCount, 6);
  assert.equal(result.tasks[5].receiptValid, false);
});

test('non-canonical test seams preserve legacy five-task behaviour and never install multiplexer', () => {
  const spawnSyncFn = scriptedSpawn();
  const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
  assert.equal(result.ok, true);
  assert.equal(result.taskCount, 5);
  assert.equal(spawnSyncFn.calls.some((call) => call.args.some((arg) => String(arg).endsWith('install-battle-bridge-monitor-multiplexer.ps1'))), false);
});
