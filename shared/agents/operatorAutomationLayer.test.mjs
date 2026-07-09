import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_OPERATOR_ACTION_CLASS,
  OPERATOR_DECISION_STATUS,
  applyOperatorApproval,
  buildOperatorAutomationLayerContract,
  createOperatorAutomationBatch,
  createGitHubOperatorActionBrief,
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


test('GitHub Operator Action Brief status-only intent returns status brief', () => {
  const brief = createGitHubOperatorActionBrief({
    issue: '#1286',
    action: 'status-only',
    relatedPr: '#1465',
  });

  assert.equal(brief.actionClass, GITHUB_OPERATOR_ACTION_CLASS.STATUS_ONLY);
  assert.equal(brief.issue, '#1286');
  assert.equal(brief.relatedPr, '#1465');
  assert.deepEqual(brief.safetyBlockers, []);
  assert.equal(brief.executesAction, false);
  assert.equal(brief.merges, false);
});

test('GitHub Operator Action Brief blocks merge-needed action without exact head', () => {
  const brief = createGitHubOperatorActionBrief({
    issue: '#1286',
    action: 'exact-head merge-needed',
    relatedPr: '#1448',
    proofRefs: ['proof/operator-automation/pr-publication.json'],
  });

  assert.equal(brief.actionClass, GITHUB_OPERATOR_ACTION_CLASS.BLOCKED);
  assert.equal(brief.safetyBlockers.includes('expected-head-missing'), true);
  assert.equal(brief.finalVerdict, 'GITHUB_OPERATOR_ACTION_BRIEF_BLOCKED');
  assert.equal(brief.merges, false);
});

test('GitHub Operator Action Brief blocks success claim when proof is missing', () => {
  const brief = createGitHubOperatorActionBrief({
    issue: '#1286',
    action: 'proof-needed',
    relatedPr: '#1448',
  });

  assert.equal(brief.actionClass, GITHUB_OPERATOR_ACTION_CLASS.BLOCKED);
  assert.equal(brief.safetyBlockers.includes('proof-missing-success-claim-blocked'), true);
  assert.match(brief.requiredProofs.join(' '), /ProofReferenceVerifier PASS/);
});

test('GitHub Operator Action Brief routes patch-needed action to Patch Courier', () => {
  const brief = createGitHubOperatorActionBrief({
    issue: '#1286',
    action: 'patch-needed',
    sourcePaths: ['shared/agents/operatorAutomationLayer.mjs'],
  });

  assert.equal(brief.actionClass, GITHUB_OPERATOR_ACTION_CLASS.PATCH_NEEDED);
  assert.equal(brief.routesTo, 'Patch Courier V1');
  assert.match(brief.allowedCommands[0], /^git diff --binary -- shared\/agents\/operatorAutomationLayer\.mjs \| base64 -w 0$/);
  assert.equal(brief.pushes, false);
});

test('GitHub Operator Action Brief rejects unsafe commands', () => {
  const brief = createGitHubOperatorActionBrief({
    issue: '#1286',
    action: 'status-only',
    allowedCommands: ['gh issue view #1286', 'git push origin HEAD', 'rm -rf apps/stephanos/dist'],
  });

  assert.equal(brief.actionClass, GITHUB_OPERATOR_ACTION_CLASS.BLOCKED);
  assert.deepEqual(brief.allowedCommands, ['gh issue view #1286']);
  assert.equal(brief.rejectedCommands.length, 2);
  assert.equal(brief.safetyBlockers.includes('unsafe-command-rejected'), true);
});

test('GitHub Operator Action Brief rejects operator approval spoofing', () => {
  const brief = createGitHubOperatorActionBrief({
    issue: '#1286',
    action: 'exact-head merge-needed',
    relatedPr: '#1448',
    expectedHead: headSha,
    proofRefs: ['proof/operator-automation/pr-publication.json'],
    operatorApproved: true,
    exactApprovalText: `APPROVE MERGE PR #1448 EXACT HEAD ${headSha}`,
  });

  assert.equal(brief.actionClass, GITHUB_OPERATOR_ACTION_CLASS.BLOCKED);
  assert.equal(brief.safetyBlockers.includes('operator-approval-spoofing-rejected'), true);
  assert.equal(brief.nextOwner, 'operator');
  assert.equal(brief.merges, false);
});
