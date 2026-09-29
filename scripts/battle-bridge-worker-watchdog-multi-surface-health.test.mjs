import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runBattleBridgeControlPlaneBootstrapRecovery,
} from './battle-bridge-worker-watchdog-runner.mjs';

const EXACT_HEAD = 'b'.repeat(40);
const NOW = Date.parse('2026-09-09T16:00:00.000Z');
const NOW_ISO = new Date(NOW).toISOString();
const TEST_PATHS = Object.freeze({
  repoRoot: '/canonical/repo',
  workspaceRoot: '/canonical/workspace',
});

function healthyWatchdog() {
  return {
    ok: true,
    classification: 'WORKER_WATCHDOG_HEALTHY',
    decision: {
      assessment: {
        healthy: true,
        sourceHead: EXACT_HEAD,
      },
    },
  };
}

function healthyMailbox() {
  return {
    ok: true,
    finalVerdict: 'MAILBOX_RECEIPT_INDEX_READ_READY',
    observedAtUtc: NOW_ISO,
  };
}

function healthyMesh() {
  return {
    classification: 'RECOVERY_MESH_ALL_SERVICES_HEALTHY',
    timestampUtc: NOW_ISO,
  };
}

function healthyLifeboat() {
  return {
    schemaVersion: 'stephanos.battle-bridge-recovery-lifeboat-heartbeat.v1',
    bankId: 'A',
    manifestSha256: 'c'.repeat(64),
    completedAtUtc: NOW_ISO,
    healthy: true,
    payloadVerified: true,
    arbitraryShellAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
  };
}

test('all-green mailbox, Recovery Mesh and Recovery Lifeboat remain a no-op', async () => {
  let reconcilerCalled = false;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    nowMs: NOW,
    platform: 'win32',
    mailboxIndexReader: async () => healthyMailbox(),
    recoveryMeshStatusReader: async () => healthyMesh(),
    recoveryLifeboatHeartbeatReader: async () => healthyLifeboat(),
    controlPlaneReconciler: () => {
      reconcilerCalled = true;
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_MAILBOX_HEALTHY');
  assert.equal(result.repairAttempted, false);
  assert.equal(result.healthAssessment.allRequiredHealthy, true);
  assert.equal(reconcilerCalled, false);
});

test('healthy mailbox cannot mask a blocked Recovery Mesh', async () => {
  const calls = [];
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    nowMs: NOW,
    platform: 'win32',
    mailboxIndexReader: async () => healthyMailbox(),
    recoveryMeshStatusReader: async () => ({
      classification: 'RECOVERY_MESH_CORE_UNHEALTHY',
      blocker: 'RECOVERY_MESH_TASK_MISSING',
      timestampUtc: NOW_ISO,
    }),
    recoveryLifeboatHeartbeatReader: async () => healthyLifeboat(),
    controlPlaneReconciler: (input) => {
      calls.push(input);
      return {
        ok: true,
        finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIRED');
  assert.equal(result.repairAttempted, true);
  assert.deepEqual(result.healthAssessment.repairCandidates.map((entry) => entry.id), ['recoveryMesh']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, TEST_PATHS.repoRoot);
  assert.equal(calls[0].expectedHead, EXACT_HEAD);
  assert.equal(calls[0].platform, 'win32');
});

test('healthy mailbox cannot mask a missing Recovery Lifeboat heartbeat', async () => {
  let reconcilerCalled = false;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    nowMs: NOW,
    platform: 'win32',
    mailboxIndexReader: async () => healthyMailbox(),
    recoveryMeshStatusReader: async () => healthyMesh(),
    recoveryLifeboatHeartbeatReader: async () => undefined,
    controlPlaneReconciler: () => {
      reconcilerCalled = true;
      return { ok: true, finalVerdict: 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIRED');
  assert.equal(result.repairAttempted, true);
  assert.equal(reconcilerCalled, true);
  assert.deepEqual(result.healthAssessment.repairCandidates.map((entry) => entry.id), ['recoveryLifeboat']);
});

test('malformed Recovery Lifeboat evidence hard-holds and cannot invoke repair', async () => {
  let reconcilerCalled = false;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    nowMs: NOW,
    platform: 'win32',
    mailboxIndexReader: async () => healthyMailbox(),
    recoveryMeshStatusReader: async () => healthyMesh(),
    recoveryLifeboatHeartbeatReader: async () => ({
      schemaVersion: 'stephanos.battle-bridge-recovery-lifeboat-heartbeat.v1',
      completedAtUtc: '',
      healthy: true,
      payloadVerified: true,
      arbitraryShellAllowed: false,
      gitMutationAllowed: false,
      sourceMutationAllowed: false,
      pcRestartAllowed: false,
    }),
    controlPlaneReconciler: () => {
      reconcilerCalled = true;
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_BLOCKED');
  assert.equal(result.repairAttempted, false);
  assert.equal(result.healthAssessment.classification, 'CONTROL_PLANE_BOOTSTRAP_HEALTH_EVIDENCE_BLOCKED');
  assert.equal(reconcilerCalled, false);
});

test('non-repairable mailbox corruption remains fail-closed before multi-surface routing', async () => {
  let meshCalled = false;
  let lifeboatCalled = false;
  let reconcilerCalled = false;
  const result = await runBattleBridgeControlPlaneBootstrapRecovery({
    watchdog: healthyWatchdog(),
    paths: TEST_PATHS,
    nowMs: NOW,
    platform: 'win32',
    mailboxIndexReader: async () => ({
      ok: false,
      blocker: 'MAILBOX_RECEIPT_INDEX_RECORD_INVALID',
      observedAtUtc: NOW_ISO,
    }),
    recoveryMeshStatusReader: async () => {
      meshCalled = true;
      return healthyMesh();
    },
    recoveryLifeboatHeartbeatReader: async () => {
      lifeboatCalled = true;
      return healthyLifeboat();
    },
    controlPlaneReconciler: () => {
      reconcilerCalled = true;
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_BLOCKED');
  assert.equal(result.blocker, 'MAILBOX_RECEIPT_INDEX_RECORD_INVALID');
  assert.equal(result.repairAttempted, false);
  assert.equal(meshCalled, false);
  assert.equal(lifeboatCalled, false);
  assert.equal(reconcilerCalled, false);
});
