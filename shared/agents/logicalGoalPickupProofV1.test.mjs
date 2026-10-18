import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLogicalGoalBuildTruthV1 } from './logicalGoalPickupProofV1.mjs';

const nowMs = Date.parse('2026-10-18T17:00:00.000Z');
const head = 'a'.repeat(40);
const goal = Object.freeze({
  issue: '#3050', logicalLaneId: 'logical-goal-3050',
  controllerId: 'controller-zero', selectedForAdmission: true,
  state: 'BUILDING',
  lastMaterialProgressAtUtc: new Date(nowMs).toISOString(),
  proofRefs: ['proof/claimed-physical-work'],
});
const truth = Object.freeze({
  schemaVersion: 'stephanos.sovereign-build-truth.v1',
  observedAtUtc: new Date(nowMs).toISOString(),
  goals: [goal],
});
test('uncommissioned public key or missing proof can never authenticate a BUILDING goal', () => {
  const forged = {
    schemaVersion: 'stephanos.logical-goal-pickup-attestation.v1',
    publisherId: 'stephanos-core',
    sourceHead: head,
    signatureBase64: 'a'.repeat(88),
    claims: [{ issue: '#3050', proofRecords: [{ proofRef: 'proof/claimed-physical-work' }] }],
  };
  const result = verifyLogicalGoalBuildTruthV1({
    buildTruth: truth, attestation: forged, proofRecords: [],
    expectedSourceHead: head, nowMs,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOGICAL_GOAL_PINNED_VERIFIER_UNAVAILABLE');
  assert.deepEqual(result.verifiedGoalIds, []);
});
test('a guessed digest or self-described Core identity supplies no independent trust', () => {
  for (const attestation of [null, {}, { sourceHead: head }]) {
    const result = verifyLogicalGoalBuildTruthV1({
      buildTruth: truth, attestation, proofRecords: [],
      expectedSourceHead: head, nowMs,
      trustedPublicKeyPem: 'not-a-public-key',
      trustedPublicKeySha256: 'f'.repeat(64),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.verifiedGoalIds, []);
  }
});
