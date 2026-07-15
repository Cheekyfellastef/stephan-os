import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refreshStephanosUi4173,
  resolveNpmStep,
  waitForExactHeadProof,
  waitForUiHealthState,
} from './refresh-stephanos-ui-4173.mjs';

test('Windows build and verify steps use the controlled cmd npm wrapper', () => {
  assert.deepEqual(resolveNpmStep('win32', 'stephanos:build'), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd', 'run', 'stephanos:build'],
  });
});

test('health-state wait tolerates a transient listener handoff', async () => {
  const observations = [
    { reachable: true },
    { reachable: true },
    { reachable: false, error: 'connection refused during restart' },
  ];
  const result = await waitForUiHealthState({
    expectedReachable: false,
    intervalMs: 0,
    timeoutMs: 1_000,
    probeFn: async () => observations.shift() || { reachable: false },
  });

  assert.equal(result.reached, true);
  assert.equal(result.last.reachable, false);
});

test('exact-head wait retries transient fetch failures until proof is ready', async () => {
  let attempts = 0;
  const result = await waitForExactHeadProof({
    currentHead: 'abc1234',
    intervalMs: 0,
    timeoutMs: 1_000,
    proofFn: async ({ currentHead }) => {
      attempts += 1;
      if (attempts === 1) throw new Error('fetch failed');
      if (attempts === 2) return { ready: false, currentHead };
      return { ready: true, currentHead, gitCommit: 'abc1234' };
    },
  });

  assert.equal(attempts, 3);
  assert.equal(result.ready, true);
  assert.equal(result.proof.gitCommit, 'abc1234');
});

test('stale live UI completes build, verify, stop, detached start, and exact-head proof', async () => {
  const steps = [];
  const result = await refreshStephanosUi4173({
    platform: 'win32',
    currentHeadFn: () => 'abc1234',
    runStepFn: (label, command, args) => {
      steps.push({ label, command, args });
      return true;
    },
    probeHealthFn: async () => ({ reachable: true, status: 200 }),
    requestRestartFn: async () => ({ accepted: true, status: 202 }),
    waitForHealthStateFn: async ({ expectedReachable }) => {
      assert.equal(expectedReachable, false);
      return { reached: true, last: { reachable: false } };
    },
    startServerFn: () => ({ started: true, pid: 4173, logPath: 'logs/refresh' }),
    waitForExactHeadFn: async ({ currentHead }) => ({
      ready: true,
      proof: { ready: true, currentHead, gitCommit: 'abc1234' },
    }),
  });

  assert.deepEqual(steps.map((step) => step.label), ['build-current-ui', 'verify-current-ui']);
  assert.equal(result.refreshed, true);
  assert.equal(result.restart.requested, true);
  assert.equal(result.start.pid, 4173);
  assert.equal(result.exactHeadProof.ready, true);
});

test('down UI skips restart request but still starts and proves the replacement', async () => {
  let restartCalls = 0;
  const result = await refreshStephanosUi4173({
    platform: 'linux',
    currentHeadFn: () => 'def5678',
    runStepFn: () => true,
    probeHealthFn: async () => ({ reachable: false, error: 'connection refused' }),
    requestRestartFn: async () => {
      restartCalls += 1;
      return { accepted: true };
    },
    startServerFn: () => ({ started: true, pid: 99, logPath: 'logs/refresh' }),
    waitForExactHeadFn: async ({ currentHead }) => ({ ready: true, proof: { ready: true, currentHead } }),
  });

  assert.equal(restartCalls, 0);
  assert.equal(result.restart.requested, false);
  assert.equal(result.exactHeadProof.currentHead, 'def5678');
});

test('accepted restart that never releases 4173 fails closed before replacement start', async () => {
  let startCalls = 0;
  await assert.rejects(
    refreshStephanosUi4173({
      platform: 'win32',
      currentHeadFn: () => 'abc1234',
      runStepFn: () => true,
      probeHealthFn: async () => ({ reachable: true }),
      requestRestartFn: async () => ({ accepted: true, status: 202 }),
      waitForHealthStateFn: async () => ({ reached: false, last: { reachable: true } }),
      startServerFn: () => {
        startCalls += 1;
        return { started: true, pid: 1 };
      },
    }),
    /did not stop within the bounded handoff window/,
  );

  assert.equal(startCalls, 0);
});

test('replacement that never reaches exact HEAD fails with its bounded log location', async () => {
  await assert.rejects(
    refreshStephanosUi4173({
      platform: 'win32',
      currentHeadFn: () => 'abc1234',
      runStepFn: () => true,
      probeHealthFn: async () => ({ reachable: false }),
      startServerFn: () => ({ started: true, pid: 1, logPath: 'logs/refresh-proof' }),
      waitForExactHeadFn: async () => ({ ready: false, error: 'fetch failed' }),
    }),
    /failed exact-head proof \(fetch failed\).*logs\/refresh-proof/,
  );
});
