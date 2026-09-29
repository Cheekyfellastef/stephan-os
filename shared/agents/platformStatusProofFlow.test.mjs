import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION,
  buildPlatformStatusProofFlowContract,
  createPlatformStatusProofClaim,
  evaluatePlatformStatusProofFlow,
} from './platformStatusProofFlow.mjs';

test('platform status proof flow contract protects reality evidence boundaries', () => {
  const contract = buildPlatformStatusProofFlowContract();

  assert.equal(contract.schemaVersion, PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION);
  assert.equal(contract.requiredEvidence.includes('support-snapshot'), true);
  assert.equal(contract.requiredEvidence.includes('ui-reality'), true);
  assert.equal(contract.guardrails.fakeHealthyStatusAllowed, false);
  assert.equal(contract.guardrails.logOnlyProofAllowed, false);
});

test('platform status claim normalizes proof references without inventing health', () => {
  const claim = createPlatformStatusProofClaim({
    claimId: 'status-proof-1',
    status: 'collecting',
    summary: 'Verify current platform status.',
    supportSnapshotRefs: ['support/snapshot.json'],
    uiRealityRefs: ['ui/reality.png'],
    commandProofRefs: ['proof/node-test.txt'],
  });

  assert.equal(claim.kind, 'stephanos.platform_status_proof_flow.claim');
  assert.equal(claim.status, 'collecting');
  assert.deepEqual(claim.supportSnapshotRefs, ['support/snapshot.json']);
  assert.deepEqual(claim.uiRealityRefs, ['ui/reality.png']);
  assert.deepEqual(claim.commandProofRefs, ['proof/node-test.txt']);
});

test('proof flow blocks platform status when required reality evidence is missing', () => {
  const evaluation = evaluatePlatformStatusProofFlow({
    claimId: 'status-proof-blocked',
    supportSnapshotRefs: ['support/snapshot.json'],
  });

  assert.equal(evaluation.finalVerdict, 'PLATFORM_STATUS_PROOF_BLOCKED');
  assert.equal(evaluation.status, 'blocked');
  assert.deepEqual(evaluation.blockers, ['MISSING_UI_REALITY_PROOF', 'MISSING_COMMAND_PROOF']);
});

test('proof flow verifies only after support snapshot, UI reality, and command proof exist', () => {
  const evaluation = evaluatePlatformStatusProofFlow({
    claimId: 'status-proof-verified',
    supportSnapshotRefs: ['support/snapshot.json'],
    uiRealityRefs: ['ui/reality.png'],
    commandProofRefs: ['proof/node-test.txt'],
  });

  assert.equal(evaluation.finalVerdict, 'PLATFORM_STATUS_PROOF_VERIFIED');
  assert.equal(evaluation.status, 'verified');
  assert.deepEqual(evaluation.blockers, []);
  assert.deepEqual(evaluation.proofRefs, ['support/snapshot.json', 'ui/reality.png', 'proof/node-test.txt']);
});
