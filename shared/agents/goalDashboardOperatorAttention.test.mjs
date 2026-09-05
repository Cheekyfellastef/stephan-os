import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoalDashboardApprovalDecisions,
  buildGoalDashboardMaintenanceActions,
  buildGoalDashboardOperatorAttention,
} from './goalDashboardOperatorAttention.mjs';

const HEAD = 'a'.repeat(40);

test('stale evidence is routed to Codex and Housekeeper, not mislabeled as operator approval', () => {
  const attention = buildGoalDashboardOperatorAttention({
    goals: [{ issue: '#1287', title: 'Shared Workspace truth', statusTruth: 'UNKNOWN', proofTruth: 'UNKNOWN', blockers: ['UNKNOWN_PROOF_RECORD'], exactNextAction: 'Publish the missing proof record.' }],
    blockers: ['UNKNOWN_PROOF_RECORD'],
  });

  assert.equal(attention.approvals.length, 0);
  assert.equal(attention.maintenanceActions.length, 1);
  assert.equal(attention.maintenanceActions[0].owner, 'codex-housekeeper');
  assert.equal(attention.maintenanceActions[0].operatorDecisionRequired, false);
});

test('only an exact-head approval-ready live pull request becomes an operator decision', () => {
  const decisions = buildGoalDashboardApprovalDecisions([
    { source: 'github-live-open-pr', state: 'APPROVAL_REQUIRED', issue: 'PR #2032', prNumber: 2032, exactHead: HEAD },
    { source: 'github-live-open-pr', state: 'VERIFYING', issue: 'PR #2033', prNumber: 2033, exactHead: HEAD },
    { source: 'github-live-open-pr', state: 'APPROVAL_REQUIRED', issue: 'PR #2034', prNumber: 2034, exactHead: 'unknown' },
  ]);

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decisionId, 'merge-pr-2032-aaaaaaaaaaaa');
  assert.equal(decisions[0].relatedPr, '#2032');
  assert.equal(decisions[0].expectedHeadSha, HEAD);
  assert.equal(decisions[0].requiresOperator, true);
});

test('approval-ready work is excluded from routine maintenance cards', () => {
  const actions = buildGoalDashboardMaintenanceActions([
    { source: 'github-live-open-pr', state: 'APPROVAL_REQUIRED', issue: 'PR #2032', prNumber: 2032, exactHead: HEAD, statusTruth: 'CURRENT', proofTruth: 'CURRENT' },
  ]);
  assert.deepEqual(actions, []);
});
