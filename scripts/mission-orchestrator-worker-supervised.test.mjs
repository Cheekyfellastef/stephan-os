import assert from 'node:assert/strict';
import test from 'node:test';

import { runSupervisedMissionWorker } from './mission-orchestrator-worker-supervised.mjs';

function sink() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

function timerHarness() {
  let callback = null;
  let cleared = false;
  return {
    setIntervalFn(fn) { callback = fn; return 17; },
    clearIntervalFn(id) { assert.equal(id, 17); cleared = true; },
    fire() { assert.ok(callback); callback(); },
    wasCleared: () => cleared,
  };
}

test('supervised worker writes running and final heartbeat around a successful tick', async () => {
  const output = sink();
  const errors = sink();
  const heartbeats = [];
  const timer = timerHarness();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: output.stream,
    stderr: errors.stream,
    runTick: async () => ({ publish: { ok: true } }),
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(heartbeats.map(({ lastTickVerdict }) => lastTickVerdict), [
    'MISSION_WORKER_TICK_RUNNING',
    'MISSION_WORKER_TICK_PASS',
  ]);
  assert.equal(timer.wasCleared(), true);
  assert.match(output.read(), /"publish"/);
  assert.equal(errors.read(), '');
});

test('supervised worker refreshes heartbeat while a long tick is still running', async () => {
  const heartbeats = [];
  const timer = timerHarness();
  let releaseTick;
  const tickGate = new Promise((resolve) => { releaseTick = resolve; });
  let tickStarted;
  const started = new Promise((resolve) => { tickStarted = resolve; });

  const workerPromise = runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEARTBEAT_INTERVAL_MS: '1000' },
    stdout: sink().stream,
    stderr: sink().stream,
    runTick: async () => {
      tickStarted();
      await tickGate;
      return {};
    },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });

  await started;
  timer.fire();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(heartbeats.map(({ lastTickVerdict }) => lastTickVerdict), [
    'MISSION_WORKER_TICK_RUNNING',
    'MISSION_WORKER_TICK_RUNNING',
  ]);

  releaseTick();
  assert.equal(await workerPromise, 0);
  assert.equal(heartbeats.at(-1).lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.equal(timer.wasCleared(), true);
});

test('supervised worker records failed tick heartbeat and exits non-zero in once mode', async () => {
  const output = sink();
  const errors = sink();
  const heartbeats = [];
  const timer = timerHarness();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: output.stream,
    stderr: errors.stream,
    runTick: async () => { throw new Error('tick failed'); },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(heartbeats.map(({ lastTickVerdict }) => lastTickVerdict), [
    'MISSION_WORKER_TICK_RUNNING',
    'MISSION_WORKER_TICK_FAILED',
  ]);
  assert.match(errors.read(), /MISSION_WORKER_TICK_FAILED/);
});

test('heartbeat write failure is visible and non-zero in once mode', async () => {
  const errors = sink();
  const timer = timerHarness();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: sink().stream,
    stderr: errors.stream,
    runTick: async () => ({}),
    writeHeartbeat: async () => { throw new Error('write failed'); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });
  assert.equal(exitCode, 1);
  assert.match(errors.read(), /MISSION_WORKER_HEARTBEAT_WRITE_FAILED/);
});
