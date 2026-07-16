import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBattleBridgeDiagnostics,
  syncCodexDispatchBridge,
} from './codexDispatchHostOps.mjs';

function scriptedSpawn(script) {
  const calls = [];
  const queues = new Map(Object.entries(script).map(([key, values]) => [key, Array.isArray(values) ? [...values] : [values]]));
  const spawn = (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    calls.push(key);
    const queue = queues.get(key);
    if (!queue?.length) throw new Error(`Unexpected command: ${key}`);
    const value = queue.shift();
    return {
      status: value.status ?? 0,
      stdout: value.stdout ?? '',
      stderr: value.stderr ?? '',
      signal: value.signal ?? null,
      error: value.error,
    };
  };
  spawn.calls = calls;
  return spawn;
}

test('sync bridge fast-forwards main and runs tests without PowerShell or destructive cleanup', () => {
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': [{ stdout: 'old-head\n' }, { stdout: 'new-head\n' }],
    'git status --porcelain=v1 --untracked-files=all': [
      { stdout: ' M stephanos-server/data/memory/durable-memory.json\n' },
      { stdout: ' M stephanos-server/data/memory/durable-memory.json\n' },
    ],
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'new-head\n' },
    'git rev-list --left-right --count HEAD...origin/main': { stdout: '0\t1\n' },
    'git merge --ff-only origin/main': { stdout: 'Updating old-head..new-head\nFast-forward\n' },
    'git diff --name-only old-head..new-head': { stdout: 'scripts/stephanos-codex-dispatch-worker.mjs\n' },
    'npm.cmd run stephanos:codex-dispatch:test': { stdout: 'tests 22\npass 22\nfail 0\n' },
  });

  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    platform: 'win32',
    spawnSyncFn,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.beforeHead, 'old-head');
  assert.equal(result.afterHead, 'new-head');
  assert.equal(result.updated, true);
  assert.equal(result.preExistingDirt, true);
  assert.equal(result.restartRequired, false);
  assert.equal(result.destructiveCleanupPerformed, false);
  assert.equal(spawnSyncFn.calls.some((call) => /powershell/i.test(call)), false);
  assert.equal(spawnSyncFn.calls.some((call) => /reset|clean|stash|checkout/i.test(call)), false);
});

test('sync bridge blocks local commits or divergence instead of forcing main', () => {
  const spawnSyncFn = scriptedSpawn({
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': { stdout: 'local-head\n' },
    'git status --porcelain=v1 --untracked-files=all': { stdout: '' },
    'git fetch origin main': { stdout: '' },
    'git rev-parse origin/main': { stdout: 'remote-head\n' },
    'git rev-list --left-right --count HEAD...origin/main': { stdout: '1\t2\n' },
  });

  const result = syncCodexDispatchBridge({
    repoRoot: 'C:\\repo',
    operatorApproval: 'operator-approved',
    expectedBranch: 'main',
    platform: 'win32',
    spawnSyncFn,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE');
  assert.equal(spawnSyncFn.calls.some((call) => call.includes('merge --ff-only')), false);
});

test('sync bridge refuses to mutate without explicit operator approval', () => {
  const result = syncCodexDispatchBridge({ operatorApproval: '' });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPERATOR_APPROVAL_REQUIRED');
});

test('direct diagnostics collect Git and localhost health without a Codex child', async () => {
  const spawnSyncFn = scriptedSpawn({
    'git rev-parse --show-toplevel': { stdout: 'C:\\repo\n' },
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse HEAD': { stdout: 'abc123\n' },
    'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { stdout: 'origin/main\n' },
    'git status --branch --untracked-files=all': { stdout: 'On branch main\nYour branch is up to date with origin/main.\n' },
    'git rev-list --left-right --count HEAD...@{upstream}': { stdout: '0\t0\n' },
  });
  const fetchFn = async (url) => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ ok: true, url }); },
  });

  const result = await runBattleBridgeDiagnostics({
    repoRoot: 'C:\\repo',
    endpoints: ['http://127.0.0.1:4173/health', 'http://127.0.0.1:8787/health'],
    spawnSyncFn,
    fetchFn,
  });

  assert.equal(result.status, 'DONE');
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.fullHead, 'abc123');
  assert.equal(result.ahead, 0);
  assert.equal(result.behind, 0);
  assert.equal(result.health.length, 2);
  assert.equal(result.execution.codexChildUsed, false);
  assert.equal(result.execution.shellPolicyDependency, false);
  assert.equal(result.safety.sourceMutationDetected, false);
});
