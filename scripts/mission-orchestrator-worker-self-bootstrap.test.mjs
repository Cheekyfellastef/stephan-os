import assert from 'node:assert/strict';
import test from 'node:test';

import { runSupervisedMissionWorker } from './mission-orchestrator-worker-supervised.mjs';

function sink() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

const workerHead = 'a'.repeat(40);
const canonicalIdentity = async () => ({
  valid: true,
  canonical: true,
  branch: 'main',
  headSha: workerHead,
  sourceClean: true,
  worktreeClean: true,
  runtimeDirtCount: 0,
  blocker: '',
});

test('supervised worker publishes supervised heartbeat before mailbox bootstrap and mission tick', async () => {
  const events = [];
  const output = sink();
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: workerHead },
    stdout: output.stream,
    stderr: sink().stream,
    bootstrapMailbox: async () => {
      events.push('bootstrap');
      return { ok: true, status: 'MAILBOX_SELF_BOOTSTRAP_INSTALLED' };
    },
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: async () => ({
      status: 'ACTIVE',
      allowWorkerTick: true,
    }),
    runTick: async () => {
      events.push('tick');
      return { publish: { ok: true } };
    },
    writeHeartbeat: async ({ lastTickVerdict }) => {
      events.push(`heartbeat:${lastTickVerdict}`);
    },
    setIntervalFn: () => 7,
    clearIntervalFn: () => {},
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, [
    'heartbeat:MISSION_WORKER_TICK_RUNNING',
    'bootstrap',
    'tick',
    'heartbeat:MISSION_WORKER_TICK_PASS',
  ]);
  assert.match(output.read(), /MAILBOX_SELF_BOOTSTRAP_INSTALLED/);
});

test('bootstrap failure is visible but the long-running worker path remains available', async () => {
  const errors = sink();
  let tickRan = false;
  const exitCode = await runSupervisedMissionWorker({
    argv: ['--once'],
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: workerHead },
    stdout: sink().stream,
    stderr: errors.stream,
    bootstrapMailbox: async () => { throw new Error('registration denied'); },
    inspectRepositoryIdentity: canonicalIdentity,
    runControllerCycle: async () => ({
      status: 'ACTIVE',
      allowWorkerTick: true,
    }),
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
