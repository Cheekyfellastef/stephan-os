import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoalDashboardStatusProjection,
  GOAL_DASHBOARD_PROJECTION_SOURCE,
  STATIC_GOAL_DASHBOARD_GOALS,
} from './goalDashboardStatusProjection.mjs';

const NOW = '2026-07-23T12:05:00.000Z';

function projection(overrides = {}) {
  return buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true },
    goals: [{
      issue: '#2002',
      title: 'Verified source goal',
      status: 'Active',
      proof: { automationReceipt: 'receipt-2002' },
      truth: {},
      lastUpdated: {
        source: 'verified-readonly-goal-status-adapter',
        at: '2026-07-23T12:00:00.000Z',
      },
      manualRefreshRequired: false,
      ...overrides,
    }],
  });
}

test('receipt identifiers cannot smuggle negative suffixes', () => {
  for (const value of ['receipt-2002.failed', 'receipt-2rejected', 'receipt-abc123stale']) {
    const result = projection({ proof: { automationReceipt: value } });
    assert.equal(result.sourceTruth.goalsCurrent, false, value);
    assert.equal(result.refreshTruth, 'MANUAL_REFRESH_REQUIRED', value);
  }
});

test('populated goals require a canonical verified source identity', () => {
  for (const source of ['current', 'verified', 'healthy']) {
    const result = projection({ lastUpdated: { source, at: '2026-07-23T12:00:00.000Z' } });
    assert.equal(result.sourceTruth.goalsCurrent, false, source);
    assert.equal(result.refreshTruth, 'MANUAL_REFRESH_REQUIRED', source);
  }

  const current = projection();
  assert.equal(current.sourceTruth.goalsCurrent, true);
  assert.equal(current.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
});

test('receipt-backed automation claims require a validated receipt in projected evidence', () => {
  const noReceipt = projection({
    proof: { lastProofStatus: 'passed' },
    truth: {},
  });
  assert.equal(noReceipt.sourceTruth.goalsCurrent, true);
  assert.equal(noReceipt.sourceTruth.automationReceiptVerified, true);
  assert.equal(noReceipt.sourceTruth.receiptEvidenceVerified, false);
  assert.equal(noReceipt.liveAutomationClaim, 'none');
  assert.equal(noReceipt.localAutomationTruth, 'local-readonly-adapter-verified');

  const validReceipt = projection();
  assert.equal(validReceipt.sourceTruth.receiptEvidenceVerified, true);
  assert.equal(validReceipt.liveAutomationClaim, 'receipt-backed-readonly');
  assert.equal(validReceipt.localAutomationTruth, 'local-readonly-adapter-and-receipt-verified');
});

test('empty and static projections cannot synthesize receipt-backed automation truth', () => {
  const empty = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true },
    goals: [],
    resultFreshness: {
      source: 'verified-readonly-goal-status-adapter',
      at: '2026-07-23T12:00:00.000Z',
      evidence: 'current',
    },
  });
  assert.equal(empty.sourceTruth.goalsCurrent, true);
  assert.equal(empty.sourceTruth.receiptEvidenceVerified, false);
  assert.equal(empty.liveAutomationClaim, 'none');
  assert.equal(empty.localAutomationTruth, 'local-readonly-adapter-verified');

  const seeded = buildGoalDashboardStatusProjection({
    now: NOW,
    localAdapter: { verified: true },
    automationReceipt: { verified: true },
  });
  assert.equal(seeded.sourceTruth.receiptEvidenceVerified, false);
  assert.equal(seeded.liveAutomationClaim, 'none');
  assert.equal(seeded.localAutomationTruth, 'local-readonly-adapter-verified');
});

test('verified adapter without a usable goal array preserves static fallback attribution', () => {
  for (const goals of [undefined, null, {}, 'not-an-array']) {
    const result = buildGoalDashboardStatusProjection({
      now: NOW,
      githubAdapter: { verified: true },
      localAdapter: { verified: true },
      goals,
      projectionSource: 'verified-readonly-goal-status-adapter',
    });
    assert.equal(result.projectionSource, GOAL_DASHBOARD_PROJECTION_SOURCE);
    assert.equal(result.githubTruth, 'not-live-readonly-static-seed');
    assert.equal(result.sourceTruth.githubVerified, true);
    assert.equal(result.sourceTruth.liveGoalsAccepted, false);
    assert.equal(result.sourceTruth.adaptersCurrent, false);
    assert.equal(result.totalGoals, STATIC_GOAL_DASHBOARD_GOALS.length);
    assert.equal(result.refreshTruth, 'MANUAL_REFRESH_REQUIRED');
  }
});
