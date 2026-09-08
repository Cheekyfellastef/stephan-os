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
    'control-plane-recovery',
    'critical-backlog',
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
