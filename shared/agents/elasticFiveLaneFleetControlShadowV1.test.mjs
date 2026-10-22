import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1,
  projectElasticFiveLaneFleetControlShadowV1,
} from './elasticFiveLaneFleetControlShadowV1.mjs';

const HEAD = 'a'.repeat(40);

function lanes(states = ['RUNNING', 'ELIGIBLE', 'IDLE', 'ELIGIBLE', 'RUNNING']) {
  const roles = ['source', 'review', 'proof', 'runtime', 'experience'];
  return states.map((state, index) => ({
    laneId: `lane-${index + 1}`,
    role: roles[index] || `elastic-${index + 1}`,
    resourceId: `resource:${index + 1}`,
    writerLeaseOwner: index === 0 ? 'canonical-native-controller' : '',
    state,
  }));
}

function project(signal, fleet = lanes()) {
  return projectElasticFiveLaneFleetControlShadowV1({ sourceHead: HEAD, signal, lanes: fleet });
}

test('isolates one blocked lane while four resource-disjoint lanes continue in shadow', () => {
  const result = project('RUN', lanes(['BLOCKED', 'RUNNING', 'ELIGIBLE', 'IDLE', 'RUNNING']));
  assert.equal(result.state, 'RUNNING_SHADOW');
  assert.equal(result.blockedLaneIsolationProven, true);
  assert.equal(result.oneWriterPerResourceProven, true);
  assert.equal(result.lanes.filter((lane) => lane.action === 'BLOCKED').length, 1);
  assert.equal(result.lanes.filter((lane) => lane.action === 'CONTINUE_SHADOW').length, 4);
  assert.equal(result.authority.canonicalControllerAuthorityTransferred, false);
  assert.equal(result.authority.fiveLaneCutoverAllowed, false);
});

for (const [signal, expectedState, laneAction] of [
  [ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1.STOP, 'STOPPED', 'STOPPED'],
  [ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1.PAUSE, 'PAUSE', 'PAUSE'],
  [ELASTIC_FIVE_LANE_FLEET_SIGNALS_V1.SAFE_HOLD, 'SAFE_HOLD', 'SAFE_HOLD'],
]) {
  test(`propagates fleet-wide ${signal} to every lane without granting authority`, () => {
    const result = project(signal);
    assert.equal(result.state, expectedState);
    assert.equal(result.fleetPropagationProven, true);
    assert.equal(result.lanes.length, 5);
    assert.ok(result.lanes.every((lane) => lane.action === laneAction));
    assert.ok(result.lanes.every((lane) => lane.mutationAllowed === false));
    assert.ok(Object.values(result.authority).every((value) => value === false));
  });
}

test('unknown fleet control fails closed across the whole fleet', () => {
  const result = project('CONTINUE_AND_MUTATE');
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['UNKNOWN_FLEET_SIGNAL']);
  assert.ok(result.lanes.every((lane) => lane.action === 'SAFE_HOLD'));
});

test('multiple writers for one resource force fleet safe hold', () => {
  const fleet = lanes();
  fleet[0] = { ...fleet[0], resourceId: 'repo:main', writerLeaseOwner: 'writer-a' };
  fleet[1] = { ...fleet[1], resourceId: 'repo:main', writerLeaseOwner: 'writer-b' };
  const result = project('RUN', fleet);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.deepEqual(result.reasonCodes, ['MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE']);
  assert.equal(result.oneWriterPerResourceProven, false);
});

test('fewer than five lanes or an unbound source head cannot claim shadow acceptance', () => {
  const shortFleet = project('RUN', lanes().slice(0, 4));
  assert.equal(shortFleet.state, 'SAFE_HOLD');
  assert.deepEqual(shortFleet.reasonCodes, ['FIVE_LANE_MINIMUM_NOT_PROVEN']);

  const noHead = projectElasticFiveLaneFleetControlShadowV1({
    sourceHead: 'unknown',
    signal: 'RUN',
    lanes: lanes(),
  });
  assert.equal(noHead.state, 'SAFE_HOLD');
  assert.deepEqual(noHead.reasonCodes, ['EXACT_SOURCE_HEAD_UNPROVEN']);
});
