import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runBattleBridgeSyncAndRefresh,
} from './battle-bridge-github-sync-and-refresh.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const paths = { repoRoot: '/canonical/repo', workspaceRoot: '/canonical/workspace' };

function noChange(head = B) {
  return { ok: true, evaluation: { classification: 'SYNC_NO_CHANGE' }, facts: { localHead: head, remoteHead: head } };
}

function updated(before = A, after = B) {
  return {
    ok: false,
    sourceUpdated: true,
    evaluation: { classification: 'BLOCKED_POST_SYNC_REFRESH_REQUIRED' },
    facts: { localHead: before, localHeadBefore: before, localHeadAfter: after, remoteHead: after },
  };
}

test('recovers a pending old-executor refresh then converges through no-change proof', async () => {
  const calls = [];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    pendingReader: async () => ({ ok: true, beforeHead: A, afterHead: B }),
    adapter: {
      runRefresh(input) { calls.push(['refresh', input.beforeHead, input.afterHead]); return { ok: true, result: { ok: true, sourceHead: B } }; },
      runSync() { calls.push(['sync']); return { ok: true, result: noChange() }; },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['refresh', A, B], ['sync']]);
  assert.equal(result.freshCoordinatorProcessUsed, true);
});

test('new source update refreshes and then runs a second sync for current-state convergence', async () => {
  const calls = [];
  const syncResults = [updated(), noChange()];
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    pendingReader: async () => null,
    adapter: {
      runSync() { calls.push('sync'); return { ok: true, result: syncResults.shift() }; },
      runRefresh(input) { calls.push(`refresh:${input.beforeHead}:${input.afterHead}`); return { ok: true, result: { ok: true, sourceHead: B } }; },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['sync', `refresh:${A}:${B}`, 'sync']);
});

test('refresh blocker stops without starting another sync cycle', async () => {
  let syncCalls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    pendingReader: async () => null,
    adapter: {
      runSync() { syncCalls += 1; return { ok: true, result: updated() }; },
      runRefresh() { return { ok: true, result: { ok: false, blocker: 'OPENCLAW_REFRESH_APPROVAL_REQUIRED' } }; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_REFRESH_APPROVAL_REQUIRED');
  assert.equal(syncCalls, 1);
});

test('invalid pending head evidence fails closed before any execution', async () => {
  let calls = 0;
  const result = await runBattleBridgeSyncAndRefresh({
    paths,
    expectedPaths: paths,
    pendingReader: async () => ({ ok: false, blocker: 'PENDING_POST_SYNC_HEADS_INVALID' }),
    adapter: { runSync() { calls += 1; }, runRefresh() { calls += 1; } },
  });
  assert.equal(result.blocker, 'PENDING_POST_SYNC_HEADS_INVALID');
  assert.equal(calls, 0);
});

test('default transport launches only fixed Node scripts without a shell', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./battle-bridge-github-sync-and-refresh.mjs', import.meta.url), 'utf8');
  assert.match(source, /battle-bridge-github-sync-executor\.mjs/);
  assert.match(source, /battle-bridge-post-sync-refresh\.mjs/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression|cmd\.exe/i);
});
