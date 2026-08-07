import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BATTLE_BRIDGE_GITHUB_SYNC_HEALTHY,
  BATTLE_BRIDGE_GITHUB_SYNC_REPAIRED,
  BATTLE_BRIDGE_GITHUB_SYNC_TASK,
  reconcileBattleBridgeGitHubSyncTask,
} from './battleBridgeGitHubSyncSelfRepairV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-08-07T12:50:00.000Z');

function statusReceipt(overrides = {}) {
  return {
    taskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK,
    installed: true,
    taskState: 'Ready',
    lastRunTime: '2026-08-07T12:40:00.000Z',
    lastTaskResult: 0,
    nextRunTime: '2026-08-07T12:55:00.000Z',
    statusPresent: true,
    syncStatus: { status: 'SYNC_NO_CHANGE' },
    liveOpenClawUpdateAllowed: false,
    ...overrides,
  };
}

function installReceipt(overrides = {}) {
  return {
    taskName: BATTLE_BRIDGE_GITHUB_SYNC_TASK,
    installed: true,
    intervalMinutes: 15,
    atLogon: true,
    hidden: true,
    runLevel: 'Limited',
    startedNow: true,
    arbitraryShellAllowed: false,
    liveOpenClawUpdateAllowed: false,
    headlessLauncher: true,
    ...overrides,
  };
}

function scriptedSpawn({ status = statusReceipt(), install = installReceipt(), sourceStatus = '' } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (args.includes('branch') && args.includes('--show-current')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse') && args.includes('HEAD')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status') && args.includes('--porcelain=v1')) return { status: 0, stdout: sourceStatus, stderr: '' };
    if (args.some((arg) => String(arg).endsWith('status-battle-bridge-github-sync.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(status, null, 2)}\n`, stderr: '' };
    }
    if (args.some((arg) => String(arg).endsWith('install-battle-bridge-github-sync.ps1'))) {
      return { status: 0, stdout: `${JSON.stringify(install, null, 2)}\n`, stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

const safeLstat = () => ({ isFile: () => true, isSymbolicLink: () => false, nlink: 1 });

function run(options = {}) {
  return reconcileBattleBridgeGitHubSyncTask({
    repoRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
    expectedHead: HEAD,
    platform: 'win32',
    now: NOW,
    lstatFn: safeLstat,
    ...options,
  });
}

test('healthy canonical GitHub Sync task is inspected without mutation or Codex', () => {
  const spawnSyncFn = scriptedSpawn();
  const result = run({ spawnSyncFn });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, BATTLE_BRIDGE_GITHUB_SYNC_HEALTHY);
  assert.equal(result.taskHealthy, true);
  assert.equal(result.repairAttempted, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.codexRequired, false);
  assert.equal(spawnSyncFn.calls.filter((call) => call.args.includes('-StartNow')).length, 0);
  assert.equal(spawnSyncFn.calls.every((call) => call.options.shell === false), true);
});

test('missing, failed or stale GitHub Sync task is repaired only through the fixed installer', () => {
  for (const status of [
    statusReceipt({ installed: false, taskState: 'Missing', lastRunTime: null, lastTaskResult: null }),
    statusReceipt({ taskState: 'Ready', lastTaskResult: 1 }),
    statusReceipt({ taskState: 'Ready', lastRunTime: '2026-08-07T11:00:00.000Z', lastTaskResult: 0 }),
  ]) {
    const spawnSyncFn = scriptedSpawn({ status });
    const result = run({ spawnSyncFn });
    assert.equal(result.ok, true);
    assert.equal(result.finalVerdict, BATTLE_BRIDGE_GITHUB_SYNC_REPAIRED);
    assert.equal(result.repairAttempted, true);
    assert.equal(result.mutationPerformed, true);
    assert.equal(result.mutationScope, 'canonical-scheduled-task-registration-and-start-only');
    const installerCalls = spawnSyncFn.calls.filter((call) => call.args.some((arg) => String(arg).endsWith('install-battle-bridge-github-sync.ps1')));
    assert.equal(installerCalls.length, 1);
    assert.deepEqual(installerCalls[0].args.slice(-1), ['-StartNow']);
    assert.equal(installerCalls[0].options.shell, false);
  }
});

test('source identity or real source dirt blocks before any scheduled-task mutation', () => {
  for (const fixture of [
    { expectedHead: 'b'.repeat(40), sourceStatus: '', blocker: 'GITHUB_SYNC_SELF_REPAIR_SOURCE_HEAD_MISMATCH' },
    { expectedHead: HEAD, sourceStatus: ' M shared/agents/example.mjs\n', blocker: 'GITHUB_SYNC_SELF_REPAIR_SOURCE_DIRT_BLOCKED' },
    { expectedHead: HEAD, sourceStatus: '?? scripts/unreviewed-helper.mjs\n', blocker: 'GITHUB_SYNC_SELF_REPAIR_SOURCE_DIRT_BLOCKED' },
  ]) {
    const spawnSyncFn = scriptedSpawn({ sourceStatus: fixture.sourceStatus });
    const result = run({ expectedHead: fixture.expectedHead, spawnSyncFn });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, fixture.blocker);
    assert.equal(spawnSyncFn.calls.some((call) => call.args.includes('-StartNow')), false);
  }
});

test('runtime-only dirt stays non-blocking but an invalid installer receipt fails closed', () => {
  const spawnSyncFn = scriptedSpawn({
    sourceStatus: ' M apps/stephanos/dist/index.html\n?? logs/runtime-probe.json\n',
    status: statusReceipt({ installed: false, taskState: 'Missing', lastRunTime: null, lastTaskResult: null }),
    install: installReceipt({ startedNow: false }),
  });
  const result = run({ spawnSyncFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'GITHUB_SYNC_SELF_REPAIR_INSTALLER_RECEIPT_INVALID');
  assert.equal(result.sourceDirtSafe, true);
  assert.equal(result.repairAttempted, true);
});

test('self-repair source exposes no caller-selected task, executable, installer, shell or Codex dependency', async () => {
  const source = await readFile(new URL('./battleBridgeGitHubSyncSelfRepairV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /status-battle-bridge-github-sync\.ps1/);
  assert.match(source, /install-battle-bridge-github-sync\.ps1/);
  assert.match(source, /shell: false/);
  assert.match(source, /codexRequired: false/);
  assert.doesNotMatch(source, /taskName\s*=\s*options|installer\w*\s*=\s*options|executable\s*=\s*options|shell\s*=\s*true/);
  assert.doesNotMatch(source, /reset --hard|git clean|git stash|git rebase|git push|Restart-Computer|Invoke-Expression/i);
});
