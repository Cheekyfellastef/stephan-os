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
  for (const id of ['GOAL', 'READY', 'SELECTED', 'MISSION', 'DISPATCHED', 'PICKED_UP', 'BUILDING']) {
    assert.equal(journey.stages.find((stage) => stage.id === id)?.trafficLight, 'GREEN', id);
  }
  assert.equal(journey.stages.find((stage) => stage.id === 'BUILT')?.trafficLight, 'GREY');
  assert.equal(journey.currentStage, 'BUILT');
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

test('build truth can prove live builder pickup without fabricating later completion', () => {
  const journey = projectGoalBuildJourneyV1({
    issue: '#7003',
    title: 'Live builder truth',
    state: 'ACTIVE',
    statusTruth: 'CURRENT',
    buildState: 'BUILDING',
    buildTruthTruth: 'CURRENT',
    builder: 'foundry-forge',
  });

  assert.equal(journey.stages.find((stage) => stage.id === 'DISPATCHED')?.trafficLight, 'GREEN');
  assert.equal(journey.stages.find((stage) => stage.id === 'PICKED_UP')?.trafficLight, 'GREEN');
  assert.equal(journey.stages.find((stage) => stage.id === 'BUILDING')?.trafficLight, 'GREEN');
  assert.equal(journey.stages.find((stage) => stage.id === 'BUILT')?.trafficLight, 'GREY');
  assert.equal(journey.stages.find((stage) => stage.id === 'COMPLETED')?.trafficLight, 'GREY');
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
  assert.equal(conveyor.provenToBuilderCount, 1);
  assert.equal(conveyor.buildingCount, 1);
  assert.equal(conveyor.completedCount, 0);
  assert.match(conveyor.truthBoundary, /read-only projection/i);
});
