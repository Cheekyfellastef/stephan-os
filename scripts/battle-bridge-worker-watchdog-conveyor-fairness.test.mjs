import assert from 'node:assert/strict';
import test from 'node:test';

import { runBattleBridgeWorkerWatchdogRunner } from './battle-bridge-worker-watchdog-runner.mjs';

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

test('critical backlog refresh starts even while visibility and participant lanes are unresolved', async () => {
  let resolveVisibility;
  let resolveRelay;
  let visibilityTimer;
  let relayTimer;
  const calls = [];

  const result = await runBattleBridgeWorkerWatchdogRunner({
    workerWatchdog: async () => {
      calls.push('watchdog');
      return healthyWatchdog();
    },
    controlPlaneRecovery: async () => {
      calls.push('control-plane-recovery');
      return { ok: true, classification: 'CONTROL_PLANE_MAILBOX_HEALTHY' };
    },
    visibilityObserver: () => {
      calls.push('visibility');
      return new Promise((resolve, reject) => {
        resolveVisibility = resolve;
        visibilityTimer = setTimeout(() => reject(new Error('visibility starved construction refresh')), 250);
      });
    },
    participantRelay: () => {
      calls.push('participant-relay');
      return new Promise((resolve, reject) => {
        resolveRelay = resolve;
        relayTimer = setTimeout(() => reject(new Error('participant relay starved construction refresh')), 250);
      });
    },
    backlogConveyor: async () => {
      calls.push('critical-backlog');
      assert.equal(typeof resolveVisibility, 'function');
      assert.equal(typeof resolveRelay, 'function');
      clearTimeout(visibilityTimer);
      clearTimeout(relayTimer);
      resolveVisibility({ ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' });
      resolveRelay({ ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' });
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
  });

  assert.deepEqual(calls, [
    'watchdog',
    'control-plane-recovery',
    'visibility',
    'participant-relay',
    'critical-backlog',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.visibilityOk, true);
  assert.equal(result.participantRelayOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.criticalBacklogConveyor.classification, 'WAIT_ACTIVE_MISSION');
});

test('one failed auxiliary lane does not prevent construction refresh or sibling completion', async () => {
  let conveyorCalls = 0;
  const result = await runBattleBridgeWorkerWatchdogRunner({
    workerWatchdog: async () => healthyWatchdog(),
    controlPlaneRecovery: async () => ({ ok: true, classification: 'CONTROL_PLANE_MAILBOX_HEALTHY' }),
    visibilityObserver: async () => { throw new Error('visibility unavailable'); },
    participantRelay: async () => ({ ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' }),
    backlogConveyor: async () => {
      conveyorCalls += 1;
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
  });

  assert.equal(conveyorCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.visibilityOk, false);
  assert.equal(result.participantRelayOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.codexVisibility.classification, 'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED');
});
