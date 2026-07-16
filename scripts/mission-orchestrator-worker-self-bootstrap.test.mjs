import assert from 'node:assert/strict';
import test from 'node:test';

import { runSupervisedMissionWorker } from './mission-orchestrator-worker-supervised.mjs';

function sink() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

test('supervised worker self-bootstraps mailbox before its first mission tick', async () => {
  const events = [];
  const output = sink();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: output.stream,
    stderr: sink().stream,
    bootstrapMailbox: async () => {
      events.push('bootstrap');
      return { ok: true, status: 'MAILBOX_SELF_BOOTSTRAP_INSTALLED' };
    },
    runTick: async () => {
      events.push('tick');
      return { publish: { ok: true } };
    },
    writeHeartbeat: async () => {},
    setIntervalFn: () => 7,
    clearIntervalFn: () => {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['bootstrap', 'tick']);
  assert.match(output.read(), /MAILBOX_SELF_BOOTSTRAP_INSTALLED/);
});

test('bootstrap failure is visible but the long-running worker path remains available', async () => {
  const errors = sink();
  let tickRan = false;
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: {},
    stdout: sink().stream,
    stderr: errors.stream,
    bootstrapMailbox: async () => { throw new Error('registration denied'); },
    runTick: async () => { tickRan = true; return {}; },
    writeHeartbeat: async () => {},
    setIntervalFn: () => 7,
    clearIntervalFn: () => {},
  });

  assert.equal(tickRan, true);
  assert.equal(exitCode, 1);
  assert.match(errors.read(), /MAILBOX_SELF_BOOTSTRAP_FAILED/);
  assert.match(errors.read(), /registration denied/);
});
