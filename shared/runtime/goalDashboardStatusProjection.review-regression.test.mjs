import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoalDashboardStatusProjection,
  GOAL_DASHBOARD_PROJECTION_SOURCE,
  STATIC_GOAL_DASHBOARD_GOALS,
} from './goalDashboardStatusProjection.mjs';

const NOW = '2026-07-23T12:05:00.000Z';
const RECEIPT_ID = 'receipt-2002';

function projection(overrides = {}, inputOverrides = {}) {
  return buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true, receiptId: RECEIPT_ID },
    goals: [{
      issue: '#2002',
      title: 'Verified source goal',
      status: 'Active',
      proof: { automationReceipt: RECEIPT_ID },
      truth: {},
      lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T12:00:00.000Z' },
      manualRefreshRequired: false,
      ...overrides,
    }],
    ...inputOverrides,
  });
}

test('receipt identifiers cannot smuggle negative suffixes', () => {
  for (const value of ['receipt-2002.failed', 'receipt-2rejected', 'receipt-abc123stale']) {
    const result = projection({ proof: { automationReceipt: value } });
    assert.equal(result.sourceTruth.goalsCurrent, false, value);
  }
});

test('populated goals require a canonical verified source identity', () => {
  for (const source of ['current', 'verified', 'healthy']) {
    const result = projection({ lastUpdated: { source, at: '2026-07-23T12:00:00.000Z' } });
    assert.equal(result.sourceTruth.goalsCurrent, false, source);
  }
});

test('receipt-backed automation claims require a matching validated receipt', () => {
  const noReceipt = projection({ proof: { lastProofStatus: 'passed' }, truth: {} });
  assert.equal(noReceipt.sourceTruth.goalsCurrent, true);
  assert.equal(noReceipt.sourceTruth.receiptEvidenceVerified, false);
  assert.equal(noReceipt.liveAutomationClaim, 'none');

  const validReceipt = projection();
  assert.equal(validReceipt.sourceTruth.receiptEvidenceVerified, true);
  assert.equal(validReceipt.liveAutomationClaim, 'receipt-backed-readonly');
});

test('empty and static projections cannot synthesize receipt-backed automation truth', () => {
  const empty = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true, receiptId: RECEIPT_ID },
    goals: [],
    resultFreshness: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T12:00:00.000Z', evidence: 'current' },
  });
  assert.equal(empty.sourceTruth.goalsCurrent, true);
  assert.equal(empty.sourceTruth.receiptEvidenceVerified, false);
  assert.equal(empty.liveAutomationClaim, 'none');
});

test('verified adapter without a usable goal array preserves static fallback attribution', () => {
  for (const goals of [undefined, null, {}, 'not-an-array']) {
    const result = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, localAdapter: { verified: true }, goals, projectionSource: 'verified-readonly-goal-status-adapter' });
    assert.equal(result.projectionSource, GOAL_DASHBOARD_PROJECTION_SOURCE);
    assert.equal(result.githubTruth, 'not-live-readonly-static-seed');
    assert.equal(result.sourceTruth.liveGoalsAccepted, false);
    assert.equal(result.totalGoals, STATIC_GOAL_DASHBOARD_GOALS.length);
  }
});

test('accepted live goals cannot retain negative or reserved projection sources', () => {
  for (const projectionSource of [undefined, '', 'unknown', GOAL_DASHBOARD_PROJECTION_SOURCE, 'none', 'unavailable', 'stale', 'not-live-readonly-static-seed', 'verified-stale', 'verified-unavailable', 'verified-static-goal-dashboard-seed']) {
    const result = projection({}, { projectionSource });
    assert.equal(result.projectionSource, 'verified-readonly-goal-status-adapter', String(projectionSource));
    assert.equal(result.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
  }
  assert.equal(projection({}, { projectionSource: 'verified-custom-goal-adapter' }).projectionSource, 'verified-custom-goal-adapter');
});

test('automation success truth is receipt-bound', () => {
  const unreceipted = projection({ proof: {}, truth: { automation: 'success' } });
  assert.equal(unreceipted.sourceTruth.goalsCurrent, false);
  const receipted = projection({ proof: { automationReceipt: RECEIPT_ID }, truth: { automation: 'success' } });
  assert.equal(receipted.sourceTruth.goalsCurrent, true);
});

test('receipt verification is bound to the exact projected identifier', () => {
  const mismatch = projection({ proof: { automationReceipt: 'receipt-9999' }, truth: {} });
  assert.equal(mismatch.sourceTruth.goalsCurrent, false);
  assert.equal(mismatch.sourceTruth.receiptEvidenceVerified, false);
  assert.equal(mismatch.liveAutomationClaim, 'none');
});

test('null live-goal entries normalize to stale unknown truth without throwing', () => {
  const result = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, localAdapter: { verified: true }, goals: [null] });
  assert.equal(result.totalGoals, 1);
  assert.equal(result.goals[0].issue, 'untracked');
  assert.equal(result.sourceTruth.goalsCurrent, false);
  assert.equal(result.refreshTruth, 'MANUAL_REFRESH_REQUIRED');
});
