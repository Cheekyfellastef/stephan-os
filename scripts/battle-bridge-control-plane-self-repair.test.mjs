import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BATTLE_BRIDGE_CONTROL_PLANE_TASKS,
  reconcileBattleBridgeControlPlane,
} from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';

const HEAD = 'a'.repeat(40);

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

function workerWatchdogReceipt() {
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

function scriptedSpawn({
  head = HEAD,
  status = '',
  lifeboat = lifeboatReceipt(),
  recovery = recoveryReceipt(),
  workerWatchdog = workerWatchdogReceipt(),
  mailbox = mailboxReceipt(),
  beacon = beaconReceipt(),
} = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${head}\n`, stderr: '' };
    if (args.includes('status') && args.includes('--porcelain=v1')) return { status: 0, stdout: status, stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1'))) return { status: 0, stdout: `${JSON.stringify(lifeboat)}\n`, stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-mesh.ps1'))) return { status: 0, stdout: `${JSON.stringify(recovery)}\n`, stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-worker-watchdog.ps1'))) return { status: 0, stdout: `${JSON.stringify(workerWatchdog)}\n`, stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-github-command-mailbox.ps1'))) return { status: 0, stdout: `${JSON.stringify(mailbox)}\n`, stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-outbound-health-beacon.ps1'))) return { status: 0, stdout: `${JSON.stringify(beacon)}\n`, stderr: '' };
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

test('control-plane repair is fixed to Lifeboat first, then Recovery Mesh, worker watchdog, mailbox and outbound beacon', () => {
  assert.deepEqual(BATTLE_BRIDGE_CONTROL_PLANE_TASKS.map(({ id, taskName, installerRelativePath }) => ({ id, taskName, installerRelativePath })), [
    { id: 'recoveryLifeboat', taskName: 'Stephanos Battle Bridge Recovery Lifeboat', installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1' },
    { id: 'recoveryMesh', taskName: 'Stephanos Battle Bridge Recovery Mesh', installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-mesh.ps1' },
    { id: 'workerWatchdog', taskName: 'Stephanos Mission Orchestrator Worker Watchdog', installerRelativePath: 'scripts/windows/install-battle-bridge-worker-watchdog.ps1' },
    { id: 'githubCommandMailbox', taskName: 'Stephanos Battle Bridge GitHub Command Mailbox', installerRelativePath: 'scripts/windows/install-battle-bridge-github-command-mailbox.ps1' },
    { id: 'outboundHealthBeacon', taskName: 'Stephanos Battle Bridge Outbound Health Beacon', installerRelativePath: 'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1' },
  ]);
});

test('control-plane repair proves exact main and safe source dirt before starting fixed installers', () => {
  const spawnSyncFn = scriptedSpawn({ status: ' M apps/stephanos/dist/index.html\n?? logs/runtime-probe.json\n' });
  const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.sourceDirtSafe, true);
  assert.equal(result.runtimeOnlyDirtCount, 2);
  assert.equal(result.dirtSummary.blocksSync, false);
  assert.equal(result.taskCount, 5);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED');
  assert.equal(result.arbitraryTaskNameAllowed, false);
  assert.equal(result.arbitraryExecutableAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.gitMutationAllowed, false);
  assert.equal(result.pcRestartAllowed, false);
  assert.equal(result.publicExposureChanged, false);
  const powerShellCalls = spawnSyncFn.calls.filter((call) => call.command.includes('WindowsPowerShell'));
  assert.equal(powerShellCalls.length, 5);
  assert.deepEqual(powerShellCalls.map((call) => call.args.slice(-1)), [['-StartNow'], ['-StartNow'], ['-StartNow'], ['-StartNow'], ['-StartNow']]);
  assert.equal(powerShellCalls.every((call) => call.options.shell === false), true);
  assert.equal(powerShellCalls[0].args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1')), true);
  assert.equal(powerShellCalls[1].args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-mesh.ps1')), true);
  assert.equal(powerShellCalls[2].args.some((arg) => String(arg).endsWith('install-battle-bridge-worker-watchdog.ps1')), true);
  assert.equal(powerShellCalls[3].args.some((arg) => String(arg).endsWith('install-battle-bridge-github-command-mailbox.ps1')), true);
  assert.equal(powerShellCalls[4].args.some((arg) => String(arg).endsWith('install-battle-bridge-outbound-health-beacon.ps1')), true);
});

test('Lifeboat is attempted before an in-band Recovery Mesh failure can stop reconciliation', () => {
  const spawnSyncFn = scriptedSpawn({ recovery: { ...recoveryReceipt(), startedNow: false } });
  const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID');
  assert.equal(result.failedTaskId, 'recoveryMesh');
  const powerShellCalls = spawnSyncFn.calls.filter((call) => call.command.includes('WindowsPowerShell'));
  assert.equal(powerShellCalls.length, 2);
  assert.equal(powerShellCalls[0].args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1')), true);
  assert.equal(powerShellCalls[1].args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-mesh.ps1')), true);
});

test('control-plane repair blocks stale or real source dirt before any task mutation', () => {
  for (const fixture of [
    { head: 'b'.repeat(40), expected: 'CONTROL_PLANE_SOURCE_HEAD_MISMATCH' },
    { status: ' M shared/agents/example.mjs\n', expected: 'CONTROL_PLANE_SOURCE_DIRT_BLOCKED' },
    { status: '?? scripts/unreviewed-helper.mjs\n', expected: 'CONTROL_PLANE_SOURCE_DIRT_BLOCKED' },
  ]) {
    const spawnSyncFn = scriptedSpawn(fixture);
    const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, fixture.expected);
    assert.equal(spawnSyncFn.calls.some((call) => call.command.includes('WindowsPowerShell')), false);
  }
});

test('control-plane repair fails closed on invalid Lifeboat installer receipt', () => {
  const spawnSyncFn = scriptedSpawn({ lifeboat: { ...lifeboatReceipt(), windowlessLauncher: false } });
  const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID');
  assert.equal(result.failedTaskId, 'recoveryLifeboat');
  assert.equal(spawnSyncFn.calls.filter((call) => call.command.includes('WindowsPowerShell')).length, 1);
});

test('control-plane repair fails closed on invalid worker watchdog installer receipt', () => {
  const spawnSyncFn = scriptedSpawn({ workerWatchdog: { ...workerWatchdogReceipt(), startedNow: false } });
  const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID');
  assert.equal(result.failedTaskId, 'workerWatchdog');
});

test('control-plane repair fails closed on invalid beacon installer receipt', () => {
  const spawnSyncFn = scriptedSpawn({ beacon: { ...beaconReceipt(), issueNumber: 1507 } });
  const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID');
  assert.equal(result.failedTaskId, 'outboundHealthBeacon');
});

test('Recovery Mesh hidden launcher emits bounded terminal liveness and fails closed on nonzero runner results', async () => {
  const source = await readFile(new URL('./windows/run-battle-bridge-recovery-mesh-hidden.ps1', import.meta.url), 'utf8');

  assert.match(source, /battle-bridge-recovery-mesh-launch-current\.json/);
  assert.match(source, /stephanos\.battle-bridge-recovery-mesh-launch\.v1/);
  for (const classification of [
    'RECOVERY_MESH_HIDDEN_WRAPPER_STARTED',
    'RECOVERY_MESH_MUTEX_BUSY',
    'RECOVERY_MESH_STALE_LOCK_RECLAIM_FAILED',
    'RECOVERY_MESH_RUNNER_STARTING',
    'RECOVERY_MESH_RUNNER_COMPLETED',
    'RECOVERY_MESH_RUNNER_FAILED',
    'RECOVERY_MESH_HIDDEN_WRAPPER_FAILED',
  ]) assert.match(source, new RegExp(classification));

  assert.match(source, /runnerResultParsed/);
  assert.match(source, /runnerClassification/);
  assert.match(source, /\$runnerOutput = @\(& \$nodeExecutable \$runnerPath 2>&1\)/);
  assert.match(source, /\$runnerResultParsed = \$null -ne \$runnerResult/);
  assert.match(source, /if \(\$runnerResultParsed -and \$runnerExitCode -eq 0\)/);
  assert.match(source, /-Classification 'RECOVERY_MESH_RUNNER_FAILED'[\s\S]*?-RunnerResultParsed \$runnerResultParsed[\s\S]*?-RunnerClassification \$runnerClassification/);
  assert.doesNotMatch(source, /\$nodeExecutable \$runnerPath \*> \$null/);

  assert.match(source, /System\.Threading\.Mutex/);
  assert.match(source, /STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'/);
  assert.match(source, /Get-RecoveryLockPathBaseline/);
  assert.match(source, /Assert-RecoveryLockPathBaseline/);
  assert.match(source, /OpenVerifiedForDelete/);
  assert.match(source, /DeleteByHandle/);
  assert.match(source, /RECOVERY_LOCK_MULTIPLE_LINKS_REJECTED/);

  assert.match(source, /visiblePowerShellRequired = \$false/);
  assert.match(source, /arbitraryShellAllowed = \$false/);
  assert.match(source, /arbitraryPowerShellAllowed = \$false/);
  assert.match(source, /sourceMutationAllowed = \$false/);
  assert.match(source, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(source, /["']-Command["']|Invoke-Expression|Start-Process|Restart-Computer|git\s+(?:reset|clean|checkout|switch|push)/i);
});

test('control-plane repair source exposes no caller-selected task, executable, installer or shell surface', async () => {
  const source = await readFile(new URL('../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /shell: false/);
  assert.match(source, /classifyDirt/);
  assert.match(source, /install-battle-bridge-recovery-lifeboat-v1\.ps1/);
  assert.match(source, /install-battle-bridge-recovery-mesh\.ps1/);
  assert.match(source, /install-battle-bridge-worker-watchdog\.ps1/);
  assert.match(source, /install-battle-bridge-github-command-mailbox\.ps1/);
  assert.match(source, /install-battle-bridge-outbound-health-beacon\.ps1/);
  assert.doesNotMatch(source, /taskName\s*=\s*options|installerRelativePath\s*=\s*options|executable\s*=\s*options|shell\s*=\s*true/);
  assert.doesNotMatch(source, /Invoke-Expression|reset --hard|git clean|git stash|git checkout|git push|Restart-Computer/i);
});
