import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_CONTROL_PLANE_MAILBOX_STALE_AFTER_MS,
  BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA,
  runBattleBridgeControlPlaneBootstrapRecovery,
  runBattleBridgeWorkerWatchdogRunner,
} from './battle-bridge-worker-watchdog-runner.mjs';

const EXACT_HEAD = 'b'.repeat(40);
const TEST_PATHS = Object.freeze({
  repoRoot: '/canonical/repo',
  workspaceRoot: '/canonical/workspace',
});

function healthyWatchdog(head = EXACT_HEAD) {
  return {
    ok: true,
    classification: 'WORKER_WATCHDOG_HEALTHY',
    decision: {
      assessment: {
        healthy: true,
        sourceHead: head,
      },
    },
  };
}

test('runner prioritizes worker and control-plane recovery before auxiliary reconciliation', async () => {
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
      return healthyWatchdog();
    },
    controlPlaneRecovery: async ({ watchdog }) => {
      calls.push('control-plane-recovery');
      assert.equal(watchdog.ok, true);
      return { ok: true, classification: 'CONTROL_PLANE_MAILBOX_HEALTHY' };
    },
  });

  assert.deepEqual(calls, ['watchdog', 'control-plane-recovery', 'visibility', 'participant-relay', 'critical-backlog']);
  assert.equal(result.ok, true);
  assert.equal(result.visibilityOk, true);
  assert.equal(result.participantRelayOk, true);
  assert.equal(result.criticalBacklogConveyorOk, true);
  assert.equal(result.workerWatchdogOk, true);
  assert.equal(result.controlPlaneRecoveryOk, true);
  assert.equal(result.schemaVersion, BATTLE_BRIDGE_WORKER_WATCHDOG_RUNNER_SCHEMA);
  assert.equal(result.codexVisibilityObserved, true);
  assert.equal(result.chatGptSharedWorkspaceRelayObserved, true);
  assert.equal(result.criticalBacklogConveyorObserved, true);
  assert.equal(result.controlPlaneBootstrapRecoveryObserved, true);
  assert.equal(result.codexVisibility.classification, 'REMOTE_CODEX_VISIBILITY_RECONCILED');
  assert.equal(result.chatGptSharedWorkspaceRelay.classification, 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE');
  assert.equal(result.criticalBacklogConveyor.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.controlPlaneBootstrapRecovery.classification, 'CONTROL_PLANE_MAILBOX_HEALTHY');
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
  assert.equal(result.controlPlaneRecoveryOk, true);
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
  assert.equal(result.controlPlaneRecoveryOk, true);
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
  assert.equal(result.controlPlaneRecoveryOk, true);
  assert.equal(result.criticalBacklogConveyor.classification, 'CRITICAL_BACKLOG_CONVEYOR_FAILED');
  assert.match(result.criticalBacklogConveyor.reason, /conveyor failed/);
});

test('healthy mailbox is observed without invoking repair', async () => {
  let reconcilerCalled = false;
  let receivedStaleAfterMs = 0;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    nowMs: 1000,
    platform: 'win32',
    mailboxIndexReader: async ({ staleAfterMs }) => {
      receivedStaleAfterMs = staleAfterMs;
      return { ok: true, finalVerdict: 'MAILBOX_RECEIPT_INDEX_READ_READY' };
    },
    controlPlaneReconciler: () => {
      reconcilerCalled = true;
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_MAILBOX_HEALTHY');
  assert.equal(result.repairAttempted, false);
  assert.equal(result.sourceHead, EXACT_HEAD);
  assert.equal(reconcilerCalled, false);
  assert.equal(receivedStaleAfterMs, BATTLE_BRIDGE_CONTROL_PLANE_MAILBOX_STALE_AFTER_MS);
});

test('stale or missing mailbox index invokes only the fixed reconciler at the validated local head', async () => {
  for (const blocker of ['MAILBOX_RECEIPT_INDEX_STALE', 'MAILBOX_RECEIPT_INDEX_NOT_FOUND']) {
    const calls = [];
    const result = await runBattleBridgeControlPlaneBootstrapRecovery({
      watchdog: healthyWatchdog(),
      paths: TEST_PATHS,
      nowMs: 2000,
      platform: 'win32',
      mailboxIndexReader: async (input) => {
        calls.push(['index', input.root, input.repoRoot]);
        return { ok: false, blocker, finalVerdict: blocker };
      },
      controlPlaneReconciler: (input) => {
        calls.push(['repair', input.repoRoot, input.expectedHead, input.platform]);
        return {
          ok: true,
          finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED',
          arbitraryTaskNameAllowed: false,
          arbitraryShellAllowed: false,
          sourceMutationAllowed: false,
          gitMutationAllowed: false,
        };
      },
    });

    assert.equal(result.ok, true, blocker);
    assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIRED', blocker);
    assert.equal(result.repairAttempted, true, blocker);
    assert.deepEqual(calls, [
      ['index', TEST_PATHS.workspaceRoot, TEST_PATHS.repoRoot],
      ['repair', TEST_PATHS.repoRoot, EXACT_HEAD, 'win32'],
    ], blocker);
    assert.equal(result.arbitraryTaskNameAllowed, false);
    assert.equal(result.arbitraryShellAllowed, false);
    assert.equal(result.sourceMutationAllowed, false);
    assert.equal(result.gitMutationAllowed, false);
  }
});

test('invalid mailbox index fails closed instead of reinstalling tasks', async () => {
  let reconcilerCalled = false;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    platform: 'win32',
    mailboxIndexReader: async () => ({ ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_RECORD_INVALID' }),
    controlPlaneReconciler: () => {
      reconcilerCalled = true;
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_BLOCKED');
  assert.equal(result.repairAttempted, false);
  assert.equal(result.blocker, 'MAILBOX_RECEIPT_INDEX_RECORD_INVALID');
  assert.equal(reconcilerCalled, false);
});

test('unhealthy worker cannot trigger control-plane repair', async () => {
  let indexCalled = false;
  let reconcilerCalled = false;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: { ok: false, decision: { assessment: { healthy: false, sourceHead: EXACT_HEAD } } },
    paths: TEST_PATHS,
    mailboxIndexReader: async () => {
      indexCalled = true;
      return { ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_STALE' };
    },
    controlPlaneReconciler: () => {
      reconcilerCalled = true;
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_SKIPPED_WORKER_UNHEALTHY');
  assert.equal(result.repairAttempted, false);
  assert.equal(indexCalled, false);
  assert.equal(reconcilerCalled, false);
});

test('healthy worker without a validated exact source head cannot trigger repair', async () => {
  let indexCalled = false;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog('not-a-sha'),
    paths: TEST_PATHS,
    mailboxIndexReader: async () => {
      indexCalled = true;
      return { ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_STALE' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_SOURCE_HEAD_UNPROVEN');
  assert.equal(result.repairAttempted, false);
  assert.equal(indexCalled, false);
});

test('fixed reconciler blocker propagates without authority widening', async () => {
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    platform: 'win32',
    mailboxIndexReader: async () => ({ ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_STALE' }),
    controlPlaneReconciler: () => ({
      ok: false,
      blocker: 'CONTROL_PLANE_SOURCE_DIRT_BLOCKED',
      arbitraryTaskNameAllowed: false,
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      gitMutationAllowed: false,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_BLOCKED');
  assert.equal(result.repairAttempted, true);
  assert.equal(result.blocker, 'CONTROL_PLANE_SOURCE_DIRT_BLOCKED');
  assert.equal(result.repair.arbitraryTaskNameAllowed, false);
  assert.equal(result.repair.arbitraryShellAllowed, false);
  assert.equal(result.repair.sourceMutationAllowed, false);
  assert.equal(result.repair.gitMutationAllowed, false);
});
