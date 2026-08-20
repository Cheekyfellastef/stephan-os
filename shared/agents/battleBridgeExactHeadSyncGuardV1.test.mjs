import assert from 'node:assert/strict';
import test from 'node:test';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { CODEX_DISPATCH_TEST_ARGS } from './codexDispatchHostOps.mjs';
import {
  createBattleBridgeExactHeadSpawnGuard,
  syncBattleBridgeExactHeadV1,
} from './battleBridgeExactHeadSyncGuardV1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

function successSpawn() {
  return { status: 0, signal: null, stdout: '', stderr: '' };
}

test('exact-head guard rejects malformed approval before any process call', () => {
  let calls = 0;
  const guard = createBattleBridgeExactHeadSpawnGuard({
    expectedHead: 'main',
    spawnSyncFn: () => { calls += 1; return successSpawn(); },
  });
  assert.equal(guard.ok, false);
  assert.equal(guard.blocker, 'EXPECTED_HEAD_INVALID');
  assert.equal(calls, 0);
});

test('exact-head guard blocks a fast-forward to any SHA other than the approved head', () => {
  let calls = 0;
  const guard = createBattleBridgeExactHeadSpawnGuard({
    expectedHead: HEAD,
    spawnSyncFn: () => { calls += 1; return successSpawn(); },
  });
  const blocked = guard.spawnSyncFn('git', ['merge', '--ff-only', OTHER], {});
  assert.equal(blocked.status, 86);
  assert.equal(blocked.stderr, 'EXACT_HEAD_SYNC_TARGET_MISMATCH');
  assert.equal(calls, 0);
  assert.equal(guard.state.mergeAttempted, true);
  assert.equal(guard.state.mergeAllowed, false);
});

test('exact-head guard allows only ff-only merge of the exact approved SHA through canonical Git', () => {
  const calls = [];
  const guard = createBattleBridgeExactHeadSpawnGuard({
    expectedHead: HEAD.toUpperCase(),
    spawnSyncFn: (command, args) => { calls.push([command, args]); return successSpawn(); },
  });
  const result = guard.spawnSyncFn('git', ['merge', '--ff-only', HEAD], {});
  assert.equal(result.status, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [BATTLE_BRIDGE_WINDOWS_HOST.git, ['merge', '--ff-only', HEAD]]);
  assert.equal(guard.state.mergeAllowed, true);
  assert.equal(guard.expectedHead, HEAD);
});

test('exact-head guard rejects every unlisted command and destructive Git shape', () => {
  const guard = createBattleBridgeExactHeadSpawnGuard({ expectedHead: HEAD, spawnSyncFn: successSpawn });
  for (const [command, args] of [
    ['git', ['rm', 'tracked.txt']],
    ['git', ['branch', '-D', 'main']],
    ['git', ['update-ref', '-d', 'refs/heads/main']],
    ['cmd.exe', ['/c', 'echo unsafe']],
    ['powershell.exe', ['-Command', 'Write-Host unsafe']],
    ['node', ['unlisted-script.mjs']],
  ]) {
    const result = guard.spawnSyncFn(command, args, {});
    assert.equal(result.status, 86, `${command} ${args.join(' ')}`);
    assert.equal(result.stderr, 'EXACT_HEAD_SYNC_OPERATION_NOT_ALLOWED');
  }
  assert.equal(guard.state.unlistedOperationObserved, true);
});

test('exact-head guard allows only canonical read/fetch shapes and executes them through canonical Git', () => {
  const calls = [];
  const guard = createBattleBridgeExactHeadSpawnGuard({ expectedHead: HEAD, spawnSyncFn: (...args) => { calls.push(args); return successSpawn(); } });
  for (const args of [
    ['branch', '--show-current'], ['rev-parse', 'HEAD'], ['rev-parse', 'origin/main'],
    ['status', '--porcelain=v1', '--untracked-files=all'], ['fetch', 'origin', 'main'],
    ['rev-list', '--left-right', '--count', `HEAD...${HEAD}`], ['diff', '--name-only', `${OTHER}..${HEAD}`],
  ]) assert.equal(guard.spawnSyncFn('git', args, {}).status, 0);
  assert.equal(calls.length, 7);
  assert.ok(calls.every(([command]) => command === BATTLE_BRIDGE_WINDOWS_HOST.git));
});

test('exact-head guard rejects attacker-controlled Git and Node executable paths', () => {
  const calls = [];
  const guard = createBattleBridgeExactHeadSpawnGuard({
    expectedHead: HEAD,
    spawnSyncFn: (...args) => { calls.push(args); return successSpawn(); },
  });
  const fakeGit = guard.spawnSyncFn('C:\\attacker\\git.exe', ['merge', '--ff-only', HEAD], {});
  assert.equal(fakeGit.status, 86);
  assert.equal(fakeGit.stderr, 'EXACT_HEAD_SYNC_OPERATION_NOT_ALLOWED');
  const fakeNode = guard.spawnSyncFn('C:\\attacker\\node.exe', CODEX_DISPATCH_TEST_ARGS, {});
  assert.equal(fakeNode.status, 86);
  assert.equal(fakeNode.stderr, 'EXACT_HEAD_SYNC_OPERATION_NOT_ALLOWED');
  assert.equal(calls.length, 0);
});

test('exact-head guard permits the fixed proof suite only through canonical Node', () => {
  const calls = [];
  const guard = createBattleBridgeExactHeadSpawnGuard({
    expectedHead: HEAD,
    spawnSyncFn: (...args) => { calls.push(args); return successSpawn(); },
  });
  const result = guard.spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.node, CODEX_DISPATCH_TEST_ARGS, {});
  assert.equal(result.status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], BATTLE_BRIDGE_WINDOWS_HOST.node);
});

test('sync wrapper fails closed before merge when fetched origin/main differs from approved exact head', () => {
  let realMergeCalls = 0;
  const result = syncBattleBridgeExactHeadV1({
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    spawnSyncFn: (command, args) => {
      if (args?.[0] === 'merge') realMergeCalls += 1;
      return successSpawn();
    },
    syncFn: ({ spawnSyncFn }) => {
      const merge = spawnSyncFn('git', ['merge', '--ff-only', OTHER], {});
      return {
        ok: merge.status === 0,
        status: merge.status === 0 ? 'DONE' : 'BLOCKED',
        verdict: merge.status === 0 ? 'PASS' : 'FAIL',
        blocker: merge.status === 0 ? '' : 'FAST_FORWARD_FAILED',
        branch: 'main',
        remoteHead: OTHER,
        afterHead: 'c'.repeat(40),
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'REMOTE_HEAD_NOT_APPROVED');
  assert.equal(result.mergeAttempted, true);
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.mutationAttempted, false);
  assert.equal(realMergeCalls, 0);
});

test('sync wrapper preserves an exact successful fast-forward result and pins canonical Node', () => {
  let merges = 0;
  let observedNode = '';
  const result = syncBattleBridgeExactHeadV1({
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    spawnSyncFn: (command, args) => {
      if (args?.[0] === 'merge') {
        merges += 1;
        assert.equal(command, BATTLE_BRIDGE_WINDOWS_HOST.git);
      }
      return successSpawn();
    },
    syncFn: ({ spawnSyncFn, nodeCommand }) => {
      observedNode = nodeCommand;
      const merge = spawnSyncFn('git', ['merge', '--ff-only', HEAD], {});
      return {
        ok: merge.status === 0,
        status: 'DONE',
        verdict: 'PASS',
        blocker: '',
        branch: 'main',
        remoteHead: HEAD,
        afterHead: HEAD,
        updated: true,
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.mergeAllowed, true);
  assert.equal(merges, 1);
  assert.equal(observedNode, BATTLE_BRIDGE_WINDOWS_HOST.node);
});

test('sync wrapper ignores a caller nodeCommand injection surface', () => {
  let observedNode = '';
  const result = syncBattleBridgeExactHeadV1({
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    nodeCommand: 'C:\\attacker\\node.exe',
    spawnSyncFn: successSpawn,
    syncFn: ({ nodeCommand }) => {
      observedNode = nodeCommand;
      return { ok: true, status: 'DONE', verdict: 'PASS', remoteHead: HEAD, afterHead: HEAD };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(observedNode, BATTLE_BRIDGE_WINDOWS_HOST.node);
});
