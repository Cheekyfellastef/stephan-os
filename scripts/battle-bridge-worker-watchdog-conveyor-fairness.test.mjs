import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_PATH,
  BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_TIMEOUT_MS,
  runBattleBridgeWorkerWatchdogRunner,
  runIsolatedBattleBridgeWorkerWatchdog,
} from './battle-bridge-worker-watchdog-runner.mjs';

function healthyWatchdog() {
  return {
    ok: true,
    classification: 'WORKER_WATCHDOG_HEALTHY',
    decision: {
      assessment: {
        healthy: true,
        sourceHead: 'a'.repeat(40),
      },
    },
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal || 'SIGTERM');
    return true;
  };
  return child;
}

function completeChild(child, payload, code = 0) {
  queueMicrotask(() => {
    child.stdout.end(payload, () => child.emit('close', code, null));
  });
}

test('critical backlog refresh starts while worker watchdog is still pending', async () => {
  let backlogStarted = false;
  let releaseWatchdog;
  const pendingWatchdog = new Promise((resolve) => {
    releaseWatchdog = resolve;
  });

  const runnerPromise = runBattleBridgeWorkerWatchdogRunner({
    workerWatchdog: () => pendingWatchdog,
    controlPlaneRecovery: async () => ({ ok: true, classification: 'CONTROL_PLANE_MAILBOX_HEALTHY' }),
    visibilityObserver: async () => ({ ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' }),
    participantRelay: async () => ({ ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' }),
    backlogConveyor: async () => {
      backlogStarted = true;
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
  });

  assert.equal(backlogStarted, true);
  releaseWatchdog(healthyWatchdog());
  const result = await runnerPromise;
  assert.equal(result.ok, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
});

test('production child isolation lets asynchronous conveyor work progress while watchdog CPU is blocked', async () => {
  let backlogAsyncCheckpoint = false;
  const payload = JSON.stringify(healthyWatchdog());
  const blockingScript = [
    'const until = Date.now() + 180;',
    'while (Date.now() < until) {}',
    `process.stdout.write(${JSON.stringify(payload)});`,
  ].join('\n');

  const runnerPromise = runBattleBridgeWorkerWatchdogRunner({
    workerWatchdog: () => runIsolatedBattleBridgeWorkerWatchdog({
      spawnChild: (_executable, _args, options) => spawn(process.execPath, ['-e', blockingScript], options),
    }),
    controlPlaneRecovery: async () => ({ ok: true, classification: 'CONTROL_PLANE_MAILBOX_HEALTHY' }),
    visibilityObserver: async () => ({ ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' }),
    participantRelay: async () => ({ ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' }),
    backlogConveyor: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      backlogAsyncCheckpoint = true;
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(backlogAsyncCheckpoint, true);
  const result = await runnerPromise;
  assert.equal(result.ok, true);
  assert.equal(result.workerWatchdogOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
});

test('isolated watchdog launch is fixed to node, one repository child, no shell and no caller environment', async () => {
  const child = fakeChild();
  let invocation = null;
  const resultPromise = runIsolatedBattleBridgeWorkerWatchdog({
    spawnChild: (executable, args, options) => {
      invocation = { executable, args, options };
      completeChild(child, JSON.stringify(healthyWatchdog()));
      return child;
    },
  });

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.args, [BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_PATH]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(Object.hasOwn(invocation.options, 'env'), false);
  assert.equal(invocation.args.length, 1);
});

test('duplicate isolated watchdog callers share one in-flight fixed child', async () => {
  const child = fakeChild();
  let spawnCalls = 0;
  const spawnChild = () => {
    spawnCalls += 1;
    return child;
  };

  const first = runIsolatedBattleBridgeWorkerWatchdog({ spawnChild });
  const second = runIsolatedBattleBridgeWorkerWatchdog({ spawnChild });
  assert.strictEqual(first, second);
  assert.equal(spawnCalls, 1);
  completeChild(child, JSON.stringify(healthyWatchdog()));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, secondResult);
  assert.equal(firstResult.ok, true);
});

test('isolated watchdog timeout is fixed, kills the child and fails closed', async () => {
  const child = fakeChild();
  let scheduledDelay = 0;
  const result = await runIsolatedBattleBridgeWorkerWatchdog({
    spawnChild: () => child,
    scheduleTimeout: (handler, delayMs) => {
      scheduledDelay = delayMs;
      queueMicrotask(handler);
      return Symbol('timeout');
    },
    cancelTimeout: () => {},
  });

  assert.equal(scheduledDelay, BATTLE_BRIDGE_WORKER_WATCHDOG_CHILD_TIMEOUT_MS);
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'WORKER_WATCHDOG_CHILD_TIMEOUT');
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.equal(result.arbitraryExecutableAllowed, false);
  assert.equal(result.arbitraryPathAllowed, false);
  assert.equal(result.arbitraryArgumentsAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.arbitraryEnvironmentAllowed, false);
});

test('isolated watchdog launch failure and malformed child output remain typed and fail closed', async () => {
  const launchFailure = await runIsolatedBattleBridgeWorkerWatchdog({
    spawnChild: () => { throw new Error('do not publish this raw error'); },
  });
  assert.equal(launchFailure.ok, false);
  assert.equal(launchFailure.classification, 'WORKER_WATCHDOG_CHILD_LAUNCH_FAILED');
  assert.equal('reason' in launchFailure, false);

  const child = fakeChild();
  const malformedPromise = runIsolatedBattleBridgeWorkerWatchdog({
    spawnChild: () => {
      child.stderr.end('secret raw child stderr');
      completeChild(child, 'not-json', 2);
      return child;
    },
  });
  const malformed = await malformedPromise;
  assert.equal(malformed.ok, false);
  assert.equal(malformed.classification, 'WORKER_WATCHDOG_CHILD_RESULT_INVALID');
  assert.equal('reason' in malformed, false);
});

test('critical backlog refresh starts before participant relay synchronous prefix', async () => {
  const calls = [];
  let backlogStarted = false;

  const result = await runBattleBridgeWorkerWatchdogRunner({
    workerWatchdog: async () => {
      calls.push('watchdog');
      return healthyWatchdog();
    },
    controlPlaneRecovery: async () => {
      calls.push('control-plane-recovery');
      return { ok: true, classification: 'CONTROL_PLANE_MAILBOX_HEALTHY' };
    },
    visibilityObserver: async () => {
      calls.push('visibility');
      return { ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' };
    },
    participantRelay: () => {
      calls.push('participant-relay-sync-prefix');
      assert.equal(backlogStarted, true);
      return { ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' };
    },
    backlogConveyor: async () => {
      calls.push('critical-backlog');
      backlogStarted = true;
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
  });

  assert.deepEqual(calls, [
    'watchdog',
    'critical-backlog',
    'control-plane-recovery',
    'visibility',
    'participant-relay-sync-prefix',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.visibilityOk, true);
  assert.equal(result.participantRelayOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.criticalBacklogConveyor.classification, 'WAIT_ACTIVE_MISSION');
});

test('one failed auxiliary lane does not prevent construction refresh or sibling completion', async () => {
  const calls = [];
  const result = await runBattleBridgeWorkerWatchdogRunner({
    workerWatchdog: async () => healthyWatchdog(),
    controlPlaneRecovery: async () => ({ ok: true, classification: 'CONTROL_PLANE_MAILBOX_HEALTHY' }),
    visibilityObserver: async () => {
      calls.push('visibility');
      throw new Error('visibility unavailable');
    },
    participantRelay: async () => {
      calls.push('participant-relay');
      return { ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' };
    },
    backlogConveyor: async () => {
      calls.push('critical-backlog');
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
  });

  assert.deepEqual(calls, ['critical-backlog', 'visibility', 'participant-relay']);
  assert.equal(result.ok, false);
  assert.equal(result.visibilityOk, false);
  assert.equal(result.participantRelayOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.codexVisibility.classification, 'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED');
});
