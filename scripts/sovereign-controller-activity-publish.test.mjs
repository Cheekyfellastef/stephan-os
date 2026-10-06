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

const CONTROLLER = '6ac3999164b88191a1c866c70ab51bd7';
const RETIRED_CONTROLLER = '6a9bb24c04748191ada675a686f3b3fa';

test('rejects non-canonical controller identities and unproven material lanes', () => {
  assert.throws(() => validateSovereignControllerActivityPayload({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: RETIRED_CONTROLLER,
    runId: 'retired-run',
    observedEnabled: true,
    executionState: 'IDLE',
  }), /CONTROLLER_ACTIVITY_CONTROLLER_NOT_CANONICAL/);

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

test('bounds long controller narrative instead of dropping the whole heartbeat', () => {
  const nextAutomaticAction =
    'recover or terminalize the stale canonical fast-mailbox receipt, refresh controller-lane-status at current main, then refill both safe runnable lanes through their canonical owners; VR-owned lane remains idle until scheduler exposes eligible VR work';
  assert.ok(nextAutomaticAction.length > 240);
  const payload = validateSovereignControllerActivityPayload({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'bounded-narrative-1',
    observedEnabled: true,
    executionState: 'BLOCKED',
    safeEligibleWorkRemaining: 2,
    blocker: 'FAST_MAILBOX_STALE_ACCEPTED_RECEIPT',
    nextAutomaticAction,
  });
  assert.equal(payload.nextAutomaticAction.length, 240);
  assert.equal(payload.nextAutomaticAction, nextAutomaticAction.slice(0, 240));

  assert.throws(() => validateSovereignControllerActivityPayload({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'bounded-narrative-control-char',
    observedEnabled: true,
    executionState: 'BLOCKED',
    nextAutomaticAction: 'safe\nunsafe',
  }), /CONTROLLER_ACTIVITY_NEXT_ACTION_INVALID/);
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


test('preserves count-only active and parked lane telemetry without manufacturing lane identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-controller-activity-counts-'));
  const payload = validateSovereignControllerActivityPayload({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'count-only-1',
    timestampUtc: '2026-10-03T22:40:00.000Z',
    observedEnabled: true,
    executionState: 'BLOCKED',
    activeLanes: [],
    parkedLanes: [],
    activeLaneCount: 2,
    parkedLaneCount: 1,
    safeEligibleWorkRemaining: 1,
    blocker: 'WAITING_FOR_CURRENT_OWNER',
  });
  assert.deepEqual(payload.activeLanes, []);
  assert.deepEqual(payload.parkedLanes, []);
  assert.equal(payload.activeLaneCount, 2);
  assert.equal(payload.parkedLaneCount, 1);

  const result = await publishSovereignControllerActivity({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'count-only-1',
    timestampUtc: '2026-10-03T22:40:00.000Z',
    observedEnabled: true,
    executionState: 'BLOCKED',
    activeLanes: [],
    parkedLanes: [],
    activeLaneCount: 2,
    parkedLaneCount: 1,
    safeEligibleWorkRemaining: 1,
    blocker: 'WAITING_FOR_CURRENT_OWNER',
  }, { workspaceRoot: root, repoRoot: process.cwd() });
  assert.equal(result.ok, true);
  assert.equal(result.statusRecord.controllerActivity.activeLaneCount, 2);
  assert.equal(result.statusRecord.controllerActivity.parkedLaneCount, 1);
  assert.deepEqual(result.statusRecord.controllerActivity.activeLanes, []);
  assert.deepEqual(result.statusRecord.controllerActivity.parkedLanes, []);

  assert.throws(() => validateSovereignControllerActivityPayload({
    schemaVersion: SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISH_SCHEMA,
    controllerId: CONTROLLER,
    runId: 'count-too-large',
    observedEnabled: true,
    executionState: 'RUNNING',
    activeLaneCount: 16,
  }), /CONTROLLER_ACTIVITY_LANE_COUNT_INVALID/);
});
