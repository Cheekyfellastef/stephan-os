import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyFixedInstallerFailure,
  reconcileBattleBridgeControlPlane,
} from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';

const HEAD = 'a'.repeat(40);
const GENERIC = 'CONTROL_PLANE_FIXED_INSTALLER_FAILED';
const ACTIVE_MISMATCH = 'Installed immutable lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.';
const WINDOWLESS_MISMATCH = 'Installed immutable windowless lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.';
const ACTIVE_MISSING = 'Existing lifeboat active state requires the immutable active-bank launcher to already be installed.';
const WINDOWLESS_MISSING = 'Existing lifeboat active state requires the immutable windowless launcher to already be installed.';
const ACTIVE_BLOB = '914d6f390e6288bea8911db1dac7de03af661826';
const WINDOWLESS_BLOB = 'c724540a727aab7881dd3b06b52aa7cf9d86f7d8';
const ACTIVE_SOURCE = `[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
if (-not (Test-Path -LiteralPath $powershellExe -PathType Leaf)) { throw 'Canonical Windows PowerShell host is missing.' }
$lifeboatRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$statePath = Join-Path $lifeboatRoot 'state\\active-bank.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'Active lifeboat bank state is missing.' }

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ([string]$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1') { throw 'Active lifeboat bank schema is invalid.' }
$bankId = [string]$state.activeBank
if ($bankId -notin @('A', 'B')) { throw 'Active lifeboat bank identity is invalid.' }
if ([string]$state.selfTestVerdict -ne 'PASS') { throw 'Active lifeboat bank is not self-test proven.' }
if ([string]$state.manifestSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Active lifeboat bank manifest identity is invalid.' }

$bankRoot = Join-Path $lifeboatRoot "banks\\$bankId"
$runnerPath = Join-Path $bankRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1'
$manifestPath = Join-Path $bankRoot 'manifest.sha256'
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw 'Active lifeboat bank runner is missing.' }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Active lifeboat bank manifest is missing.' }
$manifest = (Get-Content -LiteralPath $manifestPath -Raw).Trim().ToLowerInvariant()
if ($manifest -ne [string]$state.manifestSha256) { throw 'Active lifeboat bank manifest does not match active-bank metadata.' }

& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $runnerPath
exit $LASTEXITCODE
`;
const WINDOWLESS_SOURCE = [
  'Option Explicit',
  '',
  'Dim shell',
  'Dim localAppData',
  'Dim systemRoot',
  'Dim powerShell',
  'Dim launcher',
  'Dim command',
  'Dim exitCode',
  '',
  'Set shell = CreateObject("WScript.Shell")',
  '',
  'localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")',
  'systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")',
  '',
  'powerShell = systemRoot & "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
  'launcher = localAppData & "\\Stephanos\\BattleBridgeRecoveryLifeboat\\run-battle-bridge-recovery-lifeboat-active-v1.ps1"',
  '',
  'command = """" & powerShell & """ -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & launcher & """"',
  'exitCode = shell.Run(command, 0, True)',
  '',
  'WScript.Quit exitCode',
  '',
].join('\n');

const receipts = Object.freeze({
  recoveryLifeboat: Object.freeze({
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
  }),
  recoveryMesh: Object.freeze({
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
  }),
  workerWatchdog: Object.freeze({
    taskName: 'Stephanos Mission Orchestrator Worker Watchdog',
    installed: true,
    startedNow: true,
    intervalMinutes: 1,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    multipleInstances: 'IgnoreNew',
    remoteCodexVisibilityReconciler: true,
    arbitraryTaskNameAllowed: false,
    arbitraryShellAllowed: false,
    visiblePowerShellRequired: false,
    headlessLauncher: true,
  }),
  githubCommandMailbox: Object.freeze({
    taskName: 'Stephanos Battle Bridge GitHub Command Mailbox',
    installed: true,
    startedNow: true,
    receiptIndexEnabled: true,
    intervalMinutes: 5,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
    headlessLauncher: true,
  }),
  outboundHealthBeacon: Object.freeze({
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
  }),
});

function fixedSpawn({
  lifeboatStderr = 'bounded simulated installer failure',
  lifeboatFailures = null,
  sourceBlobOverrides = {},
} = {}) {
  const calls = [];
  const failures = Array.isArray(lifeboatFailures) ? [...lifeboatFailures] : [lifeboatStderr];
  let lifeboatAttempt = 0;
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('rev-parse') && args.some((arg) => String(arg).startsWith('HEAD:'))) {
      const sourcePath = String(args.find((arg) => String(arg).startsWith('HEAD:'))).slice(5);
      const defaultBlob = sourcePath.endsWith('run-battle-bridge-recovery-lifeboat-active-v1.ps1')
        ? ACTIVE_BLOB
        : sourcePath.endsWith('run-battle-bridge-recovery-lifeboat-windowless-v2.vbs')
          ? WINDOWLESS_BLOB
          : '';
      return { status: defaultBlob ? 0 : 1, stdout: `${sourceBlobOverrides[sourcePath] || defaultBlob}\n`, stderr: '' };
    }
    if (args.includes('cat-file') && args.includes('blob')) {
      const blob = String(args.at(-1));
      if (blob === ACTIVE_BLOB) return { status: 0, stdout: ACTIVE_SOURCE, stderr: '' };
      if (blob === WINDOWLESS_BLOB) return { status: 0, stdout: WINDOWLESS_SOURCE, stderr: '' };
      return { status: 1, stdout: '', stderr: 'unknown fixed blob' };
    }
    if (args.includes('status') && args.includes('--porcelain=v1')) return { status: 0, stdout: '', stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1'))) {
      const failure = failures[lifeboatAttempt];
      lifeboatAttempt += 1;
      if (failure) return { status: 1, stdout: '', stderr: failure };
      return { status: 0, stdout: `${JSON.stringify(receipts.recoveryLifeboat)}\n`, stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-mesh.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(receipts.recoveryMesh)}\n`, stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-worker-watchdog.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(receipts.workerWatchdog)}\n`, stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-github-command-mailbox.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(receipts.githubCommandMailbox)}\n`, stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-outbound-health-beacon.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(receipts.outboundHealthBeacon)}\n`, stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

test('known Lifeboat installer failures collapse to closed-world diagnostic codes only', () => {
  const cases = [
    [
      'Installed immutable lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.',
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_ACTIVE_LAUNCHER_MISMATCH',
    ],
    [
      'Installed immutable windowless lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.',
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_WINDOWLESS_LAUNCHER_MISMATCH',
    ],
    [
      ACTIVE_MISSING,
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_ACTIVE_LAUNCHER_MISSING',
    ],
    [
      WINDOWLESS_MISSING,
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_WINDOWLESS_LAUNCHER_MISSING',
    ],
    [
      'Lifeboat bank A active manifest file does not match active state.',
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_ACTIVE_MANIFEST_MISMATCH',
    ],
    [
      'Lifeboat bank B heartbeat manifest mismatch.',
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_HEARTBEAT_MANIFEST_MISMATCH',
    ],
    [
      'Existing lifeboat scheduled task arguments are not canonical.',
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_TASK_ARGUMENTS_INVALID',
    ],
    [
      'Candidate lifeboat bank failed its installed-bank self-test: secret-looking-runtime-detail',
      'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_CANDIDATE_SELF_TEST_FAILED',
    ],
  ];

  for (const [stderr, expected] of cases) {
    const blocker = classifyFixedInstallerFailure('recoveryLifeboat', stderr);
    assert.equal(blocker, expected);
    assert.doesNotMatch(blocker, /secret-looking-runtime-detail/i);
    assert.doesNotMatch(blocker, /[\\/]/);
  }
});

test('unknown and non-Lifeboat installer failures stay generic and do not echo stderr', () => {
  const sensitive = 'unexpected failure C:\\Users\\operator\\token-secret-value';
  assert.equal(classifyFixedInstallerFailure('recoveryLifeboat', sensitive), GENERIC);
  assert.equal(classifyFixedInstallerFailure('recoveryMesh', 'heartbeat manifest mismatch. token-secret-value'), GENERIC);
  assert.doesNotMatch(classifyFixedInstallerFailure('recoveryLifeboat', sensitive), /token-secret-value|Users/i);
});

test('fixed installer process failure stays blocking while later independent fixed repairs continue', () => {
  const spawnSyncFn = fixedSpawn();
  const result = reconcileBattleBridgeControlPlane({
    repoRoot: '/repo',
    expectedHead: HEAD,
    platform: 'win32',
    spawnSyncFn,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, GENERIC);
  assert.equal(result.failedTaskId, 'recoveryLifeboat');
  assert.deepEqual(result.failedTaskIds, ['recoveryLifeboat']);
  assert.equal(result.installerFailureCount, 1);
  assert.equal(result.workConservingRepairAttempted, true);
  assert.equal(result.independentFixedRepairContinued, true);
  assert.equal(result.taskCount, 5);
  assert.equal(result.tasks[0].id, 'recoveryLifeboat');
  assert.equal(result.tasks[0].installed, false);
  assert.equal(result.tasks[0].installerExitOk, false);
  assert.deepEqual(result.tasks.slice(1).map((task) => [task.id, task.installed, task.receiptValid]), [
    ['recoveryMesh', true, true],
    ['workerWatchdog', true, true],
    ['githubCommandMailbox', true, true],
    ['outboundHealthBeacon', true, true],
  ]);

  const powerShellCalls = spawnSyncFn.calls.filter((call) => call.command.includes('WindowsPowerShell'));
  assert.equal(powerShellCalls.length, 5);
  assert.equal(powerShellCalls[3].args.some((arg) => String(arg).endsWith('install-battle-bridge-github-command-mailbox.ps1')), true);

  assert.equal(result.arbitraryTaskNameAllowed, false);
  assert.equal(result.arbitraryExecutableAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.gitMutationAllowed, false);
  assert.equal(result.pcRestartAllowed, false);
  assert.equal(result.publicExposureChanged, false);
});

test('recognized Lifeboat failure becomes remote-safe blocker while work-conserving sweep continues', () => {
  const secret = 'SECRET_SHOULD_NOT_ESCAPE';
  const spawnSyncFn = fixedSpawn({
    lifeboatStderr: `Candidate lifeboat bank failed its installed-bank self-test: ${secret}`,
  });
  const result = reconcileBattleBridgeControlPlane({
    repoRoot: '/repo',
    expectedHead: HEAD,
    platform: 'win32',
    spawnSyncFn,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_CANDIDATE_SELF_TEST_FAILED');
  assert.equal(result.failedTaskId, 'recoveryLifeboat');
  assert.equal(result.taskCount, 5);
  assert.deepEqual(result.tasks.slice(1).map((task) => task.installed), [true, true, true, true]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.gitMutationAllowed, false);
  assert.equal(result.pcRestartAllowed, false);
});

test('exact pinned active and windowless launcher drift is restored once each before installer retry', () => {
  const previous = process.env.LOCALAPPDATA;
  const localAppData = mkdtempSync(join(tmpdir(), 'stephanos-lifeboat-'));
  process.env.LOCALAPPDATA = localAppData;
  try {
    const spawnSyncFn = fixedSpawn({
      lifeboatFailures: [ACTIVE_MISMATCH, WINDOWLESS_MISMATCH],
    });
    const result = reconcileBattleBridgeControlPlane({
      repoRoot: '/repo',
      expectedHead: HEAD,
      platform: 'win32',
      spawnSyncFn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.tasks[0].installed, true);
    assert.equal(result.tasks[0].pinnedLauncherRestoreAttemptCount, 2);
    assert.deepEqual(result.tasks[0].restoredLauncherKinds, ['ACTIVE', 'WINDOWLESS']);
    assert.equal(
      readFileSync(join(localAppData, 'Stephanos', 'BattleBridgeRecoveryLifeboat', 'run-battle-bridge-recovery-lifeboat-active-v1.ps1'), 'utf8'),
      ACTIVE_SOURCE,
    );
    assert.equal(
      readFileSync(join(localAppData, 'Stephanos', 'BattleBridgeRecoveryLifeboat', 'run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'), 'utf8'),
      WINDOWLESS_SOURCE,
    );

    const lifeboatInstallerCalls = spawnSyncFn.calls.filter((call) =>
      call.args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1')));
    assert.equal(lifeboatInstallerCalls.length, 3);
    assert.equal(result.arbitraryShellAllowed, false);
    assert.equal(result.sourceMutationAllowed, false);
    assert.equal(result.gitMutationAllowed, false);
    assert.equal(result.pcRestartAllowed, false);
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    rmSync(localAppData, { recursive: true, force: true });
  }
});

test('missing pinned active and windowless launchers are restored through the same reviewed exact-blob path', () => {
  const previous = process.env.LOCALAPPDATA;
  const localAppData = mkdtempSync(join(tmpdir(), 'stephanos-lifeboat-'));
  process.env.LOCALAPPDATA = localAppData;
  try {
    const spawnSyncFn = fixedSpawn({
      lifeboatFailures: [ACTIVE_MISSING, WINDOWLESS_MISSING],
    });
    const result = reconcileBattleBridgeControlPlane({
      repoRoot: '/repo',
      expectedHead: HEAD,
      platform: 'win32',
      spawnSyncFn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.tasks[0].installed, true);
    assert.equal(result.tasks[0].pinnedLauncherRestoreAttemptCount, 2);
    assert.deepEqual(result.tasks[0].restoredLauncherKinds, ['ACTIVE', 'WINDOWLESS']);
    assert.equal(
      readFileSync(join(localAppData, 'Stephanos', 'BattleBridgeRecoveryLifeboat', 'run-battle-bridge-recovery-lifeboat-active-v1.ps1'), 'utf8'),
      ACTIVE_SOURCE,
    );
    assert.equal(
      readFileSync(join(localAppData, 'Stephanos', 'BattleBridgeRecoveryLifeboat', 'run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'), 'utf8'),
      WINDOWLESS_SOURCE,
    );

    const lifeboatInstallerCalls = spawnSyncFn.calls.filter((call) =>
      call.args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1')));
    assert.equal(lifeboatInstallerCalls.length, 3);
    assert.equal(result.arbitraryShellAllowed, false);
    assert.equal(result.sourceMutationAllowed, false);
    assert.equal(result.gitMutationAllowed, false);
    assert.equal(result.pcRestartAllowed, false);
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    rmSync(localAppData, { recursive: true, force: true });
  }
});

test('launcher restore fails closed when current HEAD no longer resolves to the pinned reviewed blob', () => {
  const previous = process.env.LOCALAPPDATA;
  const localAppData = mkdtempSync(join(tmpdir(), 'stephanos-lifeboat-'));
  process.env.LOCALAPPDATA = localAppData;
  try {
    const sourcePath = 'scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1';
    const spawnSyncFn = fixedSpawn({
      lifeboatFailures: [ACTIVE_MISMATCH],
      sourceBlobOverrides: { [sourcePath]: 'b'.repeat(40) },
    });
    const result = reconcileBattleBridgeControlPlane({
      repoRoot: '/repo',
      expectedHead: HEAD,
      platform: 'win32',
      spawnSyncFn,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED_LIFEBOAT_IMMUTABLE_ACTIVE_LAUNCHER_MISMATCH');
    assert.equal(result.tasks[0].pinnedLauncherRestoreAttemptCount, 1);
    assert.deepEqual(result.tasks[0].restoredLauncherKinds, []);
    assert.deepEqual(result.tasks.slice(1).map((task) => task.installed), [true, true, true, true]);
    assert.equal(result.arbitraryShellAllowed, false);
    assert.equal(result.sourceMutationAllowed, false);
    assert.equal(result.gitMutationAllowed, false);
    assert.equal(result.pcRestartAllowed, false);
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    rmSync(localAppData, { recursive: true, force: true });
  }
});
