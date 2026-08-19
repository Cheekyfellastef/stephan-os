import assert from 'node:assert/strict';
import test from 'node:test';

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

test('exact-head guard allows only ff-only merge of the exact approved SHA', () => {
  const calls = [];
  const guard = createBattleBridgeExactHeadSpawnGuard({
    expectedHead: HEAD.toUpperCase(),
    spawnSyncFn: (command, args) => { calls.push([command, args]); return successSpawn(); },
  });
  const result = guard.spawnSyncFn('git', ['merge', '--ff-only', HEAD], {});
  assert.equal(result.status, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['git', ['merge', '--ff-only', HEAD]]);
  assert.equal(guard.state.mergeAllowed, true);
  assert.equal(guard.expectedHead, HEAD);
});

test('exact-head guard independently denies destructive and branch-changing Git writes', () => {
  const guard = createBattleBridgeExactHeadSpawnGuard({ expectedHead: HEAD, spawnSyncFn: successSpawn });
  for (const operation of ['reset', 'clean', 'stash', 'rebase', 'checkout', 'switch', 'push', 'commit', 'cherry-pick']) {
    const result = guard.spawnSyncFn('git', [operation, 'anything'], {});
    assert.equal(result.status, 86, operation);
    assert.equal(result.stderr, 'EXACT_HEAD_SYNC_FORBIDDEN_GIT_WRITE', operation);
  }
  assert.equal(guard.state.forbiddenGitWriteObserved, true);
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

test('sync wrapper preserves an exact successful fast-forward result', () => {
  let merges = 0;
  const result = syncBattleBridgeExactHeadV1({
    expectedHead: HEAD,
    operatorApproval: 'operator-approved',
    spawnSyncFn: (command, args) => {
      if (args?.[0] === 'merge') merges += 1;
      return successSpawn();
    },
    syncFn: ({ spawnSyncFn }) => {
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
});
