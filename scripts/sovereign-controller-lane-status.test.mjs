import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSovereignControllerLaneStatus } from './sovereign-controller-lane-status.mjs';

const NOW = new Date('2026-10-02T14:30:00.000Z');

function controller(index, overrides = {}) {
  return {
    controllerId: `controller-${index}`,
    title: `Controller ${index}`,
    freshness: 'CURRENT',
    activityState: 'BUILDING',
    trafficLight: 'GREEN',
    materialLanes: [{ laneId: `lane-${index}` }],
    activeLanes: [`lane-${index}`],
    parkedLanes: [],
    safeEligibleWorkRemaining: 0,
    blocker: '',
    ...overrides,
  };
}

function fleet(overrides = {}) {
  const controllers = Array.from({ length: 5 }, (_, index) => controller(index + 1));
  return {
    schemaVersion: 'stephanos.controller-fleet-telemetry.v1',
    expectedControllerCount: 5,
    controllers,
    counts: { building: 5, amber: 0, red: 0, unknown: 0 },
    metrics: { TARGET_MATERIAL_LANES: 15 },
    allCurrent: true,
    allObservedEnabled: true,
    finalVerdict: 'CONTROLLER_FLEET_BUILDING_PROVEN',
    ...overrides,
  };
}

function logical(overrides = {}) {
  return {
    schemaVersion: 'stephanos.logical-goal-controller-fabric.v1',
    valid: true,
    finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
    observedAtUtc: '2026-10-02T14:29:00.000Z',
    physicalControllerCount: 5,
    logicalControllerCount: 30,
    activeLogicalControllerCount: 8,
    trackingLogicalControllerCount: 15,
    parkedLogicalControllerCount: 7,
    retiredLogicalControllerCount: 0,
    controllers: [
      { selectedForAdmission: true, retired: false },
      { selectedForAdmission: true, retired: false },
      { selectedForAdmission: false, retired: false },
    ],
    hostLoads: Array.from({ length: 5 }, (_, index) => ({
      controllerId: `controller-${index + 1}`,
      title: `Controller ${index + 1}`,
      logicalControllerCount: 6,
      activeCount: index < 3 ? 2 : 1,
      trackingCount: 3,
      parkedCount: index < 2 ? 1 : 2,
    })),
    ...overrides,
  };
}

test('reports physical and logical controller posture without inventing fifteen active lanes', () => {
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet(),
    logicalFabric: logical(),
    now: NOW,
  });
  assert.equal(result.physical.building, 5);
  assert.equal(result.logical.total, 30);
  assert.equal(result.logical.active, 8);
  assert.equal(result.lanes.targetMaterialLanes, 15);
  assert.equal(result.lanes.activeMaterialLaneCount, 5);
  assert.equal(result.lanes.occupancyPercent, 33.33);
  assert.equal(result.lanes.refillHealth, 'GREEN');
  assert.equal(result.lanes.refillState, 'NO_SAFE_ELIGIBLE_WORK_REPORTED');
  assert.equal(result.readOnly, true);
  assert.equal(result.mergeAuthority, false);
});

test('deduplicates shared material lane identities reported by multiple physical controllers', () => {
  const shared = ['lane-a', 'lane-b', 'lane-c'].map((laneId) => ({ laneId }));
  const controllers = Array.from({ length: 5 }, (_, index) => controller(index + 1, {
    materialLanes: shared,
    activeLanes: ['lane-a', 'lane-b', 'lane-c'],
  }));
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers }),
    logicalFabric: logical(),
    now: NOW,
  });
  assert.equal(result.lanes.activeMaterialLaneCount, 3);
  assert.equal(result.lanes.activeLaneClaimCount, 3);
  assert.equal(result.lanes.reportedMaterialLaneCountSum, 15);
});

test('flags refill debt when safe work is reported while target lane capacity is free', () => {
  const controllers = fleet().controllers.map((item, index) => (
    index === 0 ? { ...item, safeEligibleWorkRemaining: 9, activityState: 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK', trafficLight: 'AMBER' } : item
  ));
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({
      controllers,
      counts: { building: 4, amber: 1, red: 0, unknown: 0 },
      finalVerdict: 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING',
    }),
    logicalFabric: logical(),
    now: NOW,
  });
  assert.equal(result.lanes.reportedSafeEligibleWorkMax, 9);
  assert.equal(result.lanes.refillHealth, 'AMBER');
  assert.equal(result.lanes.refillState, 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE');
  assert.equal(result.finalVerdict, 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED');
});

test('stale logical controller evidence never becomes green', () => {
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet(),
    logicalFabric: logical({ observedAtUtc: '2026-10-02T10:00:00.000Z' }),
    now: NOW,
  });
  assert.equal(result.logical.current, false);
  assert.equal(result.lanes.refillHealth, 'AMBER');
  assert.equal(result.lanes.refillState, 'TELEMETRY_STALE_OR_INCOMPLETE');
  assert.equal(result.unknownMeansGreen, false);
});
