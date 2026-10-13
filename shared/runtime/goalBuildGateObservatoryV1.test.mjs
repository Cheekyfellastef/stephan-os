import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOAL_BUILD_GATE_DEFINITIONS_V1, GOAL_BUILD_GATE_SCHEMA_V1,
  projectGoalBuildGateObservatoryV1,
} from './goalBuildGateObservatoryV1.mjs';

const t0 = Date.parse('2026-10-13T12:39:00Z');
const at = '2026-10-13T12:39:00Z';
const head = 'a'.repeat(40);
function gate(id, status, typedBlocker = '') {
  return {
    id, status, observedAtUtc: at, sourceHead: head,
    proofRef: 'receipt:github-command-mailbox/verified-' + id,
    typedBlocker,
  };
}
function statusRecords(gates, extra = {}) {
  return [{ goalBuildGateEvidence: {
    schemaVersion: GOAL_BUILD_GATE_SCHEMA_V1,
    sourceHead: head, observedAtUtc: at, gates, ...extra,
  } }];
}

test('23 causal checkpoints are distinct and default to UNVERIFIED rather than green', () => {
  const r = projectGoalBuildGateObservatoryV1({ nowMs: t0 });
  assert.equal(GOAL_BUILD_GATE_DEFINITIONS_V1.length, 23);
  assert.deepEqual(GOAL_BUILD_GATE_DEFINITIONS_V1.map(g => g.id), Array.from({ length: 23 }, (_, i) => i + 1));
  assert.equal(r.gates.length, 23);
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.counts.UNVERIFIED, 23);
  assert.equal(r.firstActionableGate, null);
  assert.equal(r.approvalAuthority, false);
  assert.equal(r.mergeAuthority, false);
});

test('parallel lease and capacity vetoes both remain visible, downstream stages wait', () => {
  const entries = [
    gate(1, 'PASS'), gate(2, 'PASS'), gate(4, 'PASS'),
    gate(5, 'PASS'), gate(6, 'PASS'),
    gate(7, 'FAIL', 'AUTHORITATIVE_PROGRAMME_HOLD'),
    gate(8, 'FAIL', 'ELASTIC_LEASE_EXPIRED'),
    gate(9, 'FAIL', 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING'),
    gate(13, 'FAIL', 'SOURCE-HEAD-INVALID'),
  ];
  const r = projectGoalBuildGateObservatoryV1({ statusRecords: statusRecords(entries), nowMs: t0 });
  assert.deepEqual(r.simultaneousVetoes, [7, 8, 9, 13]);
  assert.equal(r.firstActionableGate, 7);
  assert.equal(r.gates[13].status, 'WAITING_FOR_PREREQUISITE');
  assert.equal(r.gates[15].status, 'WAITING_FOR_PREREQUISITE');
  assert.equal(r.gates[18].status, 'WAITING_FOR_PREREQUISITE');
  assert.equal(r.gates[12].status, 'FAIL');
  assert.equal(r.gates[1].status, 'PASS');
});

test('unsupported statuses, proof-free green, head mismatch and fabricated blocker fail closed', () => {
  const samples = [
    gate(1, 'PASS'),
    { ...gate(2, 'PASS'), proofRef: '' },
    { ...gate(3, 'PASS'), sourceHead: 'b'.repeat(40) },
    { ...gate(4, 'FAIL'), typedBlocker: '' },
    { ...gate(5, 'PASS'), proofRef: 'http://attacker.example/fake' },
    { ...gate(6, 'OVERRIDE') },
  ];
  const r = projectGoalBuildGateObservatoryV1({ statusRecords: statusRecords(samples), nowMs: t0 });
  assert.equal(r.gates[0].status, 'PASS');
  assert.equal(r.gates[1].status, 'UNVERIFIED');
  assert.equal(r.gates[2].status, 'UNVERIFIED');
  assert.equal(r.gates[3].status, 'UNVERIFIED');
  assert.equal(r.gates[4].status, 'UNVERIFIED');
  assert.equal(r.gates[5].status, 'UNVERIFIED');
});

test('stale observations lose their green state and cannot authorize action', () => {
  const r = projectGoalBuildGateObservatoryV1({
    statusRecords: statusRecords([gate(1, 'PASS'), gate(7, 'FAIL', 'PROGRAMME_HOLD')]),
    nowMs: t0 + 11 * 60_000,
  });
  assert.equal(r.gates[0].status, 'STALE');
  assert.equal(r.gates[6].status, 'STALE');
  assert.equal(r.firstActionableGate, null);
  assert.equal(r.observationStatus, 'STALE');
  assert.equal(r.diagnosticOnly, true);
});

test('an explicit exact-source fresh PASS is still only read-only evidence, never merge authority', () => {
  const all = Array.from({ length: 23 }, (_, i) => gate(i + 1, 'PASS'));
  const r = projectGoalBuildGateObservatoryV1({
    statusRecords: statusRecords(all), nowMs: t0,
  });
  assert.equal(r.counts.PASS, 23);
  assert.equal(r.approvalAuthority, false);
  assert.equal(r.mergeAuthority, false);
  assert.equal(r.diagnosticOnly, true);
});
