import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyFixedInstallerFailure,
  reconcileBattleBridgeControlPlane,
} from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';

const HEAD = 'a'.repeat(40);
const GENERIC = 'CONTROL_PLANE_FIXED_INSTALLER_FAILED';

const receipts = Object.freeze({
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

function fixedSpawn({ lifeboatStderr = 'bounded simulated installer failure' } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status') && args.includes('--porcelain=v1')) return { status: 0, stdout: '', stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1'))) {
      return { status: 1, stdout: '', stderr: lifeboatStderr };
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
