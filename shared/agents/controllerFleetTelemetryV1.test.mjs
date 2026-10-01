import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_CONTROLLER_FLEET,
  CONTROLLER_ACTIVITY_PROOF_SCHEMA_VERSION,
  CONTROLLER_ACTIVITY_SCHEMA_VERSION,
  createControllerActivityProofRecord,
  createControllerActivityStatusRecord,
  projectControllerFleetTelemetry,
} from './controllerFleetTelemetryV1.mjs';

const now = '2026-09-26T00:30:00.000Z';

function runId(controller) {
  return `run-${controller.controllerId.slice(0, 6)}`;
}

function proofRef(controller) {
  return `proof/controller-${controller.controllerId.slice(0, 6)}`;
}

function activity(controller, overrides = {}) {
  return createControllerActivityStatusRecord({
    controllerId: controller.controllerId,
    title: controller.title,
    timestampUtc: now,
    runId: runId(controller),
    executionState: 'RUNNING',
    observedEnabled: true,
    materialActionsSucceeded: 1,
    activeLanes: ['lane-1'],
    safeEligibleWorkRemaining: 0,
    proofRefs: [proofRef(controller)],
    nextAutomaticAction: 'Refill safe capacity.',
    ...overrides,
  });
}

function proof(controller, overrides = {}) {
  return createControllerActivityProofRecord({
    controllerId: controller.controllerId,
    runId: runId(controller),
    proofId: `controller-${controller.controllerId.slice(0, 6)}`,
    proofRef: proofRef(controller),
    timestampUtc: now,
    materialActionsSucceeded: 1,
    status: 'PASS',
    ...overrides,
  });
}

test('controller activity records use existing Shared Workspace status records and preserve unknown enablement', () => {
  const record = createControllerActivityStatusRecord({
    controllerId: CANONICAL_CONTROLLER_FLEET[0].controllerId,
    timestampUtc: now,
    runId: 'run-one',
    materialActionsSucceeded: 0,
  });
  assert.equal(record.kind, 'stephanos.shared_workspace.status');
  assert.equal(record.relatedIssue, '#1557');
  assert.equal(record.controllerActivity.schemaVersion, CONTROLLER_ACTIVITY_SCHEMA_VERSION);
  assert.equal(record.controllerActivity.materialActionsSucceeded, 0);
  assert.equal(record.controllerActivity.observedEnabled, null);
});

test('controller activity proof records bind PASS evidence to one controller and one run', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const record = proof(controller);
  assert.equal(record.kind, 'stephanos.shared_workspace.proof');
  assert.equal(record.status, 'PASS');
  assert.equal(record.correlationId, runId(controller));
  assert.equal(record.controllerActivityProof.schemaVersion, CONTROLLER_ACTIVITY_PROOF_SCHEMA_VERSION);
  assert.equal(record.controllerActivityProof.controllerId, controller.controllerId);
  assert.equal(record.controllerActivityProof.runId, runId(controller));
  assert.ok(record.proofRefs.includes(proofRef(controller)));
});

test('fleet telemetry proves five canonical controllers building only with current run-bound PASS evidence', () => {
  const statusRecords = CANONICAL_CONTROLLER_FLEET.map((controller) => activity(controller));
  const proofRecords = CANONICAL_CONTROLLER_FLEET.map((controller) => proof(controller));
  const projection = projectControllerFleetTelemetry({ statusRecords, proofRecords, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(projection.expectedControllerCount, 5);
  assert.equal(projection.controllers.length, 5);
  assert.equal(projection.counts.building, 5);
  assert.equal(projection.counts.amber, 0);
  assert.equal(projection.counts.red, 0);
  assert.equal(projection.allObservedEnabled, true);
  assert.equal(projection.finalVerdict, 'CONTROLLER_FLEET_BUILDING_PROVEN');
});

test('claimed material activity without matching proof record remains amber instead of green', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const projection = projectControllerFleetTelemetry({
    statusRecords: [activity(controller)],
    proofRecords: [],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[0];
  assert.equal(item.activityState, 'UNPROVEN_ACTIVITY');
  assert.equal(item.trafficLight, 'AMBER');
  assert.equal(item.blocker, 'MATERIAL_ACTIONS_LACK_VERIFIED_PROOF');
  assert.deepEqual(item.proofRefs, []);
  assert.deepEqual(item.claimedProofRefs, [proofRef(controller)]);
});

test('stale failing wrong-run and wrong-controller proof cannot make BUILDING green', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const other = CANONICAL_CONTROLLER_FLEET[1];
  const badProofs = [
    proof(controller, { timestampUtc: '2026-09-25T20:00:00.000Z' }),
    proof(controller, { status: 'BLOCKED' }),
    proof(controller, { runId: 'different-run' }),
    proof(other, { proofRef: proofRef(controller), proofId: 'wrong-controller' }),
  ];
  const projection = projectControllerFleetTelemetry({
    statusRecords: [activity(controller)],
    proofRecords: badProofs,
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  assert.equal(projection.controllers[0].activityState, 'UNPROVEN_ACTIVITY');
  assert.equal(projection.controllers[0].trafficLight, 'AMBER');
});

test('blocked execution outranks earlier proof-backed material actions', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const projection = projectControllerFleetTelemetry({
    statusRecords: [activity(controller, {
      executionState: 'BLOCKED',
      blocker: 'LEASE_LOST',
      materialActionsSucceeded: 2,
    })],
    proofRecords: [proof(controller)],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[0];
  assert.equal(item.activityState, 'WAITING_OR_BLOCKED');
  assert.equal(item.trafficLight, 'AMBER');
  assert.equal(item.blocker, 'LEASE_LOST');
  assert.equal(item.materialActionsSucceeded, 2);
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
    proofRecords: [],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[1];
  assert.equal(item.activityState, 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK');
  assert.equal(item.trafficLight, 'AMBER');
  assert.equal(item.blocker, 'SAFE_ELIGIBLE_WORK_WITHOUT_MATERIAL_ACTION');
});

test('five current enabled idle controllers are healthy idle, never building proven', () => {
  const statusRecords = CANONICAL_CONTROLLER_FLEET.map((controller) => activity(controller, {
    materialActionsSucceeded: 0,
    proofRefs: [],
    activeLanes: [],
    parkedLanes: [],
    safeEligibleWorkRemaining: 0,
  }));
  const projection = projectControllerFleetTelemetry({
    statusRecords,
    proofRecords: [],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  assert.equal(projection.counts.building, 0);
  assert.equal(projection.finalVerdict, 'CONTROLLER_FLEET_HEALTHY_IDLE');
});

test('omitted enablement evidence remains unknown even when action and proof exist', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const statusRecord = activity(controller);
  const missingEnablement = {
    ...statusRecord,
    controllerActivity: {
      ...statusRecord.controllerActivity,
      observedEnabled: null,
    },
  };
  const projection = projectControllerFleetTelemetry({
    statusRecords: [missingEnablement],
    proofRecords: [proof(controller)],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[0];
  assert.equal(item.activityState, 'ENABLEMENT_UNKNOWN');
  assert.equal(item.trafficLight, 'UNKNOWN');
  assert.equal(item.blocker, 'CONTROLLER_ENABLEMENT_EVIDENCE_MISSING');
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
      runId: runId(stale),
      observedEnabled: true,
      materialActionsSucceeded: 1,
      proofRefs: [proofRef(stale)],
    }),
  ];
  const projection = projectControllerFleetTelemetry({ statusRecords, proofRecords: [], nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(projection.controllers[2].activityState, 'DISABLED');
  assert.equal(projection.controllers[2].trafficLight, 'RED');
  assert.equal(projection.controllers[3].activityState, 'STALE_HEARTBEAT');
  assert.equal(projection.controllers[3].trafficLight, 'RED');
  assert.equal(projection.controllers[4].activityState, 'UNKNOWN');
  assert.equal(projection.controllers[4].trafficLight, 'UNKNOWN');
});


test('proof must certify the same material action count claimed by the controller receipt', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const projection = projectControllerFleetTelemetry({
    statusRecords: [activity(controller, { materialActionsSucceeded: 2 })],
    proofRecords: [proof(controller, { materialActionsSucceeded: 1 })],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[0];
  assert.equal(item.activityState, 'UNPROVEN_ACTIVITY');
  assert.equal(item.trafficLight, 'AMBER');
  assert.equal(item.blocker, 'MATERIAL_ACTIONS_LACK_VERIFIED_PROOF');
});

test('unknown or conflicting execution state cannot become green from valid action proof', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const unknown = projectControllerFleetTelemetry({
    statusRecords: [activity(controller, { executionState: 'MYSTERY' })],
    proofRecords: [proof(controller)],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  }).controllers[0];
  assert.equal(unknown.activityState, 'EXECUTION_STATE_UNKNOWN');
  assert.equal(unknown.trafficLight, 'UNKNOWN');

  const base = activity(controller);
  const conflict = projectControllerFleetTelemetry({
    statusRecords: [{ ...base, status: 'BLOCKED' }],
    proofRecords: [proof(controller)],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  }).controllers[0];
  assert.equal(conflict.activityState, 'EXECUTION_STATE_CONFLICT');
  assert.equal(conflict.trafficLight, 'RED');
  assert.equal(conflict.blocker, 'CONTROLLER_EXECUTION_STATE_CONFLICT');
});

test('future-dated controller receipt fails closed instead of sorting as a fresh heartbeat', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const future = '2026-09-26T00:32:00.000Z';
  const item = projectControllerFleetTelemetry({
    statusRecords: [activity(controller, { timestampUtc: future, runStartedAtUtc: now, runCompletedAtUtc: future })],
    proofRecords: [proof(controller)],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  }).controllers[0];
  assert.equal(item.freshness, 'FUTURE');
  assert.equal(item.activityState, 'FUTURE_HEARTBEAT');
  assert.equal(item.trafficLight, 'RED');
  assert.equal(item.blocker, 'CONTROLLER_ACTIVITY_TIMESTAMP_IN_FUTURE');
});


test('non-proof Shared Workspace record cannot satisfy controller proof', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const canonicalProof = proof(controller);
  const fakeProof = {
    ...canonicalProof,
    kind: 'stephanos.shared_workspace.status',
  };
  const item = projectControllerFleetTelemetry({
    statusRecords: [activity(controller)],
    proofRecords: [fakeProof],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  }).controllers[0];
  assert.equal(item.activityState, 'UNPROVEN_ACTIVITY');
  assert.equal(item.trafficLight, 'AMBER');
  assert.equal(item.blocker, 'MATERIAL_ACTIONS_LACK_VERIFIED_PROOF');
  assert.deepEqual(item.proofRefs, []);
});


test('non-status Shared Workspace record cannot supply controller activity', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const canonicalStatus = activity(controller);
  const fakeStatus = {
    ...canonicalStatus,
    kind: 'stephanos.shared_workspace.goal',
  };
  const projection = projectControllerFleetTelemetry({
    statusRecords: [fakeStatus],
    proofRecords: [proof(controller)],
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
  });
  const item = projection.controllers[0];
  assert.equal(item.activityState, 'UNKNOWN');
  assert.equal(item.trafficLight, 'UNKNOWN');
  assert.equal(item.blocker, 'CONTROLLER_ACTIVITY_RECORD_MISSING');
});

test('canonical receipts project bounded lane facts and receipt-derived fleet metrics', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  const status = activity(controller, {
    materialActionsSucceeded: 2,
    safeEligibleWorkRemaining: 3,
    materialLanes: [{
      laneId: 'lane-alpha', goalId: '#1903', prNumber: 2436, resourceId: 'repo:stephan-os',
      workerId: 'worker-1', provider: 'OpenClaw', lastMaterialAction: 'PATCH_PUBLISHED',
      lastMaterialActionAtUtc: now, proofRef: proofRef(controller), blocker: '', retryState: 'NONE',
      failoverState: 'NOT_REQUIRED', nextAutomaticAction: 'Run exact-head review.',
    }],
  });
  const projection = projectControllerFleetTelemetry({
    statusRecords: [status], proofRecords: [proof(controller, { materialActionsSucceeded: 2 })],
    nowMs: Date.parse(now), staleAfterMs: 60_000,
  });
  assert.deepEqual(projection.controllers[0].materialLanes[0], {
    laneId: 'lane-alpha', goalId: '#1903', prNumber: 2436, resourceId: 'repo:stephan-os',
    workerId: 'worker-1', provider: 'OpenClaw', lastMaterialAction: 'PATCH_PUBLISHED',
    lastMaterialActionAtUtc: now, proofRef: proofRef(controller), blocker: '', retryState: 'NONE',
    failoverState: 'NOT_REQUIRED', nextAutomaticAction: 'Run exact-head review.',
  });
  assert.deepEqual(projection.metrics, {
    MATERIAL_ACTIONS_SUCCEEDED: 2, ACTIVE_MATERIAL_LANES: 1, TARGET_MATERIAL_LANES: 15,
    SAFE_ELIGIBLE_WORK_WAITING_WHILE_CAPACITY_FREE: 3,
  });
});

test('disabled observation followed by an in-place recovery remains visible', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[3];
  const disabledAt = '2026-09-26T10:14:38.155Z';
  const recoveredAt = '2026-09-26T10:18:47.000Z';
  const projection = projectControllerFleetTelemetry({
    statusRecords: [
      activity(controller, { timestampUtc: disabledAt, observedEnabled: false, materialActionsSucceeded: 0, proofRefs: [] }),
      activity(controller, { timestampUtc: recoveredAt, observedEnabled: true, materialActionsSucceeded: 0, proofRefs: [] }),
    ],
    proofRecords: [], nowMs: Date.parse(recoveredAt), staleAfterMs: 60_000,
  });
  const item = projection.controllers[3];
  assert.equal(item.livenessState, 'RECOVERED_AFTER_DISABLED');
  assert.deepEqual(item.enablementTransitions.map((entry) => entry.observedEnabled), [false, true]);
  assert.notEqual(item.activityState, 'BUILDING');
});

test('scheduled or dispatched state without a successful material action never becomes BUILDING', () => {
  const controller = CANONICAL_CONTROLLER_FLEET[0];
  for (const executionState of ['SCHEDULED', 'ACTION_DISPATCHED']) {
    const item = projectControllerFleetTelemetry({
      statusRecords: [activity(controller, { executionState, materialActionsSucceeded: 0, proofRefs: [] })],
      proofRecords: [], nowMs: Date.parse(now), staleAfterMs: 60_000,
    }).controllers[0];
    assert.notEqual(item.activityState, 'BUILDING');
    assert.equal(item.activityState, 'EXECUTION_STATE_UNKNOWN');
  }
});
