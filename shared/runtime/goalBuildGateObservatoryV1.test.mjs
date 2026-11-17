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
test('conflicting same-clock signed gate envelopes fail closed in either input order', () => {
  const accepted = buildPacket([observation(1, 'PASS')]);
  const denied = observation(1, 'FAIL', 'ROOT_HELD');
  denied.proof.proofId = 'goal-gate-1-denied';
  denied.gate.proofRef = 'workspace:proof/' + denied.proof.proofId;
  denied.gate.proofRecordSha256 = sha256(denied.proof);
  const refused = buildPacket([denied]);
  for (const statusRecords of [
    [accepted.statusRecords[0], refused.statusRecords[0]],
    [refused.statusRecords[0], accepted.statusRecords[0]],
  ]) {
    const result = projectGoalBuildGateObservatoryV1({
      ...accepted, statusRecords, proofRecords: [accepted.proofRecords[0], denied.proof],
    });
    assert.equal(result.observationStatus, 'UNVERIFIED');
    assert.equal(result.gates[0].status, 'UNVERIFIED');
    assert.equal(result.counts.PASS, 0);
    assert.equal(result.counts.UNVERIFIED, 23);
    assert.equal(result.mergeAuthority, false);
  }
});

test('identical repeated signed envelope at the same instant retains one valid PASS', () => {
  const packet = buildPacket([observation(1, 'PASS')]);
  const result = projectGoalBuildGateObservatoryV1({
    ...packet, statusRecords: [packet.statusRecords[0], packet.statusRecords[0]],
  });
  assert.equal(result.observationStatus, 'EVIDENCE_AVAILABLE');
  assert.equal(result.gates[0].status, 'PASS');
  assert.equal(result.counts.PASS, 1);
});

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


test('signed conflicting duplicate gate identities fail closed rather than choosing a false PASS', () => {
  const pass = observation(19, 'PASS');
  const fail = observation(19, 'FAIL', 'PHYSICAL_PICKUP_CONTRADICTORY');
  fail.proof.summary += ' conflicting receipt';
  fail.gate.proofRecordSha256 = sha256(fail.proof);
  const packet = buildPacket([pass, fail]);
  const r = projectGoalBuildGateObservatoryV1(packet);
  assert.equal(r.observationStatus, 'UNVERIFIED');
  assert.equal(r.gates[18].status, 'UNVERIFIED');
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.counts.FAIL, 0);
  assert.equal(r.approvalAuthority, false);
});

test('signed unknown checkpoint identity cannot be silently dropped while another gate turns green', () => {
  const packet = buildPacket([observation(1, 'PASS'), observation(24, 'PASS')]);
  const r = projectGoalBuildGateObservatoryV1(packet);
  assert.equal(r.observationStatus, 'UNVERIFIED');
  assert.equal(r.gates[0].status, 'UNVERIFIED');
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.counts.UNVERIFIED, 23);
});


test('fresh signed envelope cannot resuscitate an expired immutable proof as green', () => {
  const old = observation(1, 'PASS');
  old.proof.timestampUtc = new Date(nowMs - 11 * 60_000).toISOString();
  old.gate.proofRecordSha256 = sha256(old.proof);
  const r = projectGoalBuildGateObservatoryV1(buildPacket([old]));
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.observationStatus, 'UNVERIFIED');
  assert.equal(r.approvalAuthority, false);
});


test('signed downstream PASS cannot override a failed physical CLAIM prerequisite', () => {
  const r = projectGoalBuildGateObservatoryV1(buildPacket([
    observation(18, 'FAIL', 'CLAIM_HELD'), observation(19, 'PASS'),
  ]));
  assert.equal(r.gates[17].status, 'FAIL');
  assert.equal(r.gates[18].status, 'WAITING_FOR_PREREQUISITE');
  assert.equal(r.gates[18].reportedSignedStatus, 'PASS');
  assert.equal(r.gates[18].waitingOnGate, 18);
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.firstActionableGate, 18);
  assert.equal(r.approvalAuthority, false);
});

test('signed final completion cannot turn GREEN without merge predecessor', () => {
  const r = projectGoalBuildGateObservatoryV1(buildPacket([observation(23, 'PASS')]));
  assert.equal(r.gates[22].status, 'WAITING_FOR_PREREQUISITE');
  assert.equal(r.gates[22].reportedSignedStatus, 'PASS');
  assert.equal(r.gates[22].waitingOnGate, 22);
  assert.equal(r.counts.PASS, 0);
  assert.equal(r.observationStatus, 'EVIDENCE_AVAILABLE');
});

test('a signed source-head PASS cannot bypass failed authenticated ingress', () => {
  const r = projectGoalBuildGateObservatoryV1(buildPacket([
    observation(1, 'FAIL', 'ROOT_HELD'), observation(2, 'PASS'),
  ]));
  assert.equal(r.gates[0].status, 'FAIL');
  assert.equal(r.gates[1].status, 'WAITING_FOR_PREREQUISITE');
  assert.equal(r.gates[1].reportedSignedStatus, 'PASS');
  assert.equal(r.gates[1].waitingOnGate, 1);
});

test('a signed downstream failure is retained as a real veto despite missing prerequisites', () => {
  const r = projectGoalBuildGateObservatoryV1(buildPacket([observation(19, 'FAIL', 'PICKUP_HELD')]));
  assert.equal(r.gates[18].status, 'FAIL');
  assert.equal(r.gates[18].reportedSignedStatus, 'FAIL');
  assert.equal(r.firstActionableGate, 19);
});

test('fully independent signed and proof-backed prerequisite chain retains all 23 PASS', () => {
  const r = projectGoalBuildGateObservatoryV1(buildPacket(
    GOAL_BUILD_GATE_DEFINITIONS_V1.map(def => observation(def.id, 'PASS'))));
  assert.equal(r.counts.PASS, 23);
  assert.equal(r.gates[18].status, 'PASS');
  assert.equal(r.gates[22].status, 'PASS');
  assert.equal(r.gates[22].waitingOnGate, null);
  assert.equal(r.diagnosticOnly, true);
  assert.equal(r.mergeAuthority, false);
});

test('signed PASS checkpoints sharing one immutable proof cannot both turn green', () => {
  const first = observation(1, 'PASS');
  const second = observation(2, 'PASS');
  second.gate.proofRef = first.gate.proofRef;
  second.gate.proofRecordSha256 = first.gate.proofRecordSha256;
  const r = projectGoalBuildGateObservatoryV1(buildPacket([first, second]));
  assert.equal(r.gates[0].status, 'UNVERIFIED');
  assert.equal(r.gates[1].status, 'UNVERIFIED');
  assert.equal(r.counts.PASS, 0);
});

test('shared immutable proof retains a signed FAIL veto but refuses the other PASS', () => {
  const first = observation(1, 'FAIL', 'PROOF_CONFLICT');
  const second = observation(2, 'PASS');
  second.gate.proofRef = first.gate.proofRef;
  second.gate.proofRecordSha256 = first.gate.proofRecordSha256;
  const r = projectGoalBuildGateObservatoryV1(buildPacket([first, second]));
  assert.equal(r.gates[0].status, 'FAIL');
  assert.equal(r.gates[0].typedBlocker, 'PROOF_CONFLICT');
  assert.equal(r.gates[1].status, 'WAITING_FOR_PREREQUISITE');
  assert.deepEqual(r.simultaneousVetoes, [1]);
});

test('two distinct signed and immutable gate proofs preserve legitimate PASS', () => {
  const r = projectGoalBuildGateObservatoryV1(buildPacket([
    observation(1, 'PASS'), observation(2, 'PASS'),
  ]));
  assert.equal(r.gates[0].status, 'PASS');
  assert.equal(r.gates[1].status, 'PASS');
});

function signedDuplicateGatePacket(observedAtUtc = at) {
  const denied = observation(1, 'FAIL', 'ROOT_HELD');
  denied.proof.proofId = 'goal-gate-1-conflicting-denied';
  denied.gate.proofRef = 'workspace:proof/' + denied.proof.proofId;
  denied.gate.proofRecordSha256 = sha256(denied.proof);
  const granted = observation(1, 'PASS');
  granted.proof.proofId = 'goal-gate-1-conflicting-granted';
  granted.gate.proofRef = 'workspace:proof/' + granted.proof.proofId;
  granted.gate.proofRecordSha256 = sha256(granted.proof);
  return buildPacket([denied, granted], { observedAtUtc });
}

test('independently signed malformed same-clock evidence cannot resurrect a valid PASS in either order', () => {
  const valid = buildPacket([observation(1, 'PASS')]);
  const malformed = signedDuplicateGatePacket();
  const proofRecords = [...valid.proofRecords, ...malformed.proofRecords];
  for (const statusRecords of [
    [...valid.statusRecords, ...malformed.statusRecords],
    [...malformed.statusRecords, ...valid.statusRecords],
  ]) {
    const projected = projectGoalBuildGateObservatoryV1({ ...valid, statusRecords, proofRecords });
    assert.equal(projected.observationStatus, 'UNVERIFIED');
    assert.equal(projected.counts.PASS, 0);
    assert.equal(projected.counts.UNVERIFIED, 23);
    assert.equal(projected.gates[0].reportedSignedStatus, null);
    assert.equal(projected.diagnosticOnly, true);
    assert.equal(projected.mergeAuthority, false);
  }
});

test('newer signed malformed gate identity cannot expose an older authenticated PASS', () => {
  const valid = buildPacket([observation(1, 'PASS')]);
  const newer = signedDuplicateGatePacket(new Date(nowMs + 1000).toISOString());
  const projected = projectGoalBuildGateObservatoryV1({
    ...valid, statusRecords: [...valid.statusRecords, ...newer.statusRecords],
    proofRecords: [...valid.proofRecords, ...newer.proofRecords],
  });
  assert.equal(projected.observationStatus, 'UNVERIFIED');
  assert.equal(projected.counts.PASS, 0);
  assert.equal(projected.gates[0].status, 'UNVERIFIED');
  assert.equal(projected.approvalAuthority, false);
});

test('older malformed or unauthenticated peer does not veto a newer valid signed PASS', () => {
  const valid = buildPacket([observation(1, 'PASS')],
    { observedAtUtc: new Date(nowMs + 1000).toISOString() });
  const older = signedDuplicateGatePacket();
  const proofRecords = [...valid.proofRecords, ...older.proofRecords];
  const fresh = projectGoalBuildGateObservatoryV1({
    ...valid, statusRecords: [...older.statusRecords, ...valid.statusRecords], proofRecords,
  });
  assert.equal(fresh.gates[0].status, 'PASS');
  assert.equal(fresh.counts.PASS, 1);
  const forgedRecord = {
    ...older.statusRecords[0], goalBuildGateEvidence: {
      ...older.statusRecords[0].goalBuildGateEvidence,
      signatureBase64: Buffer.alloc(64).toString('base64'),
    },
  };
  const sameClockValid = buildPacket([observation(1, 'PASS')]);
  const invalid = projectGoalBuildGateObservatoryV1({
    ...sameClockValid,
    statusRecords: [forgedRecord, ...sameClockValid.statusRecords],
    proofRecords: [...sameClockValid.proofRecords, ...older.proofRecords],
  });
  assert.equal(invalid.gates[0].status, 'PASS');
  assert.equal(invalid.counts.PASS, 1);
});
