import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSharedWorkspaceReceiptRecord, writeAtomicJson } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
  publishSovereignControllerActivity,
  validateSovereignControllerActivityPayload,
} from './sovereign-controller-activity-publish.mjs';

const CONTROLLER = '6a9067ac08bc8191b2d78fae5d2bfd01';

test('rejects non-canonical controller identities and unproven material lanes', () => {
  assert.throws(() => validateSovereignControllerActivityPayload({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: 'someone-else',
    runId: 'run-1',
    observedEnabled: true,
    executionState: 'RUNNING',
  }), /CONTROLLER_ACTIVITY_CONTROLLER_NOT_CANONICAL/);

  assert.throws(() => validateSovereignControllerActivityPayload({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'run-1',
    observedEnabled: true,
    executionState: 'RUNNING',
    materialLanes: [{ laneId: 'lane-1', proofRef: 'receipts/proof-1' }],
  }), /CONTROLLER_ACTIVITY_MATERIAL_LANE_PROOF_REQUIRED|CONTROLLER_ACTIVITY_MATERIAL_PROOF_REQUIRED/);
});

test('publishes a truthful enabled heartbeat without manufacturing proof', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-controller-activity-'));
  const result = await publishSovereignControllerActivity({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'heartbeat-1',
    timestampUtc: '2026-10-03T21:40:00.000Z',
    observedEnabled: true,
    executionState: 'IDLE',
    safeEligibleWorkRemaining: 0,
    nextAutomaticAction: 'Reconcile live goal truth.',
  }, { workspaceRoot: root, repoRoot: process.cwd() });

  assert.equal(result.ok, true);
  assert.equal(result.statusWritten, true);
  assert.equal(result.proofWritten, false);
  assert.equal(result.materialLaneCount, 0);
  assert.equal(result.finalVerdict, 'SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISHED');
});

test('publishes a proof-bound material lane through the canonical Shared Workspace record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-controller-activity-'));
  const timestampUtc = '2026-10-03T21:41:00.000Z';
  const receipt = createSharedWorkspaceReceiptRecord({
    receiptId: 'lane-proof-1',
    participantId: 'test',
    timestampUtc,
    correlationId: 'run-material-1',
    relatedIssue: '#1903',
    proofRefs: ['receipts/lane-proof-1'],
    receivedRecordId: 'lane-proof-1',
    disposition: 'verified',
    summary: 'Verified material lane pickup.',
  });
  assert.equal((await writeAtomicJson(root, ['receipts', 'lane-proof-1.json'], receipt, { repoRoot: process.cwd() })).ok, true);

  const result = await publishSovereignControllerActivity({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'run-material-1',
    timestampUtc,
    observedEnabled: true,
    executionState: 'RUNNING',
    materialActionsSucceeded: 0,
    activeLanes: ['lane-1'],
    materialLanes: [{
      laneId: 'lane-1',
      goalId: '#1903',
      resourceId: 'controller-activity',
      lastMaterialAction: 'PICKUP_VERIFIED',
      lastMaterialActionAtUtc: timestampUtc,
      proofRef: 'receipts/lane-proof-1',
      nextAutomaticAction: 'Continue canonical work.',
    }],
    proofRefs: ['receipts/lane-proof-1'],
  }, { workspaceRoot: root, repoRoot: process.cwd() });

  assert.equal(result.ok, true);
  assert.equal(result.proofWritten, true);
  assert.equal(result.materialLaneCount, 1);
});
