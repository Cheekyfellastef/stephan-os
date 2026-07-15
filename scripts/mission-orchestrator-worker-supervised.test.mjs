import assert from 'node:assert/strict';
import test from 'node:test';

import { runSupervisedMissionWorker } from './mission-orchestrator-worker-supervised.mjs';

function sink() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

test('supervised worker writes heartbeat after a successful tick', async () => {
  const output = sink();
  const errors = sink();
  const heartbeats = [];
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: output.stream,
    stderr: errors.stream,
    runTick: async () => ({ publish: { ok: true } }),
    writeHeartbeat: async (input) => { heartbeats.push(input); },
  });
  assert.equal(exitCode, 0);
  assert.equal(heartbeats.length, 1);
  assert.equal(heartbeats[0].lastTickVerdict, 'MISSION_WORKER_TICK_PASS');
  assert.match(output.read(), /"publish"/);
  assert.equal(errors.read(), '');
});

test('supervised worker records failed tick heartbeat and exits non-zero in once mode', async () => {
  const output = sink();
  const errors = sink();
  const heartbeats = [];
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: output.stream,
    stderr: errors.stream,
    runTick: async () => { throw new Error('tick failed'); },
    writeHeartbeat: async (input) => { heartbeats.push(input); },
  });
  assert.equal(exitCode, 1);
  assert.equal(heartbeats[0].lastTickVerdict, 'MISSION_WORKER_TICK_FAILED');
  assert.match(errors.read(), /MISSION_WORKER_TICK_FAILED/);
});

test('heartbeat write failure is visible and non-zero in once mode', async () => {
  const errors = sink();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: sink().stream,
    stderr: errors.stream,
    runTick: async () => ({}),
    writeHeartbeat: async () => { throw new Error('write failed'); },
  });
  assert.equal(exitCode, 1);
  assert.match(errors.read(), /MISSION_WORKER_HEARTBEAT_WRITE_FAILED/);
});
