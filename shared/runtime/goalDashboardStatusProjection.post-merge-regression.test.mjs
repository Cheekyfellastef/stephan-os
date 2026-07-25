import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalDashboardStatusProjection } from './goalDashboardStatusProjection.mjs';

const NOW = '2026-07-25T12:00:00.000Z';
const SOURCE = 'verified-readonly-goal-status-adapter';
const SHA = 'a'.repeat(40);

function project({ linkedPr = {}, receiptId = 'execution-1568-1', projectionSource = SOURCE } = {}) {
  return buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true, receiptId, state: 'completed' },
    projectionSource,
    goals: [{
      issue: '#1582',
      title: 'Goal Dashboard repair',
      status: 'Active',
      manualRefreshRequired: false,
      linkedPr,
      proof: { automationReceipt: receiptId },
      truth: {},
      lastUpdated: { source: SOURCE, at: '2026-07-25T11:55:00.000Z' },
    }],
  });
}

test('merged PR truth requires commit identity', () => {
  const unbound = project({ linkedPr: { number: 1582, state: 'merged' } });
  assert.equal(unbound.goals[0].linkedPr.state, 'unknown');
  assert.equal(unbound.mergedPrCount, 0);
  assert.equal(unbound.unknownPrStateCount, 1);

  const bound = project({ linkedPr: { number: 1582, state: 'merged', mergeSha: SHA } });
  assert.equal(bound.goals[0].linkedPr.state, 'merged');
  assert.equal(bound.mergedPrCount, 1);
});

test('canonical execution receipt identifiers require completed receipt state', () => {
  const result = project({ receiptId: 'execution-1568-1' });
  assert.equal(result.sourceTruth.automationReceiptVerified, true);
  assert.equal(result.sourceTruth.receiptEvidenceVerified, true);
  assert.equal(result.sourceTruth.goalsCurrent, true);

  const failed = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true, receiptId: 'execution-1568-1', state: 'failed' },
    goals: [{
      issue: '#1582',
      title: 'Failed receipt',
      status: 'Blocked',
      manualRefreshRequired: false,
      proof: { automationReceipt: 'execution-1568-1' },
      truth: {},
      lastUpdated: { source: SOURCE, at: '2026-07-25T11:55:00.000Z' },
    }],
  });
  assert.equal(failed.sourceTruth.automationReceiptVerified, false);
  assert.equal(failed.sourceTruth.goalsCurrent, false);
  assert.equal(failed.liveAutomationClaim, 'none');
});

test('concatenated non-live source labels normalize to canonical live source', () => {
  for (const projectionSource of ['verified-notlive-goal-adapter', 'verified-staticseed-goal-adapter']) {
    const result = project({ projectionSource });
    assert.equal(result.projectionSource, SOURCE, projectionSource);
    assert.equal(result.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
  }
});
