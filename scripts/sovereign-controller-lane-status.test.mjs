import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename as fsRename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSharedWorkspaceControllerLaneStatusRecord,
  buildSharedWorkspaceStephanosBuildTruthRecord,
  buildStephanosBuildTruth,
  buildSovereignControllerLaneStatus,
  SOVEREIGN_CONTROLLER_LANE_STATUS_FILE,
  writeControllerLaneSpecializedStatus,
} from './sovereign-controller-lane-status.mjs';

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
  assert.equal(result.lanes.freeTargetLaneSlots, 10);
  assert.equal(result.lanes.runnableBacklogCount, 0);
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
  assert.equal(result.lanes.runnableBacklogCount, 9);
  assert.equal(result.lanes.freeTargetLaneSlots, 10);
  assert.equal(result.lanes.refillHealth, 'AMBER');
  assert.equal(result.lanes.refillState, 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE');
  assert.equal(result.finalVerdict, 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED');
});


test('preserves bounded logical fabric blocker codes for remote diagnosis', () => {
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet(),
    logicalFabric: logical({
      valid: false,
      finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_HOLD',
      blockers: [
        'MISSION_SCHEDULER_SCHEMA_INVALID_OR_MISSING',
        'PHYSICAL_CONTROLLER_FLEET_INVALID_OR_MISSING',
      ],
    }),
    now: NOW,
  });
  assert.equal(result.logical.valid, false);
  assert.deepEqual(result.logical.blockers, [
    'MISSION_SCHEDULER_SCHEMA_INVALID_OR_MISSING',
    'PHYSICAL_CONTROLLER_FLEET_INVALID_OR_MISSING',
  ]);
  assert.equal(result.lanes.refillHealth, 'RED');
  assert.equal(result.lanes.refillState, 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED');
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

test('stale physical continuity hosts cannot contribute live lanes or runnable backlog', () => {
  const controllers = fleet().controllers.map((item) => ({
    ...item,
    freshness: 'STALE',
    activityState: 'STALE_HEARTBEAT',
    trafficLight: 'RED',
    safeEligibleWorkRemaining: 7,
    blocker: 'CONTROLLER_ACTIVITY_HEARTBEAT_STALE',
  }));
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({
      controllers,
      counts: { building: 0, amber: 0, red: 5, unknown: 0 },
      allCurrent: false,
      finalVerdict: 'CONTROLLER_FLEET_ATTENTION_REQUIRED',
    }),
    logicalFabric: logical(),
    now: NOW,
  });
  assert.equal(result.physical.red, 5);
  assert.equal(result.lanes.currentPhysicalControllerCount, 0);
  assert.equal(result.lanes.stalePhysicalControllerCount, 5);
  assert.equal(result.lanes.currentPhysicalHardRedCount, 0);
  assert.equal(result.lanes.activeMaterialLaneCount, 0);
  assert.equal(result.lanes.runnableBacklogCount, 0);
  assert.equal(result.lanes.refillHealth, 'AMBER');
  assert.equal(result.lanes.refillState, 'TELEMETRY_STALE_OR_INCOMPLETE');
  assert.equal(result.finalVerdict, 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED');
});

test('a current physical hard-red controller still blocks the canonical lane health', () => {
  const controllers = fleet().controllers.map((item, index) => index === 0 ? {
    ...item,
    activityState: 'DISABLED',
    trafficLight: 'RED',
    blocker: 'CONTROLLER_DISABLED',
  } : item);
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({
      controllers,
      counts: { building: 4, amber: 0, red: 1, unknown: 0 },
      finalVerdict: 'CONTROLLER_FLEET_ATTENTION_REQUIRED',
    }),
    logicalFabric: logical(),
    now: NOW,
  });
  assert.equal(result.lanes.currentPhysicalHardRedCount, 1);
  assert.equal(result.lanes.refillHealth, 'RED');
  assert.equal(result.lanes.refillState, 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED');
});


test('reports count-only physical lanes without manufacturing active or material lane identities', () => {
  const controllers = fleet().controllers.map((item, index) => (
    index === 0
      ? {
        ...item,
        activeLanes: [],
        parkedLanes: [],
        activeLaneCount: 2,
        parkedLaneCount: 1,
        materialLanes: [],
        activityState: 'WAITING_OR_BLOCKED',
        trafficLight: 'AMBER',
      }
      : item
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
  assert.equal(result.physical.controllers[0].activeLaneCount, 2);
  assert.equal(result.physical.controllers[0].parkedLaneCount, 1);
  assert.equal(result.lanes.parkedPhysicalLaneCount, 1);
  assert.equal(result.lanes.activeLaneClaimCount, 4);
  assert.equal(result.lanes.activeMaterialLaneCount, 4);
});


test('projects lane truth into a read-only specialized Shared Workspace record', () => {
  const status = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({
      controllers: fleet().controllers.map((item, index) => index === 0
        ? { ...item, materialLanes: [], activeLanes: [], safeEligibleWorkRemaining: 2, trafficLight: 'AMBER', activityState: 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK' }
        : item),
      counts: { building: 4, amber: 1, red: 0, unknown: 0 },
      finalVerdict: 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING',
    }),
    logicalFabric: logical(),
    now: NOW,
  });
  const record = buildSharedWorkspaceControllerLaneStatusRecord(status);
  assert.equal(record.kind, 'stephanos.shared_workspace.status');
  assert.equal(record.statusId, 'controller-lane-status-current');
  assert.equal(record.participantId, 'sovereign-commander');
  assert.equal(record.controllerLaneStatusSchemaVersion, 'stephanos.sovereign-controller-lane-status.v1');
  assert.equal(record.controllerLaneStatus.lanes.targetMaterialLanes, 15);
  assert.equal(record.readOnly, true);
  assert.equal(record.sourceMutationAllowed, false);
  assert.equal(record.runtimeMutationAllowed, false);
  assert.equal(record.mergeAuthority, false);
});


test('registered controller-lane specialized status publishes atomically without weakening generic secret guards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-controller-lane-status-'));
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  try {
    const status = buildSovereignControllerLaneStatus({
      controllerFleet: fleet(),
      logicalFabric: logical(),
      now: NOW,
    });
    const record = buildSharedWorkspaceControllerLaneStatusRecord(status);
    assert.equal(record.controllerLaneStatus.secretMaterialIncluded, false);
    assert.equal(record.controllerLaneStatus.logical.valid, true);

    const publication = await writeControllerLaneSpecializedStatus(record, {
      root,
      repoRoot,
      nowMs: NOW.getTime(),
    });
    assert.equal(publication.ok, true);
    assert.equal(publication.reason, 'CONTROLLER_LANE_STATUS_PUBLISHED');

    const persisted = JSON.parse(await readFile(join(root, 'status', SOVEREIGN_CONTROLLER_LANE_STATUS_FILE), 'utf8'));
    assert.equal(persisted.statusId, 'controller-lane-status-current');
    assert.equal(persisted.controllerLaneStatus.schemaVersion, 'stephanos.sovereign-controller-lane-status.v1');
    assert.equal(persisted.controllerLaneStatus.secretMaterialIncluded, false);
    assert.equal(persisted.controllerLaneStatus.logical.valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('controller-lane specialized status retries transient Windows EPERM rename failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-controller-lane-status-eperm-'));
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  let renameAttempts = 0;
  try {
    const status = buildSovereignControllerLaneStatus({
      controllerFleet: fleet(),
      logicalFabric: logical(),
      now: NOW,
    });
    const record = buildSharedWorkspaceControllerLaneStatusRecord(status);
    const publication = await writeControllerLaneSpecializedStatus(record, {
      root,
      repoRoot,
      nowMs: NOW.getTime(),
      renameFn: async (source, target) => {
        renameAttempts += 1;
        if (renameAttempts <= 2) {
          const error = new Error('transient Windows rename contention');
          error.code = 'EPERM';
          throw error;
        }
        return fsRename(source, target);
      },
    });
    assert.equal(publication.ok, true);
    assert.equal(publication.reason, 'CONTROLLER_LANE_STATUS_PUBLISHED');
    assert.equal(renameAttempts, 3);
    const persisted = JSON.parse(await readFile(join(root, 'status', SOVEREIGN_CONTROLLER_LANE_STATUS_FILE), 'utf8'));
    assert.equal(persisted.statusId, 'controller-lane-status-current');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('projects one canonical Stephanos build truth record from physical and logical lane evidence', () => {
  const controllers = fleet().controllers.map((item, index) => index === 0
    ? {
      ...item,
      lastMaterialActionAtUtc: '2026-10-02T14:29:45.000Z',
      proofRefs: ['proof/controller-1-pass'],
      exactNextAction: 'Continue implementation.',
      materialLanes: [{
        laneId: 'lane-1',
        goalId: '#2002',
        prNumber: 2799,
        workerId: 'mission-worker-1',
        lastMaterialAction: 'SOURCE_CHANGED',
        lastMaterialActionAtUtc: '2026-10-02T14:29:45.000Z',
        proofRef: 'proof/goal-2002-source',
        blocker: '',
        nextAutomaticAction: 'Run focused tests.',
        autonomyProvenance: {
          schemaVersion: 'stephanos.autonomy-provenance.v1',
          missionId: 'stephanos-runs-the-project',
          initiatorId: 'stephanos-foreman',
          triggerClass: 'autonomous-loop',
          operatorInitiated: false,
          chatgptInitiated: false,
          manualPoke: false,
        },
      }],
    }
    : item);
  const fabric = logical({
    controllers: [
      {
        logicalControllerId: 'logical-goal-2002',
        goalIssueNumber: 2002,
        goalRef: '#2002',
        goalTitle: 'Stephanos Goal Building Agent',
        lifecycle: 'ACTIVE',
        continuityState: 'ACTIVE',
        route: 'BUILD',
        hostControllerId: 'controller-1',
        hostControllerTitle: 'Controller 1',
        selectedForAdmission: true,
        executionOwner: 'canonical-mission-scheduler-and-mission-worker',
        retired: false,
      },
    ],
    logicalControllerCount: 1,
    activeLogicalControllerCount: 1,
    trackingLogicalControllerCount: 0,
    parkedLogicalControllerCount: 0,
  });
  const status = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers }),
    logicalFabric: fabric,
    now: NOW,
  });
  const truth = buildStephanosBuildTruth(status);
  assert.equal(truth.state, 'BUILDING');
  assert.equal(truth.trafficLight, 'GREEN');
  assert.equal(truth.autonomous, true);
  assert.equal(truth.autonomyTruth, 'PROVEN');
  assert.equal(truth.autonomousBuildingGoalCount, 1);
  assert.equal(truth.goals[0].autonomous, true);
  assert.equal(truth.goals[0].autonomyTruth, 'PROVEN');
  assert.equal(truth.buildingGoalCount, 1);
  assert.equal(truth.goals[0].issue, '#2002');
  assert.equal(truth.goals[0].title, 'Stephanos Goal Building Agent');
  assert.equal(truth.goals[0].controllerId, 'controller-1');
  assert.equal(truth.goals[0].logicalLaneId, 'logical-goal-2002');
  assert.equal(truth.goals[0].builder, 'mission-worker-1');
  assert.equal(truth.goals[0].prNumber, 2799);
  assert.equal(truth.goals[0].lastMaterialProgressAtUtc, '2026-10-02T14:29:45.000Z');
  const record = buildSharedWorkspaceStephanosBuildTruthRecord(truth);
  assert.equal(record.statusId, 'stephanos-build-truth-current');
  assert.equal(record.status, 'BUILDING');
  assert.equal(record.stephanosBuildTruth.goals[0].proofRefs.includes('proof/goal-2002-source'), true);
});

test('build truth never claims autonomy from a controller title or lane without provenance', () => {
  const controllers = fleet().controllers.map((item, index) => index === 0
    ? {
      ...item,
      materialLanes: [{
        laneId: 'lane-assisted',
        goalId: '#2002',
        workerId: 'mission-worker-1',
        lastMaterialAction: 'SOURCE_CHANGED',
        lastMaterialActionAtUtc: '2026-10-02T14:29:45.000Z',
        proofRef: 'proof/goal-2002-source',
      }],
    }
    : item);
  const fabric = logical({
    controllers: [{
      logicalControllerId: 'logical-goal-2002',
      goalIssueNumber: 2002,
      goalRef: '#2002',
      goalTitle: 'Stephanos Goal Building Agent',
      lifecycle: 'ACTIVE',
      continuityState: 'ACTIVE',
      route: 'BUILD',
      hostControllerId: 'controller-1',
      hostControllerTitle: 'Stephanos Autonomous Goal Builder',
      selectedForAdmission: true,
      executionOwner: 'canonical-mission-scheduler-and-mission-worker',
      retired: false,
    }],
    logicalControllerCount: 1,
    activeLogicalControllerCount: 1,
    trackingLogicalControllerCount: 0,
    parkedLogicalControllerCount: 0,
  });
  const status = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers }),
    logicalFabric: fabric,
    now: NOW,
  });
  const truth = buildStephanosBuildTruth(status);
  assert.equal(truth.state, 'BUILDING');
  assert.equal(truth.autonomous, false);
  assert.equal(truth.autonomyTruth, 'UNPROVEN');
  assert.equal(truth.autonomousBuildingGoalCount, 0);
  assert.equal(truth.goals[0].autonomous, false);
  assert.equal(truth.goals[0].autonomyTruth, 'UNPROVEN');
});

test('never reports idle green when safe eligible work is stranded', () => {
  const controllers = fleet().controllers.map((item, index) => index === 0
    ? {
      ...item,
      materialLanes: [],
      activeLanes: [],
      safeEligibleWorkRemaining: 4,
      trafficLight: 'AMBER',
      activityState: 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK',
      exactNextAction: 'Dispatch safe work.',
    }
    : { ...item, materialLanes: [], activeLanes: [], activityState: 'IDLE_NO_ELIGIBLE_WORK' });
  const status = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({
      controllers,
      counts: { building: 0, amber: 1, red: 0, unknown: 0 },
      finalVerdict: 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING',
    }),
    logicalFabric: logical({
      controllers: [{
        logicalControllerId: 'logical-goal-2002',
        goalIssueNumber: 2002,
        goalRef: '#2002',
        goalTitle: 'Stephanos Goal Building Agent',
        lifecycle: 'READY',
        continuityState: 'TRACKING',
        route: 'BUILD',
        hostControllerId: 'controller-1',
        hostControllerTitle: 'Controller 1',
        selectedForAdmission: true,
        executionOwner: 'canonical-mission-scheduler-and-mission-worker',
        retired: false,
      }],
      logicalControllerCount: 1,
      activeLogicalControllerCount: 0,
      trackingLogicalControllerCount: 1,
      parkedLogicalControllerCount: 0,
    }),
    now: NOW,
  });
  const truth = buildStephanosBuildTruth(status);
  assert.equal(truth.state, 'BLOCKED');
  assert.equal(truth.trafficLight, 'RED');
  assert.equal(truth.blockers.includes('SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE'), true);
});
