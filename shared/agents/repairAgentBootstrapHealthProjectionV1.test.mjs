import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRepairAgentBootstrapHealthProjectionV1,
  projectRepairAgentBootstrapCanonicalEvidenceV1,
} from './repairAgentBootstrapHealthProjectionV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-09-09T09:00:00.000Z';

function healthy() {
  return { state: 'HEALTHY', observedAtUtc: NOW };
}

function healthyMailboxIndex() {
  return { ok: true, timestampUtc: NOW, finalVerdict: 'MAILBOX_RECEIPT_INDEX_READ_READY' };
}

function healthyRecoveryMesh() {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.status',
    statusId: 'battle-bridge-recovery-mesh-current',
    timestampUtc: NOW,
    status: 'RECOVERY_MESH_ALL_SERVICES_HEALTHY',
    classification: 'RECOVERY_MESH_ALL_SERVICES_HEALTHY',
    meshSchema: 'stephanos.battle-bridge-recovery-mesh-runner.v1',
    proofRefs: ['receipts/battle-bridge-recovery-mesh/proof.json'],
    final: {
      workerHealthy: true,
      mailboxHealthy: true,
      backendHealthy: true,
      gatewayHealthy: true,
      sourceHead: HEAD,
      branch: 'main',
    },
    oneExecutorEnforced: true,
    duplicateWorkerAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryTaskNameAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  };
}

function healthyRecoveryLifeboat() {
  return {
    schemaVersion: 'stephanos.battle-bridge-recovery-lifeboat-heartbeat.v1',
    completedAtUtc: NOW,
    healthy: true,
    payloadVerified: true,
    arbitraryShellAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
  };
}

test('all three bootstrap surfaces healthy remains no-op eligible', () => {
  const result = evaluateRepairAgentBootstrapHealthProjectionV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    githubCommandMailbox: healthy(),
    recoveryMesh: healthy(),
    recoveryLifeboat: healthy(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_ALL_REQUIRED_HEALTHY');
  assert.equal(result.allRequiredHealthy, true);
  assert.equal(result.repairCandidates.length, 0);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
});

test('healthy mailbox cannot mask stale Recovery Mesh', () => {
  const result = evaluateRepairAgentBootstrapHealthProjectionV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    githubCommandMailbox: healthy(),
    recoveryMesh: { state: 'HEALTHY', observedAtUtc: '2026-09-09T08:00:00.000Z' },
    recoveryLifeboat: healthy(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIR_REQUIRED');
  assert.equal(result.allRequiredHealthy, false);
  assert.deepEqual(result.repairCandidates.map((entry) => entry.id), ['recoveryMesh']);
  assert.equal(result.repairCandidates[0].state, 'STALE');
  assert.equal(result.repairCandidates[0].repairRoute, 'CONTROL_PLANE_SELF_REPAIR');
});

test('missing lifeboat evidence requires repair rather than inferring health', () => {
  const result = evaluateRepairAgentBootstrapHealthProjectionV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    githubCommandMailbox: healthy(),
    recoveryMesh: healthy(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIR_REQUIRED');
  assert.deepEqual(result.repairCandidates.map((entry) => entry.id), ['recoveryLifeboat']);
  assert.equal(result.repairCandidates[0].state, 'MISSING');
});

test('canonical raw evidence keeps all-green bootstrap no-op eligible', () => {
  const result = projectRepairAgentBootstrapCanonicalEvidenceV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    mailboxIndex: healthyMailboxIndex(),
    recoveryMeshStatus: healthyRecoveryMesh(),
    recoveryLifeboatHeartbeat: healthyRecoveryLifeboat(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_ALL_REQUIRED_HEALTHY');
  assert.equal(result.allRequiredHealthy, true);
  assert.deepEqual(result.repairCandidates, []);
});

test('healthy Recovery Mesh classification requires the complete canonical status envelope', () => {
  const mutations = [
    (record) => { delete record.schemaVersion; },
    (record) => { delete record.kind; },
    (record) => { delete record.statusId; },
    (record) => { delete record.meshSchema; },
    (record) => { record.status = 'RECOVERY_MESH_CORE_UNHEALTHY'; },
    (record) => { record.proofRefs = []; },
    (record) => { delete record.final.gatewayHealthy; },
    (record) => { record.final.sourceHead = ''; },
    (record) => { record.oneExecutorEnforced = false; },
    (record) => { record.duplicateWorkerAllowed = true; },
    (record) => { record.arbitraryShellAllowed = true; },
    (record) => { record.arbitraryTaskNameAllowed = true; },
    (record) => { record.sourceMutationAllowed = true; },
    (record) => { record.mergeAuthority = true; },
  ];

  for (const mutate of mutations) {
    const recoveryMeshStatus = JSON.parse(JSON.stringify(healthyRecoveryMesh()));
    mutate(recoveryMeshStatus);
    const result = projectRepairAgentBootstrapCanonicalEvidenceV1({
      expectedHead: HEAD,
      observedAtUtc: NOW,
      mailboxIndex: healthyMailboxIndex(),
      recoveryMeshStatus,
      recoveryLifeboatHeartbeat: healthyRecoveryLifeboat(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_HEALTH_EVIDENCE_BLOCKED');
    assert.equal(result.allRequiredHealthy, false);
    assert.equal(result.systems.find((entry) => entry.id === 'recoveryMesh')?.state, 'HARD_HOLD');
    assert.equal(result.runtimeMutationAuthority, false);
    assert.equal(result.sourceMutationAuthority, false);
    assert.equal(result.mergeAuthority, false);
  }
});

test('canonical raw evidence cannot let mailbox green mask Recovery Mesh failure', () => {
  const result = projectRepairAgentBootstrapCanonicalEvidenceV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    mailboxIndex: healthyMailboxIndex(),
    recoveryMeshStatus: {
      classification: 'RECOVERY_MESH_REPAIR_REQUIRED',
      blocker: 'RECOVERY_MESH_TASK_MISSING',
      timestampUtc: NOW,
    },
    recoveryLifeboatHeartbeat: healthyRecoveryLifeboat(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIR_REQUIRED');
  assert.deepEqual(result.repairCandidates.map((entry) => entry.id), ['recoveryMesh']);
  assert.equal(result.repairCandidates[0].state, 'BLOCKED');
  assert.equal(result.repairCandidates[0].repairRoute, 'CONTROL_PLANE_SELF_REPAIR');
});

test('missing canonical Lifeboat heartbeat requires fixed control-plane repair route', () => {
  const result = projectRepairAgentBootstrapCanonicalEvidenceV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    mailboxIndex: healthyMailboxIndex(),
    recoveryMeshStatus: healthyRecoveryMesh(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_REPAIR_REQUIRED');
  assert.deepEqual(result.repairCandidates.map((entry) => entry.id), ['recoveryLifeboat']);
  assert.equal(result.repairCandidates[0].state, 'MISSING');
  assert.equal(result.repairCandidates[0].repairRoute, 'CONTROL_PLANE_SELF_REPAIR');
});

test('malformed Lifeboat heartbeat fails closed rather than manufacturing health', () => {
  const heartbeat = healthyRecoveryLifeboat();
  heartbeat.completedAtUtc = '';
  const result = projectRepairAgentBootstrapCanonicalEvidenceV1({
    expectedHead: HEAD,
    observedAtUtc: NOW,
    mailboxIndex: healthyMailboxIndex(),
    recoveryMeshStatus: healthyRecoveryMesh(),
    recoveryLifeboatHeartbeat: heartbeat,
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CONTROL_PLANE_BOOTSTRAP_HEALTH_EVIDENCE_BLOCKED');
  assert.equal(result.allRequiredHealthy, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
});
