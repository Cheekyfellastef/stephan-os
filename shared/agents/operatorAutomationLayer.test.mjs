import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATOR_DECISION_STATUS,
  applyOperatorApproval,
  buildOperatorAutomationLayerContract,
  createOperatorAutomationBatch,
  createOperatorDecision,
  validateOperatorDecision,
} from './operatorAutomationLayer.mjs';

const headSha = '96e1b21c2264fb17e14e754e1d1bb13ee10e2c67';

test('contract exposes click-reduction and approval guardrails', () => {
  const contract = buildOperatorAutomationLayerContract();

  assert.equal(contract.guardrails.bestClickIsNoClick, true);
  assert.equal(contract.guardrails.approvalSpoofingAllowed, false);
  assert.equal(contract.guardrails.implicitMergeApprovalAllowed, false);
  assert.equal(contract.guardrails.exactHeadShaRequiredForMerge, true);
  assert.equal(contract.finalVerdict, 'OPERATOR_AUTOMATION_LAYER_CONTRACT_READY');
});

test('repository decision requires exact head text', () => {
  const decision = createOperatorDecision({
    decisionKind: 'MERGE_APPROVAL',
    relatedGoal: '#1292',
    relatedPr: '#1299',
    expectedHeadSha: headSha,
    summary: 'Approve queue change.',
  });

  assert.equal(decision.status, OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL);
  assert.equal(decision.exactApprovalText.includes('EXACT HEAD'), true);
  assert.equal(decision.exactApprovalText.endsWith(headSha), true);
  assert.equal(decision.requiresOperator, true);
  assert.equal(validateOperatorDecision(decision).valid, true);
});

test('validator blocks repository decision without exact head sha', () => {
  const result = validateOperatorDecision({
    schemaVersion: 'operator-automation-layer.v1',
    kind: 'stephanos.operator_automation.decision',
    decisionId: 'bad-change',
    decisionKind: 'MERGE_APPROVAL',
    status: 'WAITING_FOR_OPERATOR_APPROVAL',
    relatedPr: '#1299',
    exactApprovalText: 'missing exact head marker',
    requiresOperator: true,
    sharedWorkspaceMessage: { kind: 'stephanos.shared_workspace.message' },
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-exact-head-sha'), true);
  assert.equal(result.errors.includes('missing-exact-approval-text'), true);
});

test('blocked decision requires exact unblock action', () => {
  const decision = createOperatorDecision({
    decisionKind: 'SERVICE_RESTART_APPROVAL',
    status: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
    summary: 'Worker restart prerequisites are missing.',
    exactUnblockAction: 'Install supervisor task, then rerun worker self-heal proof.',
  });

  assert.equal(decision.exactUnblockAction, 'Install supervisor task, then rerun worker self-heal proof.');
  assert.equal(validateOperatorDecision(decision).finalVerdict, 'OPERATOR_DECISION_PASS');
});

test('batch reports waiting approvals and invalid decisions', () => {
  const batch = createOperatorAutomationBatch({
    decisions: [
      { decisionKind: 'PROOF_REQUEST', summary: 'Run Battle Bridge proof.' },
      { decisionKind: 'MERGE_APPROVAL', relatedPr: '#1299', summary: 'Missing SHA.' },
    ],
  });

  assert.equal(batch.status, OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(batch.invalidDecisionIds.length, 1);
  assert.equal(batch.finalVerdict, 'OPERATOR_AUTOMATION_BATCH_BLOCKED');
});

test('operator text only passes when exact text matches', () => {
  const decision = createOperatorDecision({
    decisionKind: 'MERGE_APPROVAL',
    relatedPr: '#1299',
    expectedHeadSha: headSha,
  });

  const rejected = applyOperatorApproval(decision, { exactApprovalText: 'wrong approval text' });
  const approved = applyOperatorApproval(decision, { exactApprovalText: decision.exactApprovalText });

  assert.equal(rejected.finalVerdict, 'OPERATOR_APPROVAL_REJECTED');
  assert.equal(approved.finalVerdict, 'OPERATOR_APPROVAL_PASS');
});
