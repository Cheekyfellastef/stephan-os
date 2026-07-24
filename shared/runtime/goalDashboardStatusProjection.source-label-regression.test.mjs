import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalDashboardStatusProjection } from './goalDashboardStatusProjection.mjs';

const NOW = '2026-07-23T12:05:00.000Z';
const CANONICAL_SOURCE = 'verified-readonly-goal-status-adapter';

function currentProjection(projectionSource) {
  return buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true },
    projectionSource,
    goals: [{
      issue: '#2002',
      title: 'Verified source goal',
      status: 'Active',
      proof: { automationReceipt: 'receipt-2002' },
      truth: {},
      lastUpdated: {
        source: CANONICAL_SOURCE,
        at: '2026-07-23T12:00:00.000Z',
      },
      manualRefreshRequired: false,
    }],
  });
}

test('accepted live goals normalize every non-verified source label', () => {
  for (const source of [
    'none',
    'unavailable',
    'stale',
    'not-live-readonly-static-seed',
    'static-goal-dashboard-seed',
    'unknown',
    'custom-adapter',
    '',
  ]) {
    const result = currentProjection(source);
    assert.equal(result.projectionSource, CANONICAL_SOURCE, source);
    assert.equal(result.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT', source);
    assert.equal(result.sourceTruth.liveGoalsAccepted, true, source);
  }
});

test('accepted live goals preserve explicitly verified custom source labels', () => {
  const result = currentProjection('verified-custom-goal-adapter');
  assert.equal(result.projectionSource, 'verified-custom-goal-adapter');
  assert.equal(result.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
});
