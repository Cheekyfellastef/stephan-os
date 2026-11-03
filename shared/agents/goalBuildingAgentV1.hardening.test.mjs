import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILDING_AGENT_ID,
  GOAL_BUILDING_OPERATING_STATES,
  evaluateGoalBuildingProgramme,
} from './goalBuildingAgentV1.mjs';

const HEAD = 'd4a3702dd3dbd27ffe26433c48602d1e372d09e5';
const PREDECESSOR = '3b4709fc203e055084c668998490d99d4384521b';
const NOW = '2026-08-25T17:15:00.000Z';
const NOW_MS = Date.parse(NOW);

function observed(minutesAgo = 1) {
  return new Date(NOW_MS - minutesAgo * 60 * 1000).toISOString();
}

function surface(id, state, options = {}) {
  return {
    id,
    state,
    observedAtUtc: options.observedAtUtc || observed(1),
    head: options.head === undefined ? HEAD : options.head,
    blocker: options.blocker || '',
  };
}

function healthySurfaces(overrides = {}) {
  const defaults = {
    sourceSync: surface('sourceSync', 'SYNC_NO_CHANGE'),
    scheduler: surface('scheduler', 'ACTIVE'),
    continuityController: surface('continuityController', 'ACTIVE'),
    missionWorker: surface('missionWorker', 'RUNNING'),
    providerRouter: surface('providerRouter', 'ROUTING', { head: '' }),
    proofRoute: surface('proofRoute', 'READY', { head: '' }),
    reviewRoute: surface('reviewRoute', 'READY', { head: '' }),
    statusFabric: surface('statusFabric', 'READY'),
  };
  return Object.values({ ...defaults, ...overrides });
}

function mission(overrides = {}) {
  return {
    missionId: 'mission-goal-2002',
    goalId: 'goal-2002',
    laneId: 'lane-1',
    ownerId: GOAL_BUILDING_AGENT_ID,
    phase: 'IMPLEMENT',
    authorityHead: HEAD,
    observedAtUtc: observed(1),
    lastProgressAtUtc: observed(2),
    nextAction: 'Publish the next durable goal-progress receipt.',
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    expectedHead: HEAD,
    protectedMainHead: HEAD,
    installedMainHead: HEAD,
    physicalExecutionRequired: false,
    surfaces: healthySurfaces(),
    programme: {
      activeMissions: [mission()],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
    blockers: [],
    operatorAction: { required: false, target: '' },
    validationOptions: { nowMs: NOW_MS },
    ...overrides,
  };
}

test('source-only programme evaluation does not require an installed physical head', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({ installedMainHead: '' }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(certificate.isCapableOfBuilding, true);
  assert.equal(certificate.isActuallyBuilding, true);
  assert.ok(!certificate.evidenceProblems.includes('installed-main-head-invalid'));
});

test('physical programme evaluation still requires exact installed-head proof', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    physicalExecutionRequired: true,
    installedMainHead: '',
    surfaces: [
      ...healthySurfaces(),
      surface('battleBridge', 'READY'),
      surface('ignition', 'READY'),
      surface('recoveryMesh', 'READY', { head: '' }),
      surface('mailbox', 'READY', { head: '' }),
    ],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.ok(certificate.evidenceProblems.includes('installed-main-head-invalid'));
});

test('a blocked mission cannot count itself as independent work continuation', () => {
  const active = mission();
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [active],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
    blockers: [{
      blockerId: 'same-mission-blocker',
      severity: 'P1',
      ownerId: 'stall-sentinel',
      route: 'DELEGATE_BOUNDED_REPAIR',
      missionId: active.missionId,
      goalId: active.goalId,
      firstObservedAtUtc: observed(4),
      nextAction: 'Delegate the existing bounded repair for this mission.',
      independentWorkContinues: true,
    }],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.equal(certificate.isActuallyBuilding, false);
  assert.ok(certificate.evidenceProblems.includes('independent-work-claim-unproven:same-mission-blocker'));
});

test('an all-waiting programme cannot claim useful independent work is continuing', () => {
  const waiting = mission({ phase: 'WAITING_FOR_DEPENDENCY' });
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [waiting],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
    blockers: [{
      blockerId: 'dependency-wait',
      severity: 'P2',
      ownerId: 'dependency-owner',
      route: 'DELEGATE_BOUNDED_REPAIR',
      missionId: waiting.missionId,
      goalId: waiting.goalId,
      firstObservedAtUtc: observed(5),
      nextAction: 'Resolve the owned dependency through its existing route.',
      independentWorkContinues: true,
    }],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.ok(certificate.evidenceProblems.includes('independent-work-claim-unproven:dependency-wait'));
});

test('a blocker without goal or mission lineage cannot be considered owned programme truth', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    blockers: [{
      blockerId: 'lineage-free-blocker',
      severity: 'P2',
      ownerId: 'stall-sentinel',
      route: 'DELEGATE_BOUNDED_REPAIR',
      firstObservedAtUtc: observed(6),
      nextAction: 'Do not act until the blocker is correlated to canonical work.',
      independentWorkContinues: false,
    }],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.ok(certificate.evidenceProblems.includes('blocker-lineage-missing:lineage-free-blocker'));
});

test('a blocker referencing an unknown active mission fails closed', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    blockers: [{
      blockerId: 'unknown-mission-blocker',
      severity: 'P2',
      ownerId: 'stall-sentinel',
      route: 'DELEGATE_BOUNDED_REPAIR',
      missionId: 'mission-not-active',
      goalId: 'goal-other',
      firstObservedAtUtc: observed(6),
      nextAction: 'Reconstruct blocker lineage before delegation.',
      independentWorkContinues: true,
    }],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.ok(certificate.evidenceProblems.includes('blocker-mission-unknown:unknown-mission-blocker'));
});

test('next blocker action is deterministic by severity, age, route and identity rather than array order', () => {
  const blockers = [
    {
      blockerId: 'p2-old',
      severity: 'P2',
      ownerId: 'owner-p2',
      route: 'SELF_RECOVERABLE_BY_EXISTING_BOUNDED_CONTRACT',
      goalId: 'goal-p2',
      firstObservedAtUtc: observed(20),
      nextAction: 'P2 action',
      independentWorkContinues: true,
    },
    {
      blockerId: 'p1-delegate',
      severity: 'P1',
      ownerId: 'owner-p1-delegate',
      route: 'DELEGATE_BOUNDED_REPAIR',
      goalId: 'goal-p1-delegate',
      firstObservedAtUtc: observed(5),
      nextAction: 'P1 delegate action',
      independentWorkContinues: true,
    },
    {
      blockerId: 'p1-self',
      severity: 'P1',
      ownerId: 'owner-p1-self',
      route: 'SELF_RECOVERABLE_BY_EXISTING_BOUNDED_CONTRACT',
      goalId: 'goal-p1-self',
      firstObservedAtUtc: observed(5),
      nextAction: 'P1 self-recover action',
      independentWorkContinues: true,
    },
  ];

  const forward = evaluateGoalBuildingProgramme(baseInput({ blockers }));
  const reverse = evaluateGoalBuildingProgramme(baseInput({ blockers: [...blockers].reverse() }));

  assert.equal(forward.nextAction, 'P1 self-recover action');
  assert.equal(reverse.nextAction, forward.nextAction);
});

test('SAFE_HOLD overrides ordinary idle labels and untrusted caller actions', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    installedMainHead: '',
    surfaces: [
      ...healthySurfaces(),
      surface('recoveryMesh', 'READY', {
        observedAtUtc: new Date(NOW_MS + 2 * 60 * 1000).toISOString(),
        head: '',
      }),
    ],
    programme: {
      activeMissions: [],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 2,
      idleQualifiedCapacity: 2,
    },
    blockers: [{
      blockerId: 'caller-action-during-contradiction',
      severity: 'P3',
      ownerId: 'status-fabric',
      route: 'SELF_RECOVERABLE_BY_EXISTING_BOUNDED_CONTRACT',
      goalId: 'goal-status',
      firstObservedAtUtc: observed(3),
      nextAction: 'This caller action must not outrank SAFE_HOLD.',
      independentWorkContinues: false,
    }],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.equal(certificate.programmeMode, 'SAFE_HOLD');
  assert.equal(certificate.isActuallyBuilding, false);
  assert.equal(certificate.nextAction, 'Repair contradictory or invalid programme evidence before any consequential action.');
});

test('optional installed-head evidence remains contradiction-sensitive when it is supplied', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({ installedMainHead: PREDECESSOR }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.BLOCKED);
  assert.equal(certificate.isCapableOfBuilding, false);
  assert.ok(certificate.blockingReasons.includes('installed-main-head-mismatch'));
});
