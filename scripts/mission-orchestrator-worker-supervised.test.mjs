import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMissionWorkerControllerLogProjection,
  createMissionWorkerTickLogProjection,
  runSupervisedMissionWorker,
} from './mission-orchestrator-worker-supervised.mjs';

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

const actionGrant = {
  schemaVersion: 'stephanos.mission-worker-action-grant.v1',
  missionId: 'critical-supervisor-test',
  actionId: 'critical-supervisor-test-r1-action',
  adapter: 'codex',
  boundedActionCount: 1,
};
const allowWorkerTick = async () => ({
  status: 'ACTIVE',
  allowWorkerTick: true,
  workerActionGrant: actionGrant,
});
const bootstrapMailbox = async () => ({ ok: true, status: 'MAILBOX_ALREADY_REGISTERED' });

test('supervised worker writes running and final heartbeat around a successful tick', async () => {
  const output = sink();
  const errors = sink();
  const heartbeats = [];
  const timer = timerHarness();
  let tickOptions = null;
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: output.stream,
    stderr: errors.stream,
    bootstrapMailbox,
    runControllerCycle: allowWorkerTick,
    runTick: async (options) => {
      tickOptions = options;
      return { publish: { ok: true } };
    },
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
  assert.deepEqual(tickOptions.actionGrant, actionGrant);
  assert.match(output.read(), /"event":"worker-tick"/);
  assert.match(output.read(), /"publishOk":true/);
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
    bootstrapMailbox,
    runControllerCycle: allowWorkerTick,
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
    bootstrapMailbox,
    runControllerCycle: allowWorkerTick,
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
    bootstrapMailbox,
    runControllerCycle: allowWorkerTick,
    runTick: async () => ({}),
    writeHeartbeat: async () => { throw new Error('write failed'); },
    setIntervalFn: timer.setIntervalFn,
    clearIntervalFn: timer.clearIntervalFn,
  });
  assert.equal(exitCode, 1);
  assert.match(errors.read(), /MISSION_WORKER_HEARTBEAT_WRITE_FAILED/);
});

test('supervised worker gates source work through the durable controller', async () => {
  const output = sink();
  let workerTicks = 0;
  let observedOptions = null;
  const head = 'a'.repeat(40);
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: head },
    stdout: output.stream,
    stderr: sink().stream,
    bootstrapMailbox,
    runControllerCycle: async (_machinery, options) => {
      observedOptions = options;
      return { status: 'HOLD', allowWorkerTick: false, blockers: ['authority-held'] };
    },
    runTick: async () => { workerTicks += 1; return {}; },
    writeHeartbeat: async () => {},
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
  });
  assert.equal(exitCode, 0);
  assert.equal(workerTicks, 0);
  assert.equal(observedOptions.sourceRevision, head);
  assert.equal(observedOptions.env.STEPHANOS_MISSION_WORKER_HEAD_SHA, head);
  assert.match(output.read(), /"authority-held"/);
});

test('worker logs only bounded authority-relevant controller and tick truth', () => {
  const huge = 'x'.repeat(2_000_000);
  const controller = createMissionWorkerControllerLogProjection({
    status: 'HOLD',
    action: 'HOLD',
    finalVerdict: 'PROGRAMME_HOLD',
    allowWorkerTick: false,
    blockers: ['capacity-unavailable'],
    projection: { huge },
    actionResult: { huge },
  }, '2026-08-26T02:20:00.000Z');
  const tick = createMissionWorkerTickLogProjection({
    status: 'DONE',
    finalVerdict: 'MISSION_WORKER_DONE',
    publish: { ok: true, huge },
    evidence: { huge },
  }, '2026-08-26T02:20:01.000Z');
  assert.equal(JSON.stringify(controller).length < 1_000, true);
  assert.equal(JSON.stringify(tick).length < 1_000, true);
  assert.equal(JSON.stringify(controller).includes(huge), false);
  assert.equal(JSON.stringify(tick).includes(huge), false);
  assert.equal(controller.blockers[0], 'capacity-unavailable');
  assert.equal(tick.publishOk, true);
});

test('long-running worker suppresses unchanged controller telemetry', async () => {
  const output = sink();
  let sleeps = 0;
  await assert.rejects(runSupervisedMissionWorker({
    argv: [],
    env: {},
    stdout: output.stream,
    stderr: sink().stream,
    bootstrapMailbox,
    runControllerCycle: async () => ({
      status: 'HOLD',
      action: 'HOLD',
      finalVerdict: 'PROGRAMME_HOLD',
      allowWorkerTick: false,
      blockers: ['capacity-unavailable'],
    }),
    runTick: async () => ({}),
    writeHeartbeat: async () => {},
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
    sleep: async () => {
      sleeps += 1;
      if (sleeps >= 2) throw new Error('stop-test-loop');
    },
  }), /stop-test-loop/);
  const controllerLines = output.read().split('\n').filter((line) => line.includes('"event":"controller-cycle"'));
  assert.equal(controllerLines.length, 1);
});
