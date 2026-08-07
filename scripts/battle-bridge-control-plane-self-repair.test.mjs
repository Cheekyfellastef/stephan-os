import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BATTLE_BRIDGE_CONTROL_PLANE_TASKS,
  reconcileBattleBridgeControlPlane,
} from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';

const HEAD = 'a'.repeat(40);

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

function scriptedSpawn({ head = HEAD, status = '', recovery = recoveryReceipt(), mailbox = mailboxReceipt() } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${head}\n`, stderr: '' };
    if (args.includes('status') && args.includes('--porcelain=v1')) return { status: 0, stdout: status, stderr: '' };
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-mesh.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(recovery, null, 2)}\n`, stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-github-command-mailbox.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(mailbox, null, 2)}\n`, stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

test('control-plane repair is fixed to exactly the existing recovery mesh and mailbox installers', () => {
  assert.deepEqual(BATTLE_BRIDGE_CONTROL_PLANE_TASKS.map(({ id, taskName, installerRelativePath }) => ({ id, taskName, installerRelativePath })), [
    {
      id: 'recoveryMesh',
      taskName: 'Stephanos Battle Bridge Recovery Mesh',
      installerRelativePath: 'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    },
    {
      id: 'githubCommandMailbox',
      taskName: 'Stephanos Battle Bridge GitHub Command Mailbox',
      installerRelativePath: 'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
    },
  ]);
});

test('control-plane repair proves exact main and safe source dirt before starting fixed installers', () => {
  const spawnSyncFn = scriptedSpawn({ status: ' M apps/stephanos/dist/index.html\n?? logs/runtime-probe.json\n' });
  const result = reconcileBattleBridgeControlPlane({
    repoRoot: '/repo',
    expectedHead: HEAD,
    platform: 'win32',
    spawnSyncFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.sourceDirtSafe, true);
  assert.equal(result.runtimeOnlyDirtCount, 2);
  assert.equal(result.dirtSummary.blocksSync, false);
  assert.equal(result.taskCount, 2);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED');
  assert.equal(result.arbitraryTaskNameAllowed, false);
  assert.equal(result.arbitraryExecutableAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.gitMutationAllowed, false);
  assert.equal(result.pcRestartAllowed, false);
  assert.equal(result.publicExposureChanged, false);

  const powerShellCalls = spawnSyncFn.calls.filter((call) => call.command.includes('WindowsPowerShell'));
  assert.equal(powerShellCalls.length, 2);
  assert.deepEqual(powerShellCalls.map((call) => call.args.slice(-1)), [['-StartNow'], ['-StartNow']]);
  assert.equal(powerShellCalls.every((call) => call.options.shell === false), true);
  assert.equal(powerShellCalls[0].args.some((arg) => String(arg).endsWith('install-battle-bridge-recovery-mesh.ps1')), true);
  assert.equal(powerShellCalls[1].args.some((arg) => String(arg).endsWith('install-battle-bridge-github-command-mailbox.ps1')), true);
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

test('control-plane repair fails closed on an invalid installer receipt', () => {
  const spawnSyncFn = scriptedSpawn({ recovery: { ...recoveryReceipt(), startedNow: false } });
  const result = reconcileBattleBridgeControlPlane({ repoRoot: '/repo', expectedHead: HEAD, platform: 'win32', spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_RECEIPT_INVALID');
  assert.equal(result.failedTaskId, 'recoveryMesh');
});

test('control-plane repair source exposes no caller-selected task, executable, installer or shell surface', async () => {
  const source = await readFile(new URL('../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /shell: false/);
  assert.match(source, /classifyDirt/);
  assert.match(source, /install-battle-bridge-recovery-mesh\.ps1/);
  assert.match(source, /install-battle-bridge-github-command-mailbox\.ps1/);
  assert.doesNotMatch(source, /taskName\s*=\s*options|installerRelativePath\s*=\s*options|executable\s*=\s*options|shell\s*=\s*true/);
  assert.doesNotMatch(source, /Invoke-Expression|reset --hard|git clean|git stash|git checkout|git push|Restart-Computer/i);
});
