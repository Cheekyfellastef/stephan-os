import assert from 'node:assert/strict';
import test from 'node:test';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  createBattleBridgeExactHeadSpawnGuard,
  syncBattleBridgeExactHeadV1,
} from './battleBridgeExactHeadSyncGuardV1.mjs';
import { CODEX_DISPATCH_TEST_ARGS } from './codexDispatchHostOps.mjs';
import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
} from './battleBridgeExecutionBoundaryV1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const STATUS = ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'];
const FETCH = ['fetch', '--prune', 'origin', 'main:refs/remotes/origin/main'];
const CONFIG = `core.repositoryformatversion\n0\0remote.origin.url\n${BATTLE_BRIDGE_CANONICAL_REMOTE_URL}\0remote.origin.fetch\n+refs/heads/main:refs/remotes/origin/main\0`;

function successSpawn(stdout = '') {
  return { status: 0, signal: null, stdout, stderr: '' };
}

function securedSpawn(spawnFn = () => successSpawn()) {
  return (command, args, options) => {
    const tail = command === BATTLE_BRIDGE_WINDOWS_HOST.git
      ? args.slice(BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length)
      : args;
    if (tail[0] === 'config') return successSpawn(CONFIG);
    if (tail[0] === 'for-each-ref') return successSpawn();
    const logical = tail[0] === 'fetch' && tail[2] === BATTLE_BRIDGE_CANONICAL_REMOTE_URL
      ? ['fetch', '--prune', 'origin', tail[3]]
      : tail;
    return spawnFn(command, logical, options);
  };
}

function createGuard(options) {
  return createBattleBridgeExactHeadSpawnGuard({ ...options, spawnSyncFn: securedSpawn(options.spawnSyncFn) });
}

function syncGuarded(options) {
  return syncBattleBridgeExactHeadV1({ ...options, spawnSyncFn: securedSpawn(options.spawnSyncFn) });
}

test('exact-head guard rejects malformed approval and injected Node identity before process calls', () => {
  let calls = 0;
  assert.equal(createGuard({
    expectedHead: 'main',
    spawnSyncFn: () => { calls += 1; return successSpawn(); },
  }).blocker, 'EXPECTED_HEAD_INVALID');
  assert.equal(createGuard({
    expectedHead: HEAD,
    nodeCommand: 'C:\\attacker\\node.exe',
    spawnSyncFn: () => { calls += 1; return successSpawn(); },
  }).blocker, 'NODE_EXECUTABLE_NOT_CANONICAL');
  assert.equal(calls, 0);
});

test('guard maps only logical Git to the canonical fixed executable and rejects attacker-path git.exe', () => {
  const calls = [];
  const guard = createGuard({
    expectedHead: HEAD,
    spawnSyncFn: (...args) => { calls.push(args); return successSpawn(); },
  });
  assert.equal(guard.spawnSyncFn('git', STATUS, {}).status, 0);
  assert.equal(calls[0][0], BATTLE_BRIDGE_WINDOWS_HOST.git);
  const attacker = guard.spawnSyncFn('C:\\attacker\\git.exe', ['rev-parse', 'HEAD'], {});
  assert.equal(attacker.status, 86);
  assert.equal(attacker.stderr, 'EXACT_HEAD_SYNC_OPERATION_NOT_ALLOWED');
  assert.equal(calls.length, 1);
});

test('guard allows only a fresh clean-source ff-only merge of the exact approved SHA', () => {
  const calls = [];
  const guard = createGuard({
    expectedHead: HEAD.toUpperCase(),
    spawnSyncFn: (command, args) => { calls.push([command, args]); return successSpawn(); },
  });
  assert.equal(guard.spawnSyncFn('git', STATUS, {}).status, 0);
  const result = guard.spawnSyncFn('git', ['merge', '--ff-only', HEAD], {});
  assert.equal(result.status, 0);
  assert.deepEqual(calls[1], [BATTLE_BRIDGE_WINDOWS_HOST.git, ['merge', '--ff-only', HEAD]]);
  assert.equal(guard.state.mergeAllowed, true);
  assert.equal(guard.expectedHead, HEAD);
  assert.equal(guard.spawnSyncFn('git', ['merge', '--ff-only', HEAD], {}).stderr, 'CANONICAL_SOURCE_STATUS_STALE');
});

test('guard blocks a fast-forward to any SHA other than the approved head', () => {
  let calls = 0;
  const guard = createGuard({ expectedHead: HEAD, spawnSyncFn: () => { calls += 1; return successSpawn(); } });
  guard.spawnSyncFn('git', STATUS, {});
  const blocked = guard.spawnSyncFn('git', ['merge', '--ff-only', OTHER], {});
  assert.equal(blocked.status, 86);
  assert.equal(blocked.stderr, 'EXACT_HEAD_SYNC_TARGET_MISMATCH');
  assert.equal(calls, 1);
  assert.equal(guard.state.mergeAllowed, false);
});

test('guard rejects every unlisted command and destructive Git shape', () => {
  const guard = createGuard({ expectedHead: HEAD, spawnSyncFn: () => successSpawn() });
  for (const [command, args] of [
    ['git', ['rm', 'tracked.txt']],
    ['git', ['branch', '-D', 'main']],
    ['git', ['update-ref', '-d', 'refs/heads/main']],
    ['cmd.exe', ['/c', 'echo unsafe']],
    ['powershell.exe', ['-Command', 'Write-Host unsafe']],
    ['node', ['unlisted-script.mjs']],
  ]) {
    assert.equal(guard.spawnSyncFn(command, args, {}).stderr, 'EXACT_HEAD_SYNC_OPERATION_NOT_ALLOWED');
  }
  assert.equal(guard.state.unlistedOperationObserved, true);
});

test('guard allows only canonical read, fixed fetch and exact test shapes', () => {
  const calls = [];
  const guard = createGuard({ expectedHead: HEAD, spawnSyncFn: (...args) => { calls.push(args); return successSpawn(); } });
  for (const args of [
    ['branch', '--show-current'],
    ['rev-parse', 'HEAD'],
    ['rev-parse', 'origin/main'],
    STATUS,
    FETCH,
    ['rev-list', '--left-right', '--count', `HEAD...${HEAD}`],
    ['diff', '--name-only', `${OTHER}..${HEAD}`],
    STATUS,
  ]) assert.equal(guard.spawnSyncFn('git', args, {}).status, 0);
  assert.equal(guard.spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.node, CODEX_DISPATCH_TEST_ARGS, {}).status, 0);
  assert.ok(calls.every(([command]) => [BATTLE_BRIDGE_WINDOWS_HOST.git, BATTLE_BRIDGE_WINDOWS_HOST.node].includes(command)));
});

test('pre-existing non-runtime source dirt blocks fetch before any mutation', () => {
  let fetches = 0;
  const result = syncGuarded({
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    spawnSyncFn: (command, args) => {
      if (args[0] === 'fetch') fetches += 1;
      return successSpawn(args[0] === 'status' ? ' M shared/agents/source.mjs\n' : '');
    },
    syncFn: ({ spawnSyncFn }) => {
      spawnSyncFn('git', STATUS, {});
      const fetch = spawnSyncFn('git', FETCH, {});
      return { ok: false, blocker: fetch.stderr, branch: 'main', remoteHead: HEAD, afterHead: OTHER };
    },
  });
  assert.equal(result.blocker, 'CANONICAL_CHECKOUT_DIRTY');
  assert.deepEqual(result.sourceDirt, ['shared/agents/source.mjs']);
  assert.equal(result.mutationAttempted, false);
  assert.equal(fetches, 0);
});

test('pre-existing approved runtime dirt is preserved while fixed fetch remains source-only', () => {
  let fetches = 0;
  const guard = createGuard({
    expectedHead: HEAD,
    spawnSyncFn: (command, args) => {
      if (args[0] === 'fetch') fetches += 1;
      return successSpawn(args[0] === 'status' ? ' M apps/stephanos/dist/index.html\n' : '');
    },
  });
  assert.equal(guard.spawnSyncFn('git', STATUS, {}).status, 0);
  assert.equal(guard.spawnSyncFn('git', FETCH, {}).status, 0);
  assert.equal(fetches, 1);
});

test('source dirt appearing after a clean preflight blocks merge and proof', () => {
  let mutations = 0;
  let statusCalls = 0;
  const guard = createGuard({
    expectedHead: HEAD,
    spawnSyncFn: (command, args) => {
      if (args[0] === 'status') {
        statusCalls += 1;
        return successSpawn(statusCalls === 1 ? '' : '?? attacker-source.mjs\n');
      }
      if (['fetch', 'merge'].includes(args[0]) || command === BATTLE_BRIDGE_WINDOWS_HOST.node) mutations += 1;
      return successSpawn();
    },
  });
  guard.spawnSyncFn('git', STATUS, {});
  assert.equal(guard.spawnSyncFn('git', FETCH, {}).status, 0);
  guard.spawnSyncFn('git', STATUS, {});
  assert.equal(guard.spawnSyncFn('git', ['merge', '--ff-only', HEAD], {}).stderr, 'CANONICAL_CHECKOUT_DIRTY');
  assert.equal(guard.spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.node, CODEX_DISPATCH_TEST_ARGS, {}).stderr, 'CANONICAL_CHECKOUT_DIRTY');
  assert.equal(mutations, 1);
});

test('sync wrapper blocks unapproved merge target and preserves exact successful result', () => {
  let merges = 0;
  const blocked = syncGuarded({
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    spawnSyncFn: (command, args) => { if (args[0] === 'merge') merges += 1; return successSpawn(); },
    syncFn: ({ spawnSyncFn }) => {
      spawnSyncFn('git', STATUS, {});
      const merge = spawnSyncFn('git', ['merge', '--ff-only', OTHER], {});
      return { ok: false, blocker: 'FAST_FORWARD_FAILED', branch: 'main', remoteHead: OTHER, afterHead: OTHER, merge };
    },
  });
  assert.equal(blocked.blocker, 'REMOTE_HEAD_NOT_APPROVED');
  assert.equal(merges, 0);

  const passed = syncGuarded({
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    spawnSyncFn: (command, args) => { if (args[0] === 'merge') merges += 1; return successSpawn(); },
    syncFn: ({ spawnSyncFn }) => {
      spawnSyncFn('git', STATUS, {});
      const merge = spawnSyncFn('git', ['merge', '--ff-only', HEAD], {});
      return { ok: merge.status === 0, status: 'DONE', verdict: 'PASS', blocker: '', branch: 'main', remoteHead: HEAD, afterHead: HEAD, updated: true };
    },
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.expectedHeadMatch, true);
  assert.equal(passed.mergeAllowed, true);
  assert.equal(merges, 1);
});
