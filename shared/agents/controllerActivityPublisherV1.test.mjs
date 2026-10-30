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
