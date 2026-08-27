import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ELASTIC_FIVE_LANE_CLOSED_CHAT_REQUIRED_PROOFS_V1,
  projectElasticFiveLaneClosedChatCutoverShadowV1,
} from './elasticFiveLaneClosedChatCutoverShadowV1.mjs';

const HEAD = 'a'.repeat(40);

function fixture(overrides = {}) {
  const checkpointId = 'checkpoint-five-lane-closed-chat-0001';
  const currentController = {
    controllerId: 'native-controller-1557',
    sourceHead: HEAD,
    leaseId: 'lease-native-controller-1557',
    state: 'RUNNING',
  };
  return {
    sourceHead: HEAD,
    currentController,
    candidate: {
      fabricId: 'candidate-five-lane-1637',
      sourceHead: HEAD,
      checkpointId,
      checkpointSha256: 'b'.repeat(64),
      lanes: Array.from({ length: 5 }, (_, index) => ({
        laneId: `lane-${index + 1}`,
        resourceId: `resource:${index + 1}`,
        writerLeaseOwner: index === 0 ? 'native-controller-1557' : '',
      })),
    },
    rollbackTarget: {
      controllerId: currentController.controllerId,
      sourceHead: HEAD,
      leaseId: currentController.leaseId,
    },
    proofs: ELASTIC_FIVE_LANE_CLOSED_CHAT_REQUIRED_PROOFS_V1.map((proofType) => ({
      proofType,
      receiptId: `receipt-${proofType.toLowerCase().replaceAll('_', '-')}`,
      sourceHead: HEAD,
      checkpointId,
      state: 'PROVEN',
      verified: true,
    })),
    ...overrides,
  };
}

test('proves closed-chat checkpoint and rollback identity in shadow without transferring authority', () => {
  const result = projectElasticFiveLaneClosedChatCutoverShadowV1(fixture());
  assert.equal(result.state, 'SHADOW_READY');
  assert.equal(result.closedChatRecoveryShadowProven, true);
  assert.equal(result.rollbackShadowProven, true);
  assert.equal(result.cutoverEligibleInShadow, true);
  assert.equal(result.currentControllerRemainsCanonical, true);
  assert.equal(result.rollbackTarget.controllerId, 'native-controller-1557');
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('restores the same shadow result from a durable closed-chat JSON checkpoint', () => {
  const beforeClose = fixture();
  const afterNewChat = JSON.parse(JSON.stringify(beforeClose));
  const beforeResult = projectElasticFiveLaneClosedChatCutoverShadowV1(beforeClose);
  const afterResult = projectElasticFiveLaneClosedChatCutoverShadowV1(afterNewChat);
  assert.deepEqual(afterResult, beforeResult);
  assert.equal(afterResult.finalVerdict, 'ELASTIC_FIVE_LANE_CLOSED_CHAT_CUTOVER_SHADOW_READY_NO_AUTHORITY');
});

test('missing or duplicated acceptance evidence fails closed', () => {
  const missing = fixture();
  missing.proofs = missing.proofs.filter((proof) => proof.proofType !== 'ROLLBACK_READINESS');
  const missingResult = projectElasticFiveLaneClosedChatCutoverShadowV1(missing);
  assert.equal(missingResult.state, 'SAFE_HOLD');
  assert.deepEqual(missingResult.reasonCodes, ['MISSING_ROLLBACK_READINESS_PROOF']);

  const duplicate = fixture();
  duplicate.proofs.push({ ...duplicate.proofs[0], receiptId: 'receipt-duplicate' });
  const duplicateResult = projectElasticFiveLaneClosedChatCutoverShadowV1(duplicate);
  assert.equal(duplicateResult.state, 'SAFE_HOLD');
  assert.deepEqual(duplicateResult.reasonCodes, ['DUPLICATE_CLOSED_CHAT_RECOVERY_PROOF']);
});

test('head movement or inactive current controller cannot become cutover eligible', () => {
  const moved = fixture();
  moved.candidate.sourceHead = 'c'.repeat(40);
  const movedResult = projectElasticFiveLaneClosedChatCutoverShadowV1(moved);
  assert.equal(movedResult.state, 'SAFE_HOLD');
  assert.ok(movedResult.reasonCodes.includes('CANDIDATE_NOT_EXACT_SOURCE'));
  assert.equal(movedResult.currentControllerRemainsCanonical, true);

  const inactive = fixture();
  inactive.currentController.state = 'UNKNOWN';
  const inactiveResult = projectElasticFiveLaneClosedChatCutoverShadowV1(inactive);
  assert.equal(inactiveResult.state, 'SAFE_HOLD');
  assert.ok(inactiveResult.reasonCodes.includes('CURRENT_CONTROLLER_NOT_ACTIVE'));
});

test('rollback must target the exact current native controller lease and source', () => {
  const input = fixture();
  input.rollbackTarget = { ...input.rollbackTarget, controllerId: 'candidate-controller-1637' };
  const result = projectElasticFiveLaneClosedChatCutoverShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.ok(result.reasonCodes.includes('ROLLBACK_CONTROLLER_IDENTITY_MISMATCH'));
  assert.equal(result.rollbackTarget.controllerId, 'native-controller-1557');
  assert.equal(result.authority.rollbackExecutionAllowed, false);
});

test('multiple mutation writers for one resource force safe hold', () => {
  const input = fixture();
  input.candidate.lanes[0] = {
    ...input.candidate.lanes[0], resourceId: 'repo:main', writerLeaseOwner: 'writer-a',
  };
  input.candidate.lanes[1] = {
    ...input.candidate.lanes[1], resourceId: 'repo:main', writerLeaseOwner: 'writer-b',
  };
  const result = projectElasticFiveLaneClosedChatCutoverShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.ok(result.reasonCodes.includes('MULTIPLE_MUTATION_WRITERS_FOR_RESOURCE'));
  assert.equal(result.authority.sourceMutationAllowed, false);
});

test('unverified or stale-head proof is rejected and cannot grant cutover', () => {
  const input = fixture();
  input.proofs[0] = { ...input.proofs[0], verified: false };
  input.proofs[1] = { ...input.proofs[1], sourceHead: 'd'.repeat(40) };
  const result = projectElasticFiveLaneClosedChatCutoverShadowV1(input);
  assert.equal(result.state, 'SAFE_HOLD');
  assert.equal(result.cutoverEligibleInShadow, false);
  assert.equal(result.authority.fiveLaneCutoverAllowed, false);
});
