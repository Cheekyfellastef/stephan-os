import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CANONICAL_CONTROLLER_FLEET,
  projectControllerFleetTelemetry,
} from './controllerFleetTelemetryV1.mjs';
import { publishControllerActivityV1 } from './controllerActivityPublisherV1.mjs';
import { createSharedWorkspaceReceiptRecord, writeAtomicJson } from './sharedAgentWorkspaceStore.mjs';

async function workspace() {
  return mkdtemp(join(tmpdir(), 'controller-activity-publisher-'));
}

test('publishes proof-bound material activity for a canonical controller', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const timestampUtc = '2026-09-27T00:30:00.000Z';
  const receipt = createSharedWorkspaceReceiptRecord({
    receiptId: 'controller-run-material-1', participantId: 'test', timestampUtc,
    correlationId: 'run-material-1', relatedIssue: '#1557', proofRefs: ['receipts/controller-run-material-1'],
    receivedRecordId: 'source-change-1', disposition: 'verified', summary: 'Verified source change and focused tests.',
  });
  const receiptWrite = await writeAtomicJson(root, ['receipts', 'controller-run-material-1.json'], receipt, { repoRoot: process.cwd() });
  assert.equal(receiptWrite.ok, true);
  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId,
    runId: 'run-material-1',
    timestampUtc,
    observedEnabled: true,
    executionState: 'RUNNING',
    materialActionsSucceeded: 1,
    goalsAdvanced: 1,
    sourceChanges: 1,
    activeLanes: ['lane-1'],
    materialLanes: [{
      laneId: 'lane-1',
      goalId: '#1557',
      resourceId: 'controller-activity-producer',
      lastMaterialAction: 'SOURCE_CHANGED_AND_TESTED',
      lastMaterialActionAtUtc: timestampUtc,
      proofRef: 'receipts/controller-run-material-1',
    }],
    safeEligibleWorkRemaining: 2,
    lastMaterialActionAtUtc: timestampUtc,
    nextAutomaticAction: 'Continue work-conserving refill.',
    proofRefs: ['receipts/controller-run-material-1'],
  }, { workspaceRoot: root, repoRoot: process.cwd() });

  assert.equal(result.ok, true);
  assert.equal(result.proofWritten, true);
  assert.equal(result.statusWritten, true);

  const projection = projectControllerFleetTelemetry({
    statusRecords: [result.statusRecord],
    proofRecords: [result.proofRecord],
    nowMs: Date.parse(timestampUtc) + 1000,
  });
  assert.equal(projection.controllers[0].activityState, 'BUILDING');
  assert.equal(projection.controllers[0].trafficLight, 'GREEN');
  assert.equal(projection.controllers[0].materialActionsSucceeded, 1);
  assert.equal(projection.metrics.ACTIVE_MATERIAL_LANES, 1);
});

test('publishes truthful idle activity without manufacturing a proof', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[1];
  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId,
    runId: 'run-idle-1',
    timestampUtc: '2026-09-27T00:31:00.000Z',
    observedEnabled: true,
    executionState: 'IDLE',
    materialActionsSucceeded: 0,
    safeEligibleWorkRemaining: 3,
  }, { workspaceRoot: root, repoRoot: process.cwd() });

  assert.equal(result.ok, true);
  assert.equal(result.proofWritten, false);
  assert.equal(result.proofRecord, null);
  assert.equal(result.statusRecord.controllerActivity.safeEligibleWorkRemaining, 3);
});

test('rejects material activity without proof references', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[2];
  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId,
    runId: 'run-unproven-1',
    observedEnabled: true,
    executionState: 'RUNNING',
    materialActionsSucceeded: 1,
  }, { workspaceRoot: root, repoRoot: process.cwd() });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROLLER_ACTIVITY_MATERIAL_PROOF_REQUIRED');
});

test('rejects unknown controller identities', async () => {
  const root = await workspace();
  const result = await publishControllerActivityV1({
    controllerId: 'not-a-canonical-controller',
    runId: 'run-unknown-1',
  }, { workspaceRoot: root, repoRoot: process.cwd() });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROLLER_ACTIVITY_CONTROLLER_NOT_CANONICAL');
});


test('rejects a claimed proof reference that does not exist', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId, runId: 'run-missing-proof', materialActionsSucceeded: 1,
    proofRefs: ['receipts/does-not-exist'],
  }, { workspaceRoot: root, repoRoot: process.cwd() });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROLLER_ACTIVITY_PROOF_REF_UNAVAILABLE');
});

test('preserves absent enablement and execution observations as unknown', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[1];
  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId, runId: 'run-unknown-observation',
    timestampUtc: '2026-09-27T00:32:00.000Z', materialActionsSucceeded: 0,
  }, { workspaceRoot: root, repoRoot: process.cwd() });
  assert.equal(result.ok, true);
  assert.equal(result.statusRecord.controllerActivity.observedEnabled, null);
  assert.equal(result.statusRecord.controllerActivity.executionState, 'UNKNOWN');
});

test('canonical publisher carries detached worker signature from original terminal receipt but never invents one', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const runId = 'run-signed-3050';
  const proofRef = 'receipts/worker-goal3050-pickup';
  const proofId = `controller-${controller.controllerId.slice(0, 12)}-run-${runId}`;
  const timestampUtc = '2026-10-18T17:45:00.000Z';
  const workerPickupAttestation = {
    schemaVersion: 'stephanos.physical-worker-goal-pickup.v1',
    publisherId: 'stephanos-physical-worker',
    sourceHead: 'a'.repeat(40),
    goalIssue: '#3050',
    logicalLaneId: 'logical-goal-3050',
    controllerId: controller.controllerId,
    runId, proofId, proofRef, observedAtUtc: timestampUtc,
    workerId: 'physical-worker-01',
    // Syntactically present but NOT cryptographically valid. The publisher
    // only preserves the bytes; Core's pinned-key verifier must reject it.
    signatureBase64: 'A'.repeat(86) + '==',
  };
  const original = {
    ...createSharedWorkspaceReceiptRecord({
      receiptId: 'worker-goal3050-pickup', participantId: 'physical-worker-01',
      timestampUtc, correlationId: runId, relatedIssue: '#3050',
      proofRefs: [proofRef], receivedRecordId: 'physical-pickup-3050',
      disposition: 'verified', summary: 'Worker claims physical pickup',
    }),
    workerPickupAttestation,
  };
  assert.equal((await writeAtomicJson(root, ['receipts', 'worker-goal3050-pickup.json'],
    original, { repoRoot: process.cwd() })).ok, true);
  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId, runId, timestampUtc,
    observedEnabled: true, executionState: 'RUNNING', materialActionsSucceeded: 1,
    proofRefs: [proofRef], materialLanes: [{
      laneId: 'lane-3050', goalId: '#3050', workerId: 'physical-worker-01',
      lastMaterialActionAtUtc: timestampUtc, proofRef,
    }],
  }, { workspaceRoot: root, repoRoot: process.cwd() });
  assert.equal(result.ok, true, result.blocker);
  assert.deepEqual(result.proofRecord.workerPickupAttestation, workerPickupAttestation);
  assert.equal(Object.isFrozen(result.proofRecord.workerPickupAttestation), true);
});

test('canonical publisher rejects a detached worker signature bound to the wrong run', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const runId = 'run-signed-3050-b';
  const proofRef = 'receipts/worker-goal3050-wrong-run';
  const original = {
    ...createSharedWorkspaceReceiptRecord({
      receiptId: 'worker-goal3050-wrong-run', participantId: 'physical-worker-01',
      timestampUtc: '2026-10-18T17:45:00.000Z', correlationId: runId,
      relatedIssue: '#3050', proofRefs: [proofRef], receivedRecordId: 'physical-pickup-3050',
      disposition: 'verified',
    }),
    workerPickupAttestation: {
      schemaVersion: 'stephanos.physical-worker-goal-pickup.v1',
      publisherId: 'stephanos-physical-worker', runId: 'different-run',
      controllerId: controller.controllerId, proofRef,
      sourceHead: 'a'.repeat(40), signatureBase64: 'A'.repeat(86) + '==',
    },
  };
  assert.equal((await writeAtomicJson(root, ['receipts', 'worker-goal3050-wrong-run.json'],
    original, { repoRoot: process.cwd() })).ok, true);
  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId, runId,
    materialActionsSucceeded: 1, proofRefs: [proofRef],
  }, { workspaceRoot: root, repoRoot: process.cwd() });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROLLER_ACTIVITY_WORKER_ATTESTATION_BINDING_INVALID');
});

test('accepts an existing .json-suffixed terminal receipt proof reference without appending another extension', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const timestampUtc = '2026-10-21T16:00:00.000Z';
  const runId = 'run-explicit-json-receipt-1';
  const receiptId = 'controller-run-explicit-json-1';
  const proofRef = `receipts/${receiptId}.json`;
  const receipt = createSharedWorkspaceReceiptRecord({
    receiptId, participantId: 'physical-receipt-provider', timestampUtc,
    correlationId: runId, relatedIssue: '#3050', proofRefs: [proofRef],
    receivedRecordId: 'verified-source-change', disposition: 'verified',
    summary: 'Existing terminal receipt, with explicit JSON filename.',
  });
  assert.equal((await writeAtomicJson(root, ['receipts', `${receiptId}.json`],
    receipt, { repoRoot: process.cwd() })).ok, true);

  const result = await publishControllerActivityV1({
    controllerId: controller.controllerId, runId, timestampUtc,
    observedEnabled: true, executionState: 'RUNNING',
    materialActionsSucceeded: 1, proofRefs: [proofRef],
  }, { workspaceRoot: root, repoRoot: process.cwd() });

  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.proofWritten, true);
  assert.deepEqual(result.statusRecord.controllerActivity.proofRefs, [proofRef]);
  assert.ok(result.proofRecord.refs.includes(proofRef));
});

test('an ACCEPTED command receipt never qualifies as completed controller construction', async () => {
  const root = await workspace();
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const runId = 'run-admission-is-not-material-work';
  const receiptId = 'controller-admission-only';
  const ref = `receipts/${receiptId}.json`;
  const timestampUtc = '2026-10-21T17:00:00.000Z';
  const pending = createSharedWorkspaceReceiptRecord({
    receiptId, participantId: 'test', timestampUtc,
    correlationId: runId, relatedIssue: '#3050', proofRefs: [ref],
    receivedRecordId: 'dispatch-accepted', disposition: 'accepted',
    summary: 'The scheduler accepted a command; no worker edit or commit happened.',
  });
  assert.equal((await writeAtomicJson(root, ['receipts', `${receiptId}.json`],
    pending, { repoRoot: process.cwd() })).ok, true);
  const published = await publishControllerActivityV1({
    controllerId: controller.controllerId, runId, timestampUtc,
    observedEnabled: true, executionState: 'RUNNING',
    materialActionsSucceeded: 1, proofRefs: [ref],
  }, { workspaceRoot: root, repoRoot: process.cwd() });
  assert.equal(published.ok, false);
  assert.equal(published.blocker, 'CONTROLLER_ACTIVITY_PROOF_REF_NOT_TERMINAL_PASS');
  assert.equal(published.proofRecord, undefined);
});
