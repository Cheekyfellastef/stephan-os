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
  projectBoundedRemoteControllerLaneStatus,
  runSovereignControllerLaneStatus,
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
      proofRefs: ['proof/controller-1-pass', 'proof/goal-2002-source'],
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
  // Verified host proofs for unrelated goals cannot be attributed to #2002.
  assert.deepEqual(truth.goals[0].proofRefs, ['proof/goal-2002-source']);
  assert.deepEqual(record.stephanosBuildTruth.goals[0].proofRefs, ['proof/goal-2002-source']);
});

test('logical ACTIVE does not mean BUILDING when its host is working on another goal', () => {
  const controllers = fleet().controllers.map((item, index) => ({
    ...item,
    materialLanes: index === 0 ? [{
      laneId: 'other-goal-lane',
      goalId: '#7777',
      workerId: 'mission-worker-1',
      proofRef: 'proof/other-goal',
      lastMaterialActionAtUtc: '2026-10-02T14:29:45.000Z',
    }] : [],
    activityState: index === 0 ? 'BUILDING' : 'IDLE_NO_ELIGIBLE_WORK',
  }));
  const fabric = logical({
    controllers: [{
      logicalControllerId: 'logical-goal-2002',
      goalIssueNumber: 2002,
      goalRef: '#2002',
      goalTitle: 'Goal Building Agent',
      continuityState: 'ACTIVE',
      selectedForAdmission: true,
      hostControllerId: 'controller-1',
      hostControllerTitle: 'Controller 1',
    }],
    logicalControllerCount: 1,
  });
  const status = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers, counts: { building: 1, amber: 0, red: 0, unknown: 0 } }),
    logicalFabric: fabric,
    now: NOW,
  });
  const truth = buildStephanosBuildTruth(status);
  assert.equal(truth.goals[0].state, 'QUEUED');
  assert.equal(truth.buildingGoalCount, 0);
  assert.equal(truth.goals[0].lastMaterialProgressAtUtc, '');
  assert.deepEqual(truth.goals[0].proofRefs, []);
  assert.equal(truth.goals[0].autonomous, false);
  // Other goals may genuinely be building. Do not misattribute that work to #2002.
  assert.equal(truth.state, 'BUILDING');
});

test('logical ACTIVE without worker-bound same-goal proof stays QUEUED, not green', () => {
  const controllers = fleet().controllers.map((item, index) => ({
    ...item,
    materialLanes: index === 0 ? [{
      laneId: 'unproven-goal-lane',
      goalId: '#2002',
      workerId: 'mission-worker-1',
      lastMaterialActionAtUtc: '2026-10-02T14:29:45.000Z',
      // A lane claim without a proof reference is not a verified pickup.
    }] : [],
    activityState: index === 0 ? 'BUILDING' : 'IDLE_NO_ELIGIBLE_WORK',
  }));
  const fabric = logical({
    controllers: [{
      logicalControllerId: 'logical-goal-2002',
      goalIssueNumber: 2002,
      goalRef: '#2002',
      goalTitle: 'Goal Building Agent',
      continuityState: 'ACTIVE',
      selectedForAdmission: true,
      hostControllerId: 'controller-1',
      hostControllerTitle: 'Controller 1',
    }],
    logicalControllerCount: 1,
  });
  const status = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers, counts: { building: 1, amber: 0, red: 0, unknown: 0 } }),
    logicalFabric: fabric,
    now: NOW,
  });
  const truth = buildStephanosBuildTruth(status);
  assert.equal(truth.buildingGoalCount, 0);
  assert.equal(truth.goals[0].state, 'QUEUED');
  assert.equal(truth.goals[0].autonomyTruth, 'UNPROVEN');
});

test('a same-goal lane with an unverified proof ref cannot borrow host PASS proof', () => {
  const controllers = fleet().controllers.map((item, index) => ({
    ...item,
    proofRefs: index === 0 ? ['proof/other-goal-verified'] : [],
    materialLanes: index === 0 ? [{
      laneId: 'goal-lane-unverified-ref',
      goalId: '#2002',
      workerId: 'mission-worker-1',
      proofRef: 'proof/goal-2002-unverified',
      lastMaterialActionAtUtc: '2026-10-02T14:29:45.000Z',
    }] : [],
    activityState: index === 0 ? 'BUILDING' : 'IDLE_NO_ELIGIBLE_WORK',
  }));
  const fabric = logical({
    controllers: [{
      logicalControllerId: 'logical-goal-2002',
      goalIssueNumber: 2002,
      goalRef: '#2002',
      goalTitle: 'Goal Building Agent',
      continuityState: 'ACTIVE',
      selectedForAdmission: true,
      hostControllerId: 'controller-1',
      hostControllerTitle: 'Controller 1',
    }],
    logicalControllerCount: 1,
  });
  const status = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers, counts: { building: 1, amber: 0, red: 0, unknown: 0 } }),
    logicalFabric: fabric,
    now: NOW,
  });
  const truth = buildStephanosBuildTruth(status);
  assert.equal(truth.buildingGoalCount, 0);
  assert.equal(truth.goals[0].state, 'QUEUED');
  assert.equal(truth.goals[0].lastMaterialProgressAtUtc, '');
  assert.deepEqual(truth.goals[0].proofRefs, []);
  assert.equal(truth.goals[0].autonomyTruth, 'UNPROVEN');
});

test('build truth never claims autonomy from a controller title or lane without provenance', () => {
  const controllers = fleet().controllers.map((item, index) => index === 0
    ? {
      ...item,
      proofRefs: ['proof/goal-2002-source'],
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


test('MCP controller snapshot skips Shared Workspace writes while preserving bounded evidence', async () => {
  const observed = buildSovereignControllerLaneStatus({ controllerFleet: fleet(), logicalFabric: logical(), now: NOW });
  let publications = 0;
  const lines = [];
  const actual = await runSovereignControllerLaneStatus({
    snapshotOnly: true,
    collectStatusFn: async () => observed,
    publishStatusFn: async () => { publications++; throw new Error('status-locked'); },
    publishBuildTruthFn: async () => { publications++; throw new Error('truth-locked'); },
    emitFn: (line) => lines.push(line),
  });
  assert.equal(actual, observed);
  assert.equal(publications, 0);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT='));
  const parsed = JSON.parse(lines[0].slice('SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT='.length));
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.sourceMutationAllowed, false);
  assert.equal(parsed.mergeAuthority, false);
});

test('normal controller pulse continues publishing both snapshots', async () => {
  const observed = buildSovereignControllerLaneStatus({ controllerFleet: fleet(), logicalFabric: logical(), now: NOW });
  const calls = [];
  await runSovereignControllerLaneStatus({
    collectStatusFn: async () => observed,
    publishStatusFn: async (status) => { assert.equal(status, observed); calls.push('status'); return { ok: true }; },
    publishBuildTruthFn: async (truth) => { assert.ok(truth && typeof truth === 'object'); calls.push('truth'); return { ok: true }; },
    emitFn: () => calls.push('marker'),
  });
  assert.deepEqual(calls, ['status', 'truth', 'marker']);
});

test('selected pickup count requires matching worker-bound goal proof on its current host', () => {
  const controllers = fleet().controllers.map((item, index) => index === 0
    ? {
        ...item,
        proofRefs: ['proof-goal-123'],
        materialLanes: [
          {
            laneId: 'lane-proven-123',
            goalId: '#123',
            workerId: 'mission-worker-1',
            proofRef: 'proof-goal-123',
            lastMaterialActionAtUtc: '2026-10-02T14:29:30.000Z',
          },
          { laneId: 'unrelated-material-lane', goalId: '#999' },
        ],
      }
    : item);
  const logicalFabric = logical({
    controllers: [
      {
        goalIssueNumber: 123, goalRef: '#123',
        hostControllerId: 'controller-1',
        selectedForAdmission: true,
      },
      {
        goalIssueNumber: 456, goalRef: '#456',
        hostControllerId: 'controller-1',
        selectedForAdmission: true,
      },
    ],
  });
  const result = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers }),
    logicalFabric,
    now: NOW,
  });
  assert.equal(result.logical.selectedForAdmission, 2);
  assert.equal(result.lanes.selectedMaterialPickupProvenCount, 1);
  assert.ok(result.lanes.activeMaterialLaneCount > 1);

  const withoutCustody = controllers.map((item, index) => index === 0
    ? { ...item, proofRefs: [] } : item);
  const blocked = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({ controllers: withoutCustody }),
    logicalFabric,
    now: NOW,
  });
  assert.equal(blocked.lanes.selectedMaterialPickupProvenCount, 0);
});


test('remote snapshot-only receipt stays complete under the 16 KiB Commander stdout cap with 75 logical goals', async () => {
  const longGoals = Array.from({ length: 75 }, (_, index) => ({
    logicalControllerId: `logical-${index}`,
    goalIssueNumber: 3000 + index,
    goalRef: `#${3000 + index}`,
    goalTitle: `LONG_PRIVATE_GOAL_DETAIL_${'x'.repeat(180)}_${index}`,
    lifecycle: 'TRACKING',
    continuityState: 'TRACKING',
    route: 'CANONICAL',
    hostControllerId: `controller-${index % 5 + 1}`,
    hostControllerTitle: 'Canonical Controller',
    executionOwner: 'canonical-mission-worker',
    selectedForAdmission: index < 17,
    retired: false,
  }));
  const source = buildSovereignControllerLaneStatus({
    controllerFleet: fleet({
      controllers: fleet().controllers.map((item) => ({
        ...item,
        materialLanes: Array.from({ length: 15 }, (_, n) => ({
          laneId: `${item.controllerId}-${n}`,
          proofRef: `private-proof-${'q'.repeat(100)}`,
        })),
      })),
    }),
    logicalFabric: logical({
      logicalControllerCount: 75,
      controllers: longGoals,
    }),
    now: NOW,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(source), 'utf8') > 16 * 1024);
  let remoteLine = '';
  let publishCount = 0;
  const result = await runSovereignControllerLaneStatus({
    snapshotOnly: true,
    collectStatusFn: async () => source,
    publishStatusFn: async () => { publishCount += 1; },
    publishBuildTruthFn: async () => { publishCount += 1; },
    emitFn: (value) => { remoteLine += value; },
  });
  assert.equal(result, source);
  assert.equal(publishCount, 0);
  assert.ok(Buffer.byteLength(remoteLine, 'utf8') < 12 * 1024);
  assert.ok(remoteLine.startsWith('SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT='));
  const parsed = JSON.parse(remoteLine.split('=', 1)[0] === ''
    ? '{}' : remoteLine.slice(remoteLine.indexOf('=') + 1));
  assert.equal(parsed.schemaVersion, source.schemaVersion);
  assert.equal(parsed.logical.total, 75);
  assert.equal(parsed.logical.selectedForAdmission, 17);
  assert.equal(parsed.physical.controllers.length, 5);
  assert.equal(parsed.lanes.activeMaterialLaneCount, source.lanes.activeMaterialLaneCount);
  assert.equal(parsed.lanes.refillHealth, source.lanes.refillHealth);
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.sourceMutationAllowed, false);
  assert.equal(parsed.unknownMeansGreen, false);
  assert.equal('controllers' in parsed.logical, false);
  assert.equal('materialLanes' in parsed.physical.controllers[0], false);
  assert.equal(remoteLine.includes('LONG_PRIVATE_GOAL_DETAIL_'), false);
  assert.equal(remoteLine.includes('private-proof-'), false);
});

test('bounded remote projection rejects manufactured authority and keeps full local publishing unchanged', async () => {
  const source = buildSovereignControllerLaneStatus({
    controllerFleet: fleet(), logicalFabric: logical(), now: NOW,
  });
  assert.throws(() => projectBoundedRemoteControllerLaneStatus({
    ...source, sourceMutationAllowed: true,
  }), /CONTROLLER_LANE_STATUS_REMOTE_SOURCE_INVALID/);
  assert.throws(() => projectBoundedRemoteControllerLaneStatus({
    ...source, unknownMeansGreen: true,
  }), /CONTROLLER_LANE_STATUS_REMOTE_SOURCE_INVALID/);
  let localLine = '';
  let publications = 0;
  await runSovereignControllerLaneStatus({
    snapshotOnly: false,
    collectStatusFn: async () => source,
    publishStatusFn: async () => { publications += 1; },
    publishBuildTruthFn: async () => { publications += 1; },
    emitFn: (value) => { localLine += value; },
  });
  assert.equal(publications, 2);
  const full = JSON.parse(localLine.slice(localLine.indexOf('=') + 1));
  assert.equal(full.logical.controllers.length, source.logical.controllers.length);
  assert.deepEqual(full, source);
});
