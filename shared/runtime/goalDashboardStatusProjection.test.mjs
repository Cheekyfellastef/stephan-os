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
  assert.equal(projection.goals[0].linkedPr.state, 'unknown');
  assert.equal(projection.goals[0].proof.lastProofStatus, 'unknown');
  assert.equal(projection.manualRefreshRequired, true);
});

test('static goal index keeps the security repair isolated while the productive build lane remains visible', () => {
  const projection = buildGoalDashboardStatusProjection();
  const productiveLane = projection.goals.find((goal) => goal.issue === '#1385');
  const remediationLane = projection.goals.find((goal) => goal.issue === '#1568');

  assert.equal(productiveLane.status, 'Active');
  assert.equal(productiveLane.currentOwner, 'GitHub-first ChatGPT');
  assert.equal(remediationLane.status, 'Remediation isolated');
  assert.equal(remediationLane.linkedPr.number, 1581);
  assert.equal(remediationLane.linkedPr.state, 'open');
  assert.equal(remediationLane.linkedPr.headSha, '4857085caa008e0bca60a9b5015fdd8a16b2e83e');
  assert.match(remediationLane.nextAction, /without blocking unrelated programme building/i);
});

test('linked PR fields and proof truth are represented without inventing missing evidence', () => {
  const projection = buildGoalDashboardStatusProjection({
    goals: [{
      issue: '#2000',
      title: 'Projection contract test',
      status: 'Blocked',
      linkedPr: {
        number: 2001,
        state: 'open',
        draft: true,
        mergeable: false,
        headSha: 'a'.repeat(40),
        mergeSha: 'not-a-sha',
        exactHeadMergeHold: 'review-required',
      },
      proof: {
        lastProofStatus: 'ci-green',
        browserProof: 'unknown',
      },
      lastUpdated: {
        source: 'github-readonly-test',
        at: '2026-07-22T17:00:00.000Z',
      },
      nextAction: 'Request review.',
    }],
  });

  const goal = projection.goals[0];
  assert.equal(goal.linkedPr.number, 2001);
  assert.equal(goal.linkedPr.state, 'open');
  assert.equal(goal.linkedPr.draft, true);
  assert.equal(goal.linkedPr.mergeable, false);
  assert.equal(goal.linkedPr.headSha, 'a'.repeat(40));
  assert.equal(goal.linkedPr.mergeSha, null);
  assert.equal(goal.proof.lastProofStatus, 'ci-green');
  assert.equal(goal.proof.browserProof, 'unknown');
  assert.equal(goal.truth.github, 'unknown');
  assert.equal(goal.lastUpdated.source, 'github-readonly-test');
  assert.equal(goal.nextOperatorAction, 'Request review.');
  assert.equal(projection.linkedPrCount, 1);
  assert.equal(projection.blockedGoalCount, 1);
});

test('verified read-only adapters remove the manual-refresh claim without granting execution authority', () => {
  const projection = buildGoalDashboardStatusProjection({
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true },
    goals: [{
      issue: '#2002',
      title: 'Verified source goal',
      status: 'Active',
      linkedPr: { number: 2003, state: 'merged', mergeSha: 'b'.repeat(40) },
      manualRefreshRequired: false,
    }],
  });

  assert.equal(projection.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
  assert.equal(projection.githubTruth, 'live-readonly-adapter-verified');
  assert.equal(projection.localAutomationTruth, 'local-readonly-receipt-verified');
  assert.equal(projection.liveAutomationClaim, 'receipt-backed-readonly');
  assert.equal(projection.manualRefreshRequired, false);
  assert.equal(projection.sourceTruth.githubVerified, true);
  assert.equal(projection.mergedPrCount, 1);
  assert.equal(projection.readOnly, true);
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

test('standalone Goal Dashboard exposes V8 queue and anti-stall truth', () => {
  const projection = buildGoalDashboardStatusProjection({ buildConcierge: { candidates: [{ id: 'goal-v8', title: 'V8 goal', headSha: 'c'.repeat(40), state: 'OPEN', mergeable: true, requiredChecksClean: true, proofCommands: ['npm test'] }], antiStallMergeLane: { connectorMergeAttempted: false } } });
  const v8 = projection.buildConcierge.roadmap.phases.find((phase) => phase.version === 'V8');
  assert.equal(v8.status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.queue.status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.queue.oneActiveLaneGuardrail, 'satisfied');
  assert.equal(projection.buildConcierge.antiStallMergeLane.cliMergeFallbackAllowed, false);
});
