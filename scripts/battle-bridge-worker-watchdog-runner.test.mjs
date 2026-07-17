import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA,
  runBattleBridgeWorkerWatchdogRunner,
} from './battle-bridge-worker-watchdog-runner.mjs';

test('runner reconciles visibility, relay and critical backlog before the worker watchdog', async () => {
  const calls = [];
  const result = await runBattleBridgeWorkerWatchdogRunner({
    visibilityObserver: async () => {
      calls.push('visibility');
      return { ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' };
    },
    participantRelay: async () => {
      calls.push('participant-relay');
      return { ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' };
    },
    backlogConveyor: async () => {
      calls.push('critical-backlog');
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
    workerWatchdog: async () => {
      calls.push('watchdog');
      return { ok: true, classification: 'WORKER_WATCHDOG_HEALTHY' };
    },
  });

  assert.deepEqual(calls, ['visibility', 'participant-relay', 'critical-backlog', 'watchdog']);
  assert.equal(result.ok, true);
  assert.equal(result.visibilityOk, true);
  assert.equal(result.participantRelayOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.workerWatchdogOk, true);
  assert.equal(result.schemaVersion, BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA);
  assert.equal(result.codexVisibilityObserved, true);
  assert.equal(result.chatGptSharedWorkspaceRelayObserved, true);
  assert.equal(result.criticalBacklogConveyorObserved, true);
  assert.equal(result.codexVisibility.classification, 'REMOTE_CODEX_VISIBILITY_RECONCILED');
  assert.equal(result.chatGptSharedWorkspaceRelay.classification, 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE');
  assert.equal(result.criticalBacklogConveyor.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.classification, 'WORKER_WATCHDOG_HEALTHY');
});

test('visibility reconciliation failure is surfaced but does not disable later lanes', async () => {
  let relayCalled = false;
  let conveyorCalled = false;
  let watchdogCalled = false;
  const result = await runBattleBridgeWorkerWatchdogRunner({
    visibilityObserver: async () => { throw new Error('observer failed'); },
    participantRelay: async () => {
      relayCalled = true;
      return { ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' };
    },
    backlogConveyor: async () => {
      conveyorCalled = true;
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
    workerWatchdog: async () => {
      watchdogCalled = true;
      return { ok: true, classification: 'WORKER_WATCHDOG_HEALTHY' };
    },
  });

  assert.equal(relayCalled, true);
  assert.equal(conveyorCalled, true);
  assert.equal(watchdogCalled, true);
  assert.equal(result.ok, false);
  assert.equal(result.visibilityOk, false);
  assert.equal(result.participantRelayOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.workerWatchdogOk, true);
  assert.equal(result.codexVisibility.classification, 'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED');
  assert.match(result.codexVisibility.reason, /observer failed/);
});

test('relay failure is surfaced but does not disable backlog or worker watchdog', async () => {
  let conveyorCalled = false;
  let watchdogCalled = false;
  const result = await runBattleBridgeWorkerWatchdogRunner({
    visibilityObserver: async () => ({ ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' }),
    participantRelay: async () => { throw new Error('relay failed'); },
    backlogConveyor: async () => {
      conveyorCalled = true;
      return { ok: true, classification: 'WAIT_ACTIVE_MISSION' };
    },
    workerWatchdog: async () => {
      watchdogCalled = true;
      return { ok: true, classification: 'WORKER_WATCHDOG_HEALTHY' };
    },
  });

  assert.equal(conveyorCalled, true);
  assert.equal(watchdogCalled, true);
  assert.equal(result.ok, false);
  assert.equal(result.visibilityOk, true);
  assert.equal(result.participantRelayOk, false);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.workerWatchdogOk, true);
  assert.equal(result.chatGptSharedWorkspaceRelay.classification, 'CHATGPT_SHARED_WORKSPACE_RELAY_FAILED');
  assert.match(result.chatGptSharedWorkspaceRelay.reason, /relay failed/);
});

test('backlog failure is surfaced but the worker watchdog still runs', async () => {
  let watchdogCalled = false;
  const result = await runBattleBridgeWorkerWatchdogRunner({
    visibilityObserver: async () => ({ ok: true, classification: 'REMOTE_CODEX_VISIBILITY_RECONCILED' }),
    participantRelay: async () => ({ ok: true, classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE' }),
    backlogConveyor: async () => { throw new Error('conveyor failed'); },
    workerWatchdog: async () => {
      watchdogCalled = true;
      return { ok: true, classification: 'WORKER_WATCHDOG_HEALTHY' };
    },
  });

  assert.equal(watchdogCalled, true);
  assert.equal(result.ok, false);
  assert.equal(result.criticalBacklogConveyorOk, false);
  assert.equal(result.workerWatchdogOk, true);
  assert.equal(result.criticalBacklogConveyor.classification, 'CRITICAL_BACKLOG_CONVEYOR_FAILED');
  assert.match(result.criticalBacklogConveyor.reason, /conveyor failed/);
});
