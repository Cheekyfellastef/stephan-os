import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  GOAL_BUILD_GATE_DEFINITIONS_V1, GOAL_BUILD_GATE_SCHEMA_V1,
  GOAL_GATE_SIGNATURE_DOMAIN, projectGoalBuildGateObservatoryV1,
} from './goalBuildGateObservatoryV1.mjs';

const at = '2026-10-13T12:39:00Z';
const nowMs = Date.parse(at);
const head = 'a'.repeat(40);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = createHash('sha256').update(pem).digest('hex');
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function observation(id, status, typedBlocker = '') {
  const proof = {
    kind: 'proof', proofId: 'goal-gate-' + id,
    sourceHead: head, timestampUtc: at, summary: 'Immutable test proof gate ' + id,
  };
  return {
    gate: { id, status, observedAtUtc: at, sourceHead: head,
      proofRef: 'workspace:proof/' + proof.proofId,
      proofRecordSha256: sha256(proof), typedBlocker },
    proof,
  };
}
function buildPacket(entries = [], envelopeOverrides = {}, recordOverrides = {}) {
  const signed = {
    schemaVersion: GOAL_BUILD_GATE_SCHEMA_V1,
    publisherId: 'stephanos-core',
    signingKeyId: 'stephanos-goal-build-gates-v1',
    sourceHead: head, observedAtUtc: at, gates: entries.map(e => e.gate),
    ...envelopeOverrides,
  };
  const signatureBase64 = sign(null,
    Buffer.from(GOAL_GATE_SIGNATURE_DOMAIN + JSON.stringify(signed)), privateKey).toString('base64');
  const statusRecord = {
    kind: 'status', statusId: 'goal-build-gates-current',
    participantId: 'stephanos-core',
    goalBuildGateEvidence: { ...signed, signatureBase64 },
    ...recordOverrides,
  };
  return { statusRecords: [statusRecord], proofRecords: entries.map(e => e.proof),
    expectedSourceHead: head, trustedPublicKeyPem: pem,
    trustedPublicKeySha256: fingerprint, nowMs };
}
test('23 causal checkpoints default to unverified, never green merely because no blockers were supplied', () => {
  const r = projectGoalBuildGateObservatoryV1({ nowMs });
  assert.equal(GOAL_BUILD_GATE_DEFINITIONS_V1.length, 23);
  assert.deepEqual(GOAL_BUILD_GATE_DEFINITIONS_V1.map(g => g.id), Array.from({ length: 23 }, (_, i) => i + 1));
  assert.equal(r.counts.UNVERIFIED, 23);
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.diagnosticOnly, true);
  assert.equal(r.approvalAuthority, false);
  assert.equal(r.mergeAuthority, false);
});

test('two independently signed and receipt-backed vetoes survive causal waiting', () => {
  const entries = [
    observation(1, 'PASS'), observation(2, 'PASS'), observation(4, 'PASS'),
    observation(5, 'PASS'), observation(6, 'PASS'),
    observation(7, 'FAIL', 'AUTHORITATIVE_PROGRAMME_HOLD'),
    observation(8, 'FAIL', 'ELASTIC_LEASE_EXPIRED'),
    observation(9, 'FAIL', 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING'),
    observation(13, 'FAIL', 'SOURCE-HEAD-INVALID'),
  ];
  const r = projectGoalBuildGateObservatoryV1(buildPacket(entries));
  assert.equal(r.observationStatus, 'EVIDENCE_AVAILABLE');
  assert.deepEqual(r.simultaneousVetoes, [7, 8, 9, 13]);
  assert.equal(r.firstActionableGate, 7);
  assert.equal(r.gates[12].status, 'FAIL');
  assert.equal(r.gates[13].status, 'UNVERIFIED');
  assert.equal(r.gates[15].status, 'WAITING_FOR_PREREQUISITE');
  assert.equal(r.gates[18].status, 'WAITING_FOR_PREREQUISITE');
});

test('generic valid Shared Workspace status with forged PASS is always UNVERIFIED', () => {
  const forged = {
    kind: 'status', statusId: 'goal-build-gates-current',
    participantId: 'stephanos-core',
    goalBuildGateEvidence: {
      schemaVersion: GOAL_BUILD_GATE_SCHEMA_V1,
      sourceHead: head, observedAtUtc: at,
      gates: [{ id: 22, status: 'PASS', sourceHead: head,
        observedAtUtc: at, proofRef: 'receipt:anything' }],
    },
  };
  const r = projectGoalBuildGateObservatoryV1({
    statusRecords: [forged], nowMs, proofRecords: [],
  });
  assert.equal(r.gates[21].status, 'UNVERIFIED');
  assert.equal(r.counts.PASS, 0);
});

test('wrong canonical head, key fingerprint, signature or proof record refuses all gate PASS', () => {
  const e = observation(22, 'PASS');
  const good = buildPacket([e]);
  const cases = [
    { ...good, expectedSourceHead: 'b'.repeat(40) },
    { ...good, trustedPublicKeySha256: 'c'.repeat(64) },
    { ...good, trustedPublicKeyPem: '' },
    { ...good, proofRecords: [] },
    { ...good, proofRecords: [{ ...e.proof, summary: 'substituted contents' }] },
    { ...good, statusRecords: [{
      ...good.statusRecords[0], goalBuildGateEvidence: {
        ...good.statusRecords[0].goalBuildGateEvidence,
        gates: [{ ...e.gate, status: 'FAIL', typedBlocker: 'SPOOFED' }],
      },
    }] },
    { ...good, statusRecords: [{ ...good.statusRecords[0], participantId: 'attacker' }] },
  ];
  for (const c of cases) {
    const r = projectGoalBuildGateObservatoryV1(c);
    assert.equal(r.gates[21].status, 'UNVERIFIED');
    assert.equal(r.counts.PASS, 0);
  }
});

test('stale signed records lose PASS without being treated as cleared', () => {
  const r = projectGoalBuildGateObservatoryV1({
    ...buildPacket([observation(1, 'PASS')]), nowMs: nowMs + 11 * 60_000,
  });
  assert.equal(r.gates[0].status, 'STALE');
  assert.equal(r.observationStatus, 'STALE');
  assert.equal(r.counts.PASS, 0);
});

test('even a fully trusted set of 23 PASS records grants no source, lease or merge authority', () => {
  const records = Array.from({ length: 23 }, (_, i) => observation(i + 1, 'PASS'));
  const r = projectGoalBuildGateObservatoryV1(buildPacket(records));
  assert.equal(r.counts.PASS, 23);
  assert.equal(r.approvalAuthority, false);
  assert.equal(r.mergeAuthority, false);
  assert.equal(r.diagnosticOnly, true);
});
