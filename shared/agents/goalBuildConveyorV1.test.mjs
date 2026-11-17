import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILD_CONVEYOR_SCHEMA,
  projectGoalBuildConveyorV1,
  projectGoalBuildJourneyV1,
} from './goalBuildConveyorV1.mjs';

function track(issueNumber, gates = []) {
  return {
    issueNumber,
    missionId: `critical-${issueNumber}-elastic-goal`,
    providerAdapter: 'openclaw-local',
    cycleId: 'cycle-proof',
    gates,
  };
}

const gate = (id, state, reason = '') => ({ id, state, reason });

test('exact autonomy track paints only proven handoffs green for the matching goal', () => {
  const journey = projectGoalBuildJourneyV1({
    issue: '#7001',
    title: 'Visibility proof goal',
    state: 'ACTIVE',
    statusTruth: 'CURRENT',
    source: 'shared-workspace-goal-record',
    buildState: 'BUILDING',
    buildTruthTruth: 'CURRENT',
    builder: 'openclaw-local',
    buildProofRefs: ['proof/build-7001'],
  }, track(7001, [
    gate('ELIGIBLE_GOAL', 'PASS'),
    gate('SELECT', 'PASS'),
    gate('MISSION', 'PASS'),
    gate('CLAIM', 'PASS'),
    gate('WORKER', 'PASS'),
    gate('PROVIDER', 'WAITING', 'PROVIDER_COMPLETION_NOT_OBSERVED'),
    gate('SOURCE_CHANGED', 'NOT_REACHED'),
    gate('TESTED', 'NOT_REACHED'),
    gate('TERMINAL_RECEIPT', 'NOT_REACHED'),
  ]));

  assert.equal(journey.schemaVersion, GOAL_BUILD_CONVEYOR_SCHEMA);
  assert.equal(journey.exactAutonomyTrackBound, true);
  assert.equal(journey.builder, 'openclaw-local');
  for (const id of ['GOAL', 'READY', 'SELECTED', 'MISSION', 'DISPATCHED']) {
    assert.equal(journey.stages.find((stage) => stage.id === id)?.trafficLight, 'GREEN', id);
  }
  assert.equal(journey.logicalWorkerHandoffReported, true);
  assert.equal(journey.physicalPickupProven, false);
  for (const id of ['PICKED_UP', 'BUILDING']) {
    assert.notEqual(journey.stages.find((stage) => stage.id === id)?.trafficLight, 'GREEN', id);
  }
  assert.equal(journey.currentStage, 'PICKED_UP');
});

test('a goal never borrows another goal autonomy proof', () => {
  const journey = projectGoalBuildJourneyV1({
    issue: '#7002',
    title: 'Different goal',
    state: 'READY',
    statusTruth: 'CURRENT',
    source: 'shared-workspace-goal-record',
    buildState: 'QUEUED',
  }, track(7001, [
    gate('ELIGIBLE_GOAL', 'PASS'),
    gate('SELECT', 'PASS'),
    gate('MISSION', 'PASS'),
    gate('CLAIM', 'PASS'),
    gate('WORKER', 'PASS'),
  ]));

  assert.equal(journey.exactAutonomyTrackBound, false);
  assert.equal(journey.stages.find((stage) => stage.id === 'GOAL')?.trafficLight, 'GREEN');
  assert.equal(journey.stages.find((stage) => stage.id === 'READY')?.trafficLight, 'GREEN');
  assert.notEqual(journey.stages.find((stage) => stage.id === 'SELECTED')?.trafficLight, 'GREEN');
  assert.notEqual(journey.stages.find((stage) => stage.id === 'PICKED_UP')?.trafficLight, 'GREEN');
});

test('logical BUILDING needs exact same-goal CLAIM and WORKER proof before physical green', () => {
  const goal = {
    issue: '#7003', title: 'Logical builder label only', state: 'ACTIVE',
    statusTruth: 'CURRENT', buildState: 'BUILDING',
    buildTruthTruth: 'CURRENT', builder: 'foundry-forge',
  };
  const cases = [
    ['no track', null],
    ['wrong goal', track(7004, [gate('CLAIM', 'PASS'), gate('WORKER', 'PASS')])],
    ['worker waiting', track(7003, [gate('CLAIM', 'PASS'), gate('WORKER', 'WAITING')])],
    ['worker blocked', track(7003, [gate('CLAIM', 'PASS'), gate('WORKER', 'BLOCKED')])],
    ['claim missing', track(7003, [gate('WORKER', 'PASS')])],
    ['claim waiting', track(7003, [gate('CLAIM', 'WAITING'), gate('WORKER', 'PASS')])],
    ['claim blocked', track(7003, [gate('CLAIM', 'BLOCKED'), gate('WORKER', 'PASS')])],
  ];
  for (const [label, observed] of cases) {
    const journey = projectGoalBuildJourneyV1(goal, observed);
    assert.notEqual(journey.stages.find((s) => s.id === 'PICKED_UP')?.trafficLight, 'GREEN', label);
    assert.notEqual(journey.stages.find((s) => s.id === 'BUILDING')?.trafficLight, 'GREEN', label);
    assert.equal(projectGoalBuildConveyorV1([{ buildJourney: journey }]).buildingCount, 0, label);
  }
  const noTrack = projectGoalBuildJourneyV1(goal);
  assert.equal(noTrack.stages.find((s) => s.id === 'PICKED_UP')?.trafficLight, 'AMBER');
  assert.notEqual(noTrack.stages.find((s) => s.id === 'DISPATCHED')?.trafficLight, 'GREEN');
  const qualified = projectGoalBuildJourneyV1(goal, track(7003, [
    gate('ELIGIBLE_GOAL', 'PASS'), gate('SELECT', 'PASS'), gate('MISSION', 'PASS'),
    gate('CLAIM', 'PASS'), gate('WORKER', 'PASS'),
  ]));
  assert.equal(qualified.stages.find((s) => s.id === 'DISPATCHED')?.trafficLight, 'GREEN');
  assert.equal(qualified.logicalWorkerHandoffReported, true);
  for (const id of ['PICKED_UP', 'BUILDING']) {
    assert.notEqual(qualified.stages.find((s) => s.id === id)?.trafficLight, 'GREEN', id);
  }
  assert.equal(projectGoalBuildConveyorV1([{ buildJourney: qualified }]).buildingCount, 0);
  const staleGoal = projectGoalBuildJourneyV1({ ...goal, statusTruth: 'STALE' }, track(7003, [
    gate('CLAIM', 'PASS'), gate('WORKER', 'PASS'),
  ]));
  assert.notEqual(staleGoal.stages.find((s) => s.id === 'PICKED_UP')?.trafficLight, 'GREEN');
  assert.equal(projectGoalBuildConveyorV1([{ buildJourney: staleGoal }]).buildingCount, 0);
});

test('stale build truth cannot paint dispatch pickup or building green', () => {
  const journey = projectGoalBuildJourneyV1({
    issue: '#7007',
    title: 'Stale builder truth',
    state: 'ACTIVE',
    statusTruth: 'CURRENT',
    buildState: 'BUILDING',
    buildTruthTruth: 'STALE',
    selectedForAdmission: true,
    builder: 'openclaw-local',
  });

  assert.notEqual(journey.stages.find((stage) => stage.id === 'SELECTED')?.trafficLight, 'GREEN');
  assert.notEqual(journey.stages.find((stage) => stage.id === 'DISPATCHED')?.trafficLight, 'GREEN');
  assert.notEqual(journey.stages.find((stage) => stage.id === 'PICKED_UP')?.trafficLight, 'GREEN');
  assert.notEqual(journey.stages.find((stage) => stage.id === 'BUILDING')?.trafficLight, 'GREEN');
});

test('non-issue goal identities do not bind to an issue track just because they contain digits', () => {
  const journey = projectGoalBuildJourneyV1({
    goalId: 'release-7001-blue',
    title: 'Release train',
    state: 'READY',
    statusTruth: 'CURRENT',
    buildState: 'QUEUED',
  }, track(7001, [
    gate('ELIGIBLE_GOAL', 'PASS'),
    gate('SELECT', 'PASS'),
    gate('MISSION', 'PASS'),
    gate('CLAIM', 'PASS'),
    gate('WORKER', 'PASS'),
  ]));

  assert.equal(journey.goal, 'release-7001-blue');
  assert.equal(journey.exactAutonomyTrackBound, false);
  assert.notEqual(journey.stages.find((stage) => stage.id === 'PICKED_UP')?.trafficLight, 'GREEN');
});

test('Goal #2961: duplicate worker gate identities refuse false-green physical pickup', () => {
  for (const states of [['BLOCKED', 'PASS'], ['PASS', 'BLOCKED'], ['PASS', 'PASS']]) {
    const journey = projectGoalBuildJourneyV1({
      issue: '#7009', state: 'ACTIVE', statusTruth: 'CURRENT',
      buildState: 'BUILDING', buildTruthTruth: 'CURRENT', builder: 'openclaw-local',
    }, track(7009, [
      gate('CLAIM', 'PASS'),
      gate('WORKER', states[0], 'WORKER_CUSTODY_UNPROVEN'),
      gate('worker', states[1]),
    ]));
    const pickup = journey.stages.find((stage) => stage.id === 'PICKED_UP');
    assert.equal(pickup.trafficLight, 'RED', states.join('/'));
    assert.equal(pickup.reason, 'DUPLICATE_AUTONOMY_GATE_ID');
    assert.notEqual(journey.stages.find((stage) => stage.id === 'BUILDING').trafficLight, 'GREEN');
    assert.equal(journey.currentTrafficLight, 'RED');
    assert.equal(journey.stages.find((stage) => stage.id === 'GOAL').trafficLight, 'GREEN');
  }
});

test('Goal #2961: a blocked/duplicate worker cannot be revived by downstream gate PASS', () => {
  const goal = {
    issue: '#2002', state: 'ACTIVE', statusTruth: 'CURRENT',
    buildState: 'BUILDING', buildTruthTruth: 'CURRENT', builder: 'mission-worker-1',
  };
  const later = ['SOURCE_CHANGED', 'TESTED', 'TERMINAL_RECEIPT'];
  for (const states of [['BLOCKED', 'PASS'], ['PASS', 'BLOCKED'], ['PASS', 'PASS']]) {
    for (const finalGate of later) {
      const gates = [
        gate('CLAIM', 'PASS'), gate('WORKER', states[0]), gate('worker', states[1]),
        gate(finalGate, 'PASS'),
      ];
      const journey = projectGoalBuildJourneyV1(goal, track(2002, gates));
      assert.equal(journey.stages.find((s) => s.id === 'PICKED_UP')?.trafficLight, 'RED');
      for (const id of ['BUILDING', 'BUILT', 'TESTED', 'COMPLETED']) {
        assert.notEqual(journey.stages.find((s) => s.id === id)?.trafficLight, 'GREEN',
          states.join('/') + ':' + finalGate + ':' + id);
      }
      const summary = projectGoalBuildConveyorV1([{ buildJourney: journey }]);
      assert.equal(summary.provenToBuilderCount, 0);
      assert.equal(summary.buildingCount, 0);
      assert.equal(summary.completedCount, 0);
      assert.equal(summary.blockedCount, 1);
    }
  }
  const good = projectGoalBuildJourneyV1(goal, track(2002, [
    gate('ELIGIBLE_GOAL', 'PASS'), gate('SELECT', 'PASS'), gate('MISSION', 'PASS'),
    gate('CLAIM', 'PASS'), gate('WORKER', 'PASS'),
    gate('SOURCE_CHANGED', 'PASS'), gate('TESTED', 'PASS'),
    gate('TERMINAL_RECEIPT', 'PASS'),
  ]));
  assert.equal(good.logicalWorkerHandoffReported, true);
  assert.equal(good.physicalPickupProven, false);
  assert.equal(good.stages.find((s) => s.id === 'PICKED_UP')?.trafficLight, 'AMBER');
  assert.notEqual(good.stages.find((s) => s.id === 'COMPLETED')?.trafficLight, 'GREEN');
  assert.equal(projectGoalBuildConveyorV1([{ buildJourney: good }]).completedCount, 0);
});

test('Goal #2961: upstream eligibility, selection and mission custody never skip into physical GREEN', () => {
  const goal = {
    issue: '#2002', state: 'ACTIVE', statusTruth: 'CURRENT',
    buildState: 'BUILDING', buildTruthTruth: 'CURRENT', builder: 'mission-worker-1',
    selectedForAdmission: true,
  };
  const upstream = ['ELIGIBLE_GOAL', 'SELECT', 'MISSION'];
  const blockedStates = ['BLOCKED', 'WAITING', 'UNKNOWN'];
  const base = [
    gate('ELIGIBLE_GOAL', 'PASS'), gate('SELECT', 'PASS'),
    gate('MISSION', 'PASS'), gate('CLAIM', 'PASS'), gate('WORKER', 'PASS'),
    gate('SOURCE_CHANGED', 'PASS'), gate('TESTED', 'PASS'), gate('TERMINAL_RECEIPT', 'PASS'),
  ];
  for (const id of upstream) {
    for (const state of blockedStates) {
      const changed = base.map((item) => item.id === id ? gate(id, state, 'UPSTREAM_CUSTODY_UNPROVEN') : item);
      const j = projectGoalBuildJourneyV1(goal, track(2002, changed));
      assert.notEqual(j.stages.find((s) => s.id === 'PICKED_UP')?.trafficLight, 'GREEN', id + ':' + state);
      for (const later of ['BUILDING', 'BUILT', 'TESTED', 'COMPLETED']) {
        assert.notEqual(j.stages.find((s) => s.id === later)?.trafficLight, 'GREEN',
          id + ':' + state + ':' + later);
      }
      const totals = projectGoalBuildConveyorV1([{ buildJourney: j }]);
      assert.equal(totals.provenToBuilderCount, 0);
      assert.equal(totals.buildingCount, 0);
      assert.equal(totals.completedCount, 0);
    }
    const missing = projectGoalBuildJourneyV1(goal,
      track(2002, base.filter((item) => item.id !== id)));
    assert.notEqual(missing.stages.find((s) => s.id === 'PICKED_UP')?.trafficLight, 'GREEN', id + ':missing');
    assert.equal(projectGoalBuildConveyorV1([{ buildJourney: missing }]).completedCount, 0);
  }
  const positive = projectGoalBuildJourneyV1(goal, track(2002, base));
  for (const id of ['READY', 'SELECTED', 'MISSION', 'DISPATCHED']) {
    assert.equal(positive.stages.find((s) => s.id === id)?.trafficLight, 'GREEN', id);
  }
  for (const id of ['PICKED_UP', 'BUILDING', 'BUILT', 'TESTED', 'COMPLETED']) {
    assert.notEqual(positive.stages.find((s) => s.id === id)?.trafficLight, 'GREEN', id);
  }
  assert.equal(projectGoalBuildConveyorV1([{ buildJourney: positive }]).completedCount, 0);
});

test('blocked build truth paints the first unresolved handoff red', () => {
  const journey = projectGoalBuildJourneyV1({
    issue: '#7004',
    title: 'Blocked goal',
    state: 'READY',
    statusTruth: 'CURRENT',
    buildState: 'BLOCKED',
    buildBlocker: 'NO_PROVEN_BUILDER_CAPACITY',
  });

  const blocked = journey.stages.find((stage) => stage.trafficLight === 'RED');
  assert.ok(blocked);
  assert.equal(blocked.id, 'SELECTED');
  assert.match(blocked.reason, /NO_PROVEN_BUILDER_CAPACITY/);
});

test('fleet conveyor summarizes per-goal journeys without creating authority', () => {
  const goals = [
    {
      buildJourney: projectGoalBuildJourneyV1({
        issue: '#7005',
        state: 'ACTIVE',
        statusTruth: 'CURRENT',
        buildState: 'BUILDING',
        buildTruthTruth: 'CURRENT',
        builder: 'stephanos-native',
      }),
    },
    {
      buildJourney: projectGoalBuildJourneyV1({
        issue: '#7006',
        state: 'READY',
        statusTruth: 'CURRENT',
        buildState: 'QUEUED',
      }),
    },
  ];
  const conveyor = projectGoalBuildConveyorV1(goals);
  assert.equal(conveyor.visibleGoalCount, 2);
  assert.equal(conveyor.provenToBuilderCount, 0);
  assert.equal(conveyor.buildingCount, 0);
  assert.equal(conveyor.completedCount, 0);
  assert.match(conveyor.truthBoundary, /read-only projection/i);
});

test('Goal #2961: logical WORKER PASS and caller-crafted pickup assertions are not native proof', () => {
  const base = {
    issue: '#2002', state: 'ACTIVE', statusTruth: 'CURRENT',
    buildTruthTruth: 'CURRENT', buildState: 'BUILDING',
    builder: 'mission-worker-1', selectedForAdmission: true,
  };
  const gates = ['ELIGIBLE_GOAL', 'SELECT', 'MISSION', 'CLAIM',
    'WORKER', 'SOURCE_CHANGED', 'TESTED', 'TERMINAL_RECEIPT']
    .map((id) => gate(id, 'PASS'));
  for (const overrides of [
    {},
    { buildProofRefs: ['receipt:fake-started'], nativePickupProven: true },
    { signedGateProof: { verified: true, state: 'PASS' }, buildingProven: true },
  ]) {
    const journey = projectGoalBuildJourneyV1(
      { ...base, ...overrides }, { ...track(2002, gates), physicalPickupProven: true },
    );
    assert.equal(journey.logicalWorkerHandoffReported, true);
    assert.equal(journey.physicalPickupProven, false);
    for (const id of ['PICKED_UP', 'BUILDING', 'BUILT', 'TESTED', 'COMPLETED']) {
      assert.notEqual(journey.stages.find((s) => s.id === id)?.trafficLight,
        'GREEN', id + JSON.stringify(overrides));
    }
    const totals = projectGoalBuildConveyorV1([{ buildJourney: journey }]);
    assert.equal(totals.provenToBuilderCount, 0);
    assert.equal(totals.buildingCount, 0);
    assert.equal(totals.completedCount, 0);
  }
});
