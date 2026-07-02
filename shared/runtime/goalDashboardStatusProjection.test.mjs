import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoalDashboardStatusProjection,
  GOAL_DASHBOARD_REFRESH_TRUTH,
  STATIC_GOAL_DASHBOARD_GOALS,
} from './goalDashboardStatusProjection.mjs';

test('goal dashboard status projection remains read-only static seed truth', () => {
  const projection = buildGoalDashboardStatusProjection();

  assert.equal(projection.readOnly, true);
  assert.equal(projection.refreshTruth, GOAL_DASHBOARD_REFRESH_TRUTH);
  assert.equal(projection.refreshTruth, 'MANUAL_REFRESH_REQUIRED');
  assert.equal(projection.liveAutomationClaim, 'none');
  assert.equal(projection.githubTruth, 'not-live-readonly-static-seed');
  assert.equal(projection.localAutomationTruth, 'not-live-readonly-static-seed');
  assert.equal(projection.totalGoals, STATIC_GOAL_DASHBOARD_GOALS.length);
  assert.equal(projection.goals[0].issue, '#1278');
  assert.equal(projection.goals[0].currentOwner, 'Codex');
  assert.equal(projection.goals[0].nextOwner, 'OpenClaw');
});

test('standalone Goal Dashboard exposes V5 implemented guarded auto-pick truth', () => {
  const projection = buildGoalDashboardStatusProjection();
  const v5 = projection.buildConcierge.roadmap.phases.find((phase) => phase.version === 'V5');
  assert.equal(v5.title, 'Auto Pick Next Safe Work');
  assert.equal(v5.status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.autoPickTruth, 'supplied-candidate-records-only');
  assert.equal(projection.liveAutomationClaim, 'none');
});


test('standalone Goal Dashboard exposes V7 implemented guarded post-merge sync truth', () => {
  const projection = buildGoalDashboardStatusProjection({ buildConcierge: { postMergeSync: { mergeReceipt: { receiptId: 'merge-1400' }, workingTreeClean: true, pullMainReceipt: { receiptId: 'pull-main' }, restartRefreshReceipt: { receiptId: 'refresh' } } } });
  const v7 = projection.buildConcierge.roadmap.phases.find((phase) => phase.version === 'V7');
  assert.equal(v7.title, 'Post-Merge Sync and Reproof');
  assert.equal(v7.status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.postMergeSync.status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.postMergeSync.backendFreshnessProof.status, 'required');
  assert.equal(projection.buildConcierge.postMergeSync.refreshState.goalDashboard, 'blocked');
});
