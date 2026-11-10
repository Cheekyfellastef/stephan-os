import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGoalBuildConveyorOverviewV1 as overview } from './goalBuildConveyorOverviewV1.mjs';

const NOW = Date.parse('2026-11-08T22:00:00Z');
const at = offsetMs => new Date(NOW + offsetMs).toISOString();
const projection = controllers => ({ controllerFleet: { controllers } });
const item = (id, extras = {}) => ({
  controllerId: id, title: id, activityState: 'BUILDING',
  freshness: 'CURRENT', timestampUtc: at(-1000), trafficLight: 'GREEN', ...extras,
});

test('Goal #2961: old, future and declared-stale reports never retain a green controller light', () => {
  const input = projection([
    item('live'), item('expired', { timestampUtc: at(-600001) }),
    item('future', { timestampUtc: at(1000) }),
    item('declared-stale', { freshness: 'STALE' }),
    item('unknown', { freshness: 'UNKNOWN' }),
    item('missing-clock', { timestampUtc: '' }),
    item('invalid-light', { trafficLight: 'UNKNOWN_GREEN' }),
  ]);
  const snapshot = structuredClone(input);
  const cards = overview(input, { nowMs: NOW }).controllers;
  assert.deepEqual(input, snapshot, 'pure read-only projection');
  assert.deepEqual(cards.map(card => card.trafficLight),
    ['AMBER', 'GREY', 'GREY', 'GREY', 'GREY', 'GREY', 'GREY']);
  assert.deepEqual(cards.map(card => card.truth),
    ['CURRENT', 'STALE', 'STALE', 'STALE', 'UNKNOWN', 'STALE', 'CURRENT']);
  assert.equal(cards[0].expiresAtUtc, at(-1000 + 600000));
  for (const card of cards.slice(1, 6)) assert.equal(card.expiresAtUtc, '');
});

test('Goal #2961: fresh negative and degraded lights survive while stale ones expire', () => {
  const cards = overview(projection([
    item('red', { trafficLight: 'RED' }),
    item('amber', { trafficLight: 'AMBER' }),
    item('lowercase', { trafficLight: 'green' }),
    item('expired-red', { trafficLight: 'RED', timestampUtc: at(-700000) }),
    item('fresh-unknown', { trafficLight: null }),
  ]), { nowMs: NOW }).controllers;
  assert.deepEqual(cards.map(card => card.trafficLight),
    ['RED', 'AMBER', 'AMBER', 'GREY', 'GREY']);
  assert.equal(cards[3].truth, 'STALE');
  assert.equal(cards[3].expiresAtUtc, '');
  assert.equal(cards[4].truth, 'CURRENT');
});

// A current system-wide signed gate-19 proof is not bound to an individual
// controller or worker and cannot promote its self-reported BUILDING light.
test('Goal #2002: a reusable gate-19 proof cannot certify controller BUILDING', () => {
  const proofRef = 'workspace:proof/gate-19';
  const input = projection([item('with-proof', { proofRefs: [proofRef] }),
    item('without-proof', { proofRefs: ['self-declared'] })]);
  input.goalBuildGateObservatory = {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    sourceHead: 'a'.repeat(40), observedAtUtc: at(-1000),
    observationStatus: 'EVIDENCE_AVAILABLE', gates: [
      ...[4, 5, 7, 6].map(id => ({ id, status: 'PASS',
        observedAtUtc: at(-1000), proofRef: 'workspace:proof/gate-' + id })),
      { id: 18, status: 'PASS', observedAtUtc: at(-1000), proofRef: 'workspace:proof/gate-18' },
      { id: 19, status: 'PASS', observedAtUtc: at(-1000), proofRef },
    ],
  };
  const output = overview(input, { nowMs: NOW });
  assert.deepEqual(output.controllers.map(c => c.trafficLight), ['AMBER', 'AMBER']);
  assert.equal(output.stages.find(stage => stage.id === 'pickup').state, 'PROVEN');
});

const signedGate = (id, status = 'PASS', extra = {}) => ({
  id, status, observedAtUtc: at(-1000), proofRef: 'workspace:proof/gate-' + id,
  ...extra,
});
const physicalStage = signedGates => {
  const input = projection([]);
  input.goalBuildGateObservatory = {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    sourceHead: 'a'.repeat(40), observedAtUtc: at(-1000),
    observationStatus: 'EVIDENCE_AVAILABLE', gates: signedGates,
  };
  return overview(input, { nowMs: NOW }).stages.find(stage => stage.id === 'pickup');
};

test('Goal #2002: signed pickup requires admission, SELECT, CLAIM and pickup proofs', () => {
  const validIds = [4, 5, 7, 6, 18, 19];
  const valid = validIds.map(id => signedGate(id));
  assert.equal(physicalStage(valid).state, 'PROVEN');
  assert.equal(physicalStage(valid).trafficLight, 'GREEN');
  for (const missing of validIds) {
    const stage = physicalStage(valid.filter(gate => gate.id !== missing));
    assert.notEqual(stage.state, 'PROVEN', 'missing required gate ' + missing);
    assert.notEqual(stage.trafficLight, 'GREEN', 'missing required gate ' + missing);
  }
});

test('Goal #2002: WAITING, STALE and proofless SELECT cannot certify pickup', () => {
  const valid = [4, 5, 7, 6, 18, 19].map(id => signedGate(id));
  for (const invalid of [
    { status: 'WAITING_FOR_PREREQUISITE' },
    { status: 'STALE' },
    { proofRef: '' },
    { observedAtUtc: at(1000) },
  ]) {
    const gates = valid.map(gate => gate.id === 6 ? signedGate(6, 'PASS', invalid) : gate);
    assert.notEqual(physicalStage(gates).trafficLight, 'GREEN',
      'unproven SELECT must not certify pickup: ' + JSON.stringify(invalid));
  }
  const failed = valid.map(gate => gate.id === 6 ? signedGate(6, 'FAIL') : gate);
  assert.notEqual(physicalStage(failed).trafficLight, 'GREEN');
});

test('Goal #2002: duplicate signed gate identities cannot independently certify pickup', () => {
  const valid = [4, 5, 7, 6, 18, 19].map(id => signedGate(id));
  const duplicatedSelect = [...valid, signedGate(6)];
  assert.notEqual(physicalStage(duplicatedSelect).trafficLight, 'GREEN');
  assert.equal(physicalStage(valid).state, 'PROVEN');
});
