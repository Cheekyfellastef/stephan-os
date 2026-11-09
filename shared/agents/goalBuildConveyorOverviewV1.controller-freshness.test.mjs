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

// A fresh controller report is not physical pickup. A separate qualified
// signed pickup and matching proof reference permit the positive control.
test('Goal #2002: current controller GREEN needs source-qualified signed pickup', () => {
  const proofRef = 'workspace:proof/gate-19';
  const input = projection([item('with-proof', { proofRefs: [proofRef] }),
    item('without-proof', { proofRefs: ['self-declared'] })]);
  input.goalBuildGateObservatory = {
    schemaVersion: 'stephanos.goal-build-gate-observatory.v1',
    diagnosticOnly: true, approvalAuthority: false, mergeAuthority: false,
    sourceHead: 'a'.repeat(40), observedAtUtc: at(-1000),
    observationStatus: 'EVIDENCE_AVAILABLE', gates: [
      { id: 19, status: 'PASS', observedAtUtc: at(-1000), proofRef },
    ],
  };
  const output = overview(input, { nowMs: NOW });
  assert.deepEqual(output.controllers.map(c => c.trafficLight), ['GREEN', 'AMBER']);
  assert.equal(output.stages.find(stage => stage.id === 'pickup').state, 'PROVEN');
});
