import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_CONTROLLER_FLEET,
  CONTROLLER_ACTIVITY_SCHEMA_VERSION,
  createControllerActivityStatusRecord,
  projectControllerFleetTelemetry,
} from './controllerFleetTelemetryV1.mjs';

const now = '2026-09-26T00:30:00.000Z';

function activity(controller, overrides = {}) {
  return createControllerActivityStatusRecord({
    controllerId: controller.controllerId,
    title: controller.title,
    timestampUtc: now,
    runId: `run-${controller.controllerId.slice(0, 6)}`,
    executionState: 'RUNNING',
    observedEnabled: true,
    materialActionsSucceeded: 1,
    activeLanes: ['lane-1'],
    safeEligibleWorkRemaining: 0,
    proofRefs: ['proof/controller-action'],
    nextAutomaticAction: 'Refill safe capacity.',
    ...overrides,
  });
}

test('controller activity records use existing Shared Workspace status records', () => {
  const record = activity(CANONICAL_CONTROLLER_FLEET[0]);
  assert.equal(record.kind, 'stephanos.shared_workspace.status');
  assert.equal(record.relatedIssue, '#1557');
  assert.equal(record.controllerActivity.schemaVersion, CONTROLLER_ACTIVITY_SCHEMA_VERSION);
  assert.equal(record.controllerActivity.materialActionsSucceeded, 1);
  assert.deepEqual(record.proofRefs, ['proof/controller-action']);
});

test('fleet telemetry proves five canonical controllers building only with material evidence', () => {
  const statusRecords = CANONICAL_CONTROLLER_FLEET.map((controller) => activity(controller));
  const projection = projectControllerFleetTelemetry({ statusRecords, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(projection.expectedControllerCount, 5);
  assert.equal(projection.controllers.length, 5);
  assert.equal(projection.counts.building, 5);
  assert.equal(projection.counts.amber, 0);
  assert.equal(projection.counts.red, 0);
  assert.equal(projection.allObservedEnabled, true);
  assert.equal(projection.finalVerdict, 'CONTROLLER_FLEET_BUILDING_PROVEN');
});

test('claimed material activity without proof remains amber instead of green', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const projection = projectControllerFleetTelemetry({
    statusRecords: [activity(controller, { proofRefs: [] })],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[0];
  assert.equal(item.activityState, 'UNPROVEN_ACTIVITY');
  assert.equal(item.trafficLight, 'AMBER');
  assert.equal(item.blocker, 'MATERIAL_ACTIONS_LACK_PROOF_REFS');
});

test('enabled controller with safe work but no material action is classified as narration or idle debt', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[1];
  const projection = projectControllerFleetTelemetry({
    statusRecords: [activity(controller, {
      materialActionsSucceeded: 0,
      proofRefs: [],
      safeEligibleWorkRemaining: 3,
      activeLanes: [],
    })],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[1];
  assert.equal(item.activityState, 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK');
  assert.equal(item.trafficLight, 'AMBER');
  assert.equal(item.blocker, 'SAFE_ELIGIBLE_WORK_WITHOUT_MATERIAL_ACTION');
});

test('disabled and stale controllers are red while missing telemetry stays unknown', () => {
  const disabled = CANONICAL_CONTROLLER_FLEET[2];
  const stale = CANONICAL_CONTROLLER_FLEET[3];
  const statusRecords = [
    activity(disabled, { observedEnabled: false, materialActionsSucceeded: 0, proofRefs: [] }),
    createControllerActivityStatusRecord({
      controllerId: stale.controllerId,
      title: stale.title,
      timestampUtc: '2026-09-25T20:00:00.000Z',
      observedEnabled: true,
      materialActionsSucceeded: 1,
      proofRefs: ['proof/old-action'],
    }),
  ];
  const projection = projectControllerFleetTelemetry({ statusRecords, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(projection.controllers[2].activityState, 'DISABLED');
  assert.equal(projection.controllers[2].trafficLight, 'RED');
  assert.equal(projection.controllers[3].activityState, 'STALE_HEARTBEAT');
  assert.equal(projection.controllers[3].trafficLight, 'RED');
  assert.equal(projection.controllers[4].activityState, 'UNKNOWN');
  assert.equal(projection.controllers[4].trafficLight, 'UNKNOWN');
});
