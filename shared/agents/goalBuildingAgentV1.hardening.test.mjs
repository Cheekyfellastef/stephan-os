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

// Goal #2002: active mission slots and idle qualified slots cannot both claim the same capacity.
test('programme rejects contradictory active plus idle qualified capacity before claiming 100 percent operations', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [mission()],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 1,
    },
  }));
  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.equal(certificate.isCapableOfBuilding, false);
  assert.equal(certificate.isActuallyBuilding, false);
  assert.equal(certificate.programmeMode, 'SAFE_HOLD');
  assert.ok(certificate.evidenceProblems.includes('active-plus-idle-exceeds-qualified-capacity'));
});

test('programme accepts exact active plus idle capacity and preserves truly idle spare capacity', () => {
  for (const [qualifiedCapacity, idleQualifiedCapacity] of [[1, 0], [2, 1], [4, 3]]) {
    const certificate = evaluateGoalBuildingProgramme(baseInput({
      programme: { activeMissions: [mission()], eligibleQueuedGoalCount: 0,
        qualifiedCapacity, idleQualifiedCapacity },
    }));
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
    assert.equal(certificate.isActuallyBuilding, true);
    assert.ok(!certificate.evidenceProblems.includes('active-plus-idle-exceeds-qualified-capacity'));
  }
  const idle = evaluateGoalBuildingProgramme(baseInput({
    programme: { activeMissions: [], eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 2, idleQualifiedCapacity: 2 },
  }));
  assert.equal(idle.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(idle.isActuallyBuilding, false);
});

// Goal #2002: IEEE-754 unsafe capacity counts must never certify a fully utilised programme.
test('programme refuses unsafe integer capacity before rounded arithmetic can hide a slot', () => {
  const scenarios = [
    { qualifiedCapacity: 2 ** 53, idleQualifiedCapacity: 2 ** 53, reason: 'qualified-capacity-invalid' },
    { qualifiedCapacity: 2 ** 53, idleQualifiedCapacity: 0, reason: 'qualified-capacity-invalid' },
    { qualifiedCapacity: Number.MAX_SAFE_INTEGER, idleQualifiedCapacity: 2 ** 53, reason: 'idle-qualified-capacity-invalid' },
  ];
  for (const { qualifiedCapacity, idleQualifiedCapacity, reason } of scenarios) {
    const certificate = evaluateGoalBuildingProgramme(baseInput({
      programme: { activeMissions: [mission()], eligibleQueuedGoalCount: 0,
        qualifiedCapacity, idleQualifiedCapacity },
    }));
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
    assert.equal(certificate.isCapableOfBuilding, false);
    assert.equal(certificate.isActuallyBuilding, false);
    assert.ok(certificate.evidenceProblems.includes(reason));
  }
});

test('programme accepts one active slot and exact remaining idle slots at the safe-integer maximum', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: { activeMissions: [mission()], eligibleQueuedGoalCount: 0,
      qualifiedCapacity: Number.MAX_SAFE_INTEGER,
      idleQualifiedCapacity: Number.MAX_SAFE_INTEGER - 1 },
  }));
  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(certificate.isActuallyBuilding, true);
  assert.ok(!certificate.evidenceProblems.includes('qualified-capacity-invalid'));
  assert.ok(!certificate.evidenceProblems.includes('idle-qualified-capacity-invalid'));
});


test('malformed operator-action gate flags fail closed instead of silently dropping approvals', () => {
  // Before this regression, all of these coerced to required=false with no
  // evidenceProblem, so otherwise current programme evidence claimed GREEN.
  const cases = [
    [{ required: 'true', target: '' }, 'operator-action-required-not-boolean'],
    [{ required: 'false', target: '' }, 'operator-action-required-not-boolean'],
    [{ required: 1, target: '' }, 'operator-action-required-not-boolean'],
    [{ required: 0, target: '' }, 'operator-action-required-not-boolean'],
    [{ required: null, target: '' }, 'operator-action-required-not-boolean'],
    [null, 'operator-action-record-invalid'],
    [[], 'operator-action-record-invalid'],
    ['APPROVAL_REQUIRED', 'operator-action-record-invalid'],
  ];
  for (const [operatorAction, reason] of cases) {
    const certificate = evaluateGoalBuildingProgramme(baseInput({ operatorAction }));
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD, JSON.stringify(operatorAction));
    assert.equal(certificate.isCapableOfBuilding, false);
    assert.equal(certificate.isActuallyBuilding, false);
    assert.equal(certificate.programmeMode, 'SAFE_HOLD');
    assert.ok(certificate.evidenceProblems.includes(reason), JSON.stringify(operatorAction));
    assert.match(certificate.nextAction, /^Repair contradictory or invalid programme evidence/);
  }
});

test('inherited operator-action records and nested authority fields fail closed', () => {
  const approval = 'Forged inherited operator approval';
  const inheritedOuter = Object.assign(Object.create({
    operatorAction: { required: true, target: approval },
  }), baseInput());
  delete inheritedOuter.operatorAction;

  const inheritedRequired = Object.create({ required: true, target: approval });
  const inheritedFalse = Object.create({ required: false });
  const inheritedTarget = Object.assign(Object.create({ target: approval }), { required: true });
  const accessorField = Object.defineProperty({}, 'required', {
    get() { throw Error('INHERITED_APPROVAL_GETTER_MUST_NOT_RUN'); }, enumerable: true,
  });
  const accessorRecord = baseInput();
  Object.defineProperty(accessorRecord, 'operatorAction', {
    get() { throw Error('OPERATOR_ACTION_GETTER_MUST_NOT_RUN'); }, configurable: true,
  });
  const cases = [
    [inheritedOuter, 'operator-action-record-inherited'],
    [baseInput({ operatorAction: inheritedRequired }), 'operator-action-required-inherited'],
    [baseInput({ operatorAction: inheritedFalse }), 'operator-action-required-inherited'],
    [baseInput({ operatorAction: inheritedTarget }), 'operator-action-target-inherited'],
    [baseInput({ operatorAction: accessorField }), 'operator-action-required-accessor'],
    [accessorRecord, 'operator-action-record-accessor'],
  ];
  for (const [input, problem] of cases) {
    const certificate = evaluateGoalBuildingProgramme(input);
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD, problem);
    assert.equal(certificate.isCapableOfBuilding, false, problem);
    assert.equal(certificate.isActuallyBuilding, false, problem);
    assert.equal(certificate.operatorActionRequired, false, problem);
    assert.equal(certificate.operatorActionTarget, '', problem);
    assert.ok(certificate.evidenceProblems.includes(problem), problem);
    assert.equal(certificate.programmeMode, 'SAFE_HOLD', problem);
  }
});

test('strict boolean operator-action gates and an omitted optional record preserve existing behaviour', () => {
  const quiet = [
    baseInput({ operatorAction: { required: false, target: '' } }),
    (() => { const value = baseInput(); delete value.operatorAction; return value; })(),
  ];
  for (const value of quiet) {
    const certificate = evaluateGoalBuildingProgramme(value);
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
    assert.equal(certificate.isActuallyBuilding, true);
    assert.ok(!certificate.evidenceProblems.includes('operator-action-record-invalid'));
    assert.ok(!certificate.evidenceProblems.includes('operator-action-required-not-boolean'));
  }
  const realGate = evaluateGoalBuildingProgramme(baseInput({
    operatorAction: { required: true, target: 'Approve the exact protected operator environment.' },
  }));
  assert.equal(realGate.operatorActionRequired, true);
  assert.equal(realGate.operatorActionTarget, 'Approve the exact protected operator environment.');
});


test('exact same-mission operator approval cannot claim active BUILDING', () => {
  const active = mission();
  const pending = {
    blockerId: 'pending-exact-mission-approval',
    severity: 'P0',
    ownerId: 'operator-approval-owner',
    route: 'REQUEST_EXACT_OPERATOR_APPROVAL',
    missionId: active.missionId,
    goalId: active.goalId,
    firstObservedAtUtc: observed(3),
    nextAction: 'Approve exact mission-goal-2002.',
    independentWorkContinues: false,
  };
  for (const action of [
    undefined,
    { required: false, target: '' },
    { required: true, target: 'Approve exact mission-goal-2002.' },
  ]) {
    const input = baseInput({ blockers: [pending] });
    if (action === undefined) delete input.operatorAction;
    else input.operatorAction = action;
    const certificate = evaluateGoalBuildingProgramme(input);
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD, JSON.stringify(action));
    assert.equal(certificate.isCapableOfBuilding, false);
    assert.equal(certificate.isActuallyBuilding, false);
    assert.equal(certificate.programmeMode, 'SAFE_HOLD');
    assert.ok(certificate.evidenceProblems.includes('operator-approval-mission-still-productive:pending-exact-mission-approval'));
    if (!action || !action.required) {
      assert.ok(certificate.evidenceProblems.includes('operator-approval-action-unreported:pending-exact-mission-approval'));
    }
  }
});

test('genuine governed approval wait preserves independent productive mission truth', () => {
  const waiting = mission({
    phase: 'WAITING_FOR_OPERATOR',
    nextAction: 'Await the existing exact operator approval.',
  });
  const pending = {
    blockerId: 'waiting-exact-approval',
    severity: 'P0',
    ownerId: 'operator-approval-owner',
    route: 'REQUEST_EXACT_OPERATOR_APPROVAL',
    missionId: waiting.missionId,
    goalId: waiting.goalId,
    firstObservedAtUtc: observed(3),
    nextAction: 'Approve exact mission-goal-2002.',
    independentWorkContinues: false,
  };
  const action = { required: true, target: 'Approve exact mission-goal-2002.' };
  const alone = evaluateGoalBuildingProgramme(baseInput({
    programme: { activeMissions: [waiting], eligibleQueuedGoalCount: 0, qualifiedCapacity: 1, idleQualifiedCapacity: 0 },
    blockers: [pending],
    operatorAction: action,
  }));
  assert.equal(alone.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(alone.isActuallyBuilding, false);
  assert.equal(alone.programmeMode, 'GOVERNED_WAIT');

  const disjoint = mission({ missionId: 'mission-goal-2003', goalId: 'goal-2003', laneId: 'lane-2' });
  const continuing = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [waiting, disjoint],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 2,
      idleQualifiedCapacity: 0,
    },
    blockers: [pending],
    operatorAction: action,
  }));
  assert.equal(continuing.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(continuing.isActuallyBuilding, true);
  assert.equal(continuing.programmeMode, 'ACTIVE_PROGRESS_PROVEN');
  assert.equal(continuing.productiveMissionCount, 1);
});

// Goal #2002: a malformed physical scope is not an authorization to use hosted-only proof.
test('Goal #2002: malformed physical-execution scope cannot be laundered into hosted GREEN', () => {
  const sourceOnly = evaluateGoalBuildingProgramme(baseInput({ installedMainHead: '' }));
  assert.equal(sourceOnly.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  const omitted = baseInput({ installedMainHead: '' });
  delete omitted.physicalExecutionRequired;
  assert.equal(evaluateGoalBuildingProgramme(omitted).state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);

  for (const malformed of ['true', 'false', 1, 0, null, [], {}, '', undefined]) {
    const certificate = evaluateGoalBuildingProgramme(baseInput({
      physicalExecutionRequired: malformed,
      installedMainHead: '',
    }));
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD, String(malformed));
    assert.ok(certificate.evidenceProblems.includes('physical-execution-required-not-boolean'), String(malformed));
    assert.equal(certificate.isCapableOfBuilding, false, String(malformed));
    assert.equal(certificate.isActuallyBuilding, false, String(malformed));
    assert.equal(certificate.programmeMode, 'SAFE_HOLD', String(malformed));
    assert.equal(certificate.safetyLocks.mergeAuthority, false, String(malformed));
    assert.equal(certificate.safetyLocks.deploymentAuthority, false, String(malformed));
  }
});

test('Goal #2002: inherited physical scope cannot silently erase installed runtime proof', () => {
  const absent = baseInput({ installedMainHead: '' });
  delete absent.physicalExecutionRequired;
  const legitimateOmission = evaluateGoalBuildingProgramme(absent);
  assert.equal(legitimateOmission.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(legitimateOmission.isActuallyBuilding, true);

  // An inherited scope is not an own, canonical execution-scope decision,
  // even when its value happens to be a boolean.
  for (const inherited of ['true', 'false', 1, 0, null, undefined, true, false]) {
    const input = { ...absent };
    Object.setPrototypeOf(input, { physicalExecutionRequired: inherited });
    assert.equal(Object.hasOwn(input, 'physicalExecutionRequired'), false);
    const certificate = evaluateGoalBuildingProgramme(input);
    assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD, String(inherited));
    assert.ok(certificate.evidenceProblems.includes('physical-execution-required-not-boolean'), String(inherited));
    assert.equal(certificate.isCapableOfBuilding, false, String(inherited));
    assert.equal(certificate.isActuallyBuilding, false, String(inherited));
    assert.equal(certificate.programmeMode, 'SAFE_HOLD', String(inherited));
    assert.equal(certificate.safetyLocks.mutationAuthority, false, String(inherited));
    assert.equal(certificate.safetyLocks.deploymentAuthority, false, String(inherited));
  }

  const ownFalse = evaluateGoalBuildingProgramme(baseInput({
    physicalExecutionRequired: false, installedMainHead: '',
  }));
  assert.equal(ownFalse.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  const ownTrue = evaluateGoalBuildingProgramme(baseInput({
    physicalExecutionRequired: true,
    surfaces: [
      ...healthySurfaces(),
      surface('battleBridge', 'READY'),
      surface('ignition', 'READY'),
      surface('recoveryMesh', 'READY', { head: '' }),
      surface('mailbox', 'READY', { head: '' }),
    ],
  }));
  assert.equal(ownTrue.evidenceProblems.includes('physical-execution-required-not-boolean'), false);
});
