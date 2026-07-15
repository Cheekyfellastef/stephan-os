import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupervisorHousekeepRunStep,
  ensureLiveUiConvergedBeforeSupervisor,
  runSupervisorHousekeepPreservingLiveDist,
} from './run-battle-bridge-ignition.mjs';

test('supervisor housekeeping defers generated dist mutation but preserves other safe housekeeping', () => {
  const delegated = [];
  const runStepFn = (label, command, args) => {
    delegated.push({ label, command, args });
    return true;
  };

  const guarded = createSupervisorHousekeepRunStep({ runStepFn });
  guarded('git-restore-auto-generated', 'git', ['restore', '--', 'apps/stephanos/dist/index.html']);
  guarded('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', 'apps/stephanos/dist/']);
  guarded('git-restore-runtime-tracked', 'git', ['restore', '--', 'stephanos-server/data/memory/durable-memory.json']);

  assert.deepEqual(delegated.map((entry) => entry.label), ['git-restore-runtime-tracked']);
});

test('supervisor housekeeping injects the live-dist-preserving run step into the existing housekeeper', () => {
  const delegated = [];
  let receivedOptions = null;
  const housekeepFn = (options) => {
    receivedOptions = options;
    options.runStepFn('git-clean-dist-untracked', 'git', ['clean', '-fd', '--', 'apps/stephanos/dist/']);
    options.runStepFn('git-clean-runtime-untracked', 'git', ['clean', '-fd', '--', 'data/activity/']);
    return { ok: true };
  };

  const result = runSupervisorHousekeepPreservingLiveDist(
    { dryRun: false, compact: true },
    {
      housekeepFn,
      runStepFn: (label) => {
        delegated.push(label);
        return true;
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(receivedOptions.dryRun, false);
  assert.equal(receivedOptions.compact, true);
  assert.deepEqual(delegated, ['git-clean-runtime-untracked']);
});

test('second press reuses an existing exact-head UI without spawning another refresh', async () => {
  const refreshCalls = [];
  const proof = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    probeFn: async () => proof,
    runStepFn: (...args) => {
      refreshCalls.push(args);
      return true;
    },
  });

  assert.equal(result.action, 'reuse-exact-head-ui');
  assert.equal(result.after, proof);
  assert.equal(refreshCalls.length, 0);
});

test('live stale UI is refreshed through launcher-root and must converge before supervisor starts', async () => {
  const refreshCalls = [];
  const before = { reachable: true, ready: false, currentHead: 'abc1234', proof: { ready: false } };
  const after = { reachable: true, ready: true, currentHead: 'abc1234', proof: { ready: true } };

  const result = await ensureLiveUiConvergedBeforeSupervisor({
    platform: 'win32',
    probeFn: async () => before,
    waitFn: async () => after,
    runStepFn: (label, command, args) => {
      refreshCalls.push({ label, command, args });
      return true;
    },
  });

  assert.equal(result.action, 'refreshed-stale-ui');
  assert.equal(result.after, after);
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].label, 'refresh-stale-ui-4173');
  assert.equal(refreshCalls[0].command, 'cmd.exe');
  assert.deepEqual(refreshCalls[0].args, ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:ignite:launcher-root']);
});

test('cold start remains delegated to the complete existing supervisor flow', async () => {
  const refreshCalls = [];
  const before = { reachable: false, ready: false, currentHead: 'abc1234', error: 'connection refused' };
  const result = await ensureLiveUiConvergedBeforeSupervisor({
    probeFn: async () => before,
    runStepFn: (...args) => {
      refreshCalls.push(args);
      return true;
    },
  });

  assert.equal(result.action, 'defer-cold-start-to-supervisor');
  assert.equal(refreshCalls.length, 0);
});

test('stale refresh without exact-head convergence fails closed', async () => {
  await assert.rejects(
    ensureLiveUiConvergedBeforeSupervisor({
      platform: 'win32',
      probeFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234' }),
      waitFn: async () => ({ reachable: true, ready: false, currentHead: 'abc1234', error: 'still stale' }),
      runStepFn: () => true,
    }),
    /without exact-head browser proof/,
  );
});
