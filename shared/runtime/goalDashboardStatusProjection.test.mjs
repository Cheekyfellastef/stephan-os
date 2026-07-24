import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoalDashboardStatusProjection,
  GOAL_DASHBOARD_FRESHNESS_WINDOW_MS,
  GOAL_DASHBOARD_PROJECTION_SOURCE,
  GOAL_DASHBOARD_REFRESH_TRUTH,
  STATIC_GOAL_DASHBOARD_GOALS,
} from './goalDashboardStatusProjection.mjs';

const NOW = '2026-07-23T12:05:00.000Z';
const RECEIPT_ID = 'receipt-2002';

function verifiedGoal(overrides = {}) {
  return {
    issue: '#2002',
    title: 'Verified source goal',
    status: 'Active',
    linkedPr: { number: 2003, state: 'merged', mergeSha: 'b'.repeat(40) },
    proof: { lastProofStatus: 'ci-green', automationReceipt: RECEIPT_ID },
    truth: { github: 'linked-pr-verified', local: 'runtime-receipt-verified', automation: 'receipt-verified' },
    lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T12:00:00.000Z' },
    manualRefreshRequired: false,
    ...overrides,
  };
}

function verifiedProjection(goal = verifiedGoal(), overrides = {}) {
  return buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true, receiptId: RECEIPT_ID },
    goals: [goal],
    ...overrides,
  });
}

test('static projection remains read-only and fail-closed', () => {
  const projection = buildGoalDashboardStatusProjection({ now: NOW });
  assert.equal(projection.readOnly, true);
  assert.equal(projection.refreshTruth, GOAL_DASHBOARD_REFRESH_TRUTH);
  assert.equal(projection.freshnessVerdict, 'STALE_REFRESH_REQUIRED');
  assert.equal(projection.liveAutomationClaim, 'none');
  assert.equal(projection.githubTruth, 'not-live-readonly-static-seed');
  assert.equal(projection.totalGoals, STATIC_GOAL_DASHBOARD_GOALS.length);
});

test('unverified or unusable live input preserves static attribution', () => {
  for (const goals of [undefined, null, {}, 'invalid']) {
    const projection = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, goals, projectionSource: 'verified-custom-goal-adapter' });
    assert.equal(projection.projectionSource, GOAL_DASHBOARD_PROJECTION_SOURCE);
    assert.equal(projection.githubTruth, 'not-live-readonly-static-seed');
    assert.equal(projection.sourceTruth.liveGoalsAccepted, false);
  }
});

test('verified empty results require source-specific freshness evidence', () => {
  const stale = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, localAdapter: { verified: true }, goals: [] });
  assert.equal(stale.totalGoals, 0);
  assert.equal(stale.sourceTruth.goalsCurrent, false);
  const current = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    automationReceipt: { verified: true, receiptId: RECEIPT_ID },
    goals: [],
    resultFreshness: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T12:00:00.000Z', evidence: RECEIPT_ID },
  });
  assert.equal(current.sourceTruth.goalsCurrent, true);
});

test('security remediation seed remains isolated and deeply immutable', () => {
  const remediationSeed = STATIC_GOAL_DASHBOARD_GOALS.find((goal) => goal.issue === '#1568');
  assert.equal(Object.isFrozen(remediationSeed), true);
  assert.equal(Object.isFrozen(remediationSeed.linkedPr), true);
  assert.throws(() => { remediationSeed.linkedPr.state = 'merged'; }, TypeError);
});

test('linked PR identity and state normalization fail closed', () => {
  for (const value of ['1581oops', 1581.9, '0', -1, '01']) {
    const projection = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, goals: [{ linkedPr: { number: value, state: 'merged' } }] });
    assert.equal(projection.goals[0].linkedPr.number, null);
    assert.equal(projection.mergedPrCount, 0);
  }
  const structured = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, goals: [{ linkedPr: { number: 2001, state: ['merged'], headSha: ['a'.repeat(40)] } }] });
  assert.equal(structured.goals[0].linkedPr.state, 'unknown');
  assert.equal(structured.goals[0].linkedPr.headSha, null);
});

test('canonical draft value overrides compatibility fallback', () => {
  const projection = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, goals: [{ linkedPr: { number: 2003, draft: false }, prDraft: true }] });
  assert.equal(projection.goals[0].linkedPr.draft, false);
});

test('verified projection requires exact receipt-bound current evidence', () => {
  const projection = verifiedProjection();
  assert.equal(projection.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
  assert.equal(projection.freshnessVerdict, 'CURRENT_VERIFIED_READONLY_SOURCES');
  assert.equal(projection.freshnessWindowMs, GOAL_DASHBOARD_FRESHNESS_WINDOW_MS);
  assert.equal(projection.sourceTruth.verifiedReceiptId, RECEIPT_ID);
  assert.equal(projection.liveAutomationClaim, 'receipt-backed-readonly');
  assert.equal(projection.mergedPrCount, 1);
});

test('custom live projection sources must remain verified and non-negative', () => {
  assert.equal(verifiedProjection(verifiedGoal(), { projectionSource: 'verified-custom-goal-adapter' }).projectionSource, 'verified-custom-goal-adapter');
  for (const value of ['unknown', 'stale', 'verified-stale', 'verified-unavailable', 'verified-static-goal-dashboard-seed']) {
    assert.equal(verifiedProjection(verifiedGoal(), { projectionSource: value }).projectionSource, 'verified-readonly-goal-status-adapter', value);
  }
});

test('malformed, unsupported and negative evidence fails closed', () => {
  for (const value of [false, {}, [], ['ci-green'], 'none', 'stale', 'failed', 'garbage-green', 'current-stale', 'verified-unavailable']) {
    const projection = verifiedProjection(verifiedGoal({ proof: { lastProofStatus: value }, truth: {} }));
    assert.equal(projection.sourceTruth.goalsCurrent, false, String(value));
  }
});

test('every populated evidence value must be current and negatives veto siblings', () => {
  for (const goal of [
    verifiedGoal({ proof: { lastProofStatus: 'failed', browserProof: 'passed' }, truth: {} }),
    verifiedGoal({ proof: { lastProofStatus: 'passed', browserProof: 'garbage' }, truth: {} }),
  ]) assert.equal(verifiedProjection(goal).sourceTruth.goalsCurrent, false);
});

test('receipt identifiers require strict grammar and exact verifier binding', () => {
  for (const value of ['receipt-current', 'receipt-abc123', 'receipt-2002.failed', 'receipt-2002canceled']) {
    assert.equal(verifiedProjection(verifiedGoal({ proof: { automationReceipt: value }, truth: {} })).sourceTruth.goalsCurrent, false, value);
  }
  const mismatch = verifiedProjection(verifiedGoal({ proof: { automationReceipt: 'receipt-9999' }, truth: {} }));
  assert.equal(mismatch.sourceTruth.goalsCurrent, false);
  assert.equal(mismatch.liveAutomationClaim, 'none');
});

test('automation success truth requires the matching projected receipt', () => {
  const noReceipt = verifiedProjection(verifiedGoal({ proof: {}, truth: { automation: 'success' } }));
  assert.equal(noReceipt.sourceTruth.goalsCurrent, false);
  const bound = verifiedProjection(verifiedGoal({ proof: { automationReceipt: RECEIPT_ID }, truth: { automation: 'success' } }));
  assert.equal(bound.sourceTruth.goalsCurrent, true);
});

test('timestamps must be calendar-valid and inside the canonical freshness window', () => {
  for (const at of ['2026-02-30T12:00:00.000Z', '2000-01-01T00:00:00.000Z', '2026-07-23T12:07:00.000Z']) {
    assert.equal(verifiedProjection(verifiedGoal({ lastUpdated: { source: 'verified-readonly-goal-status-adapter', at } })).sourceTruth.goalsCurrent, false, at);
  }
  const enlarged = verifiedProjection(verifiedGoal({ lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T11:35:00.000Z' } }), { freshnessWindowMs: 60 * 60 * 1000 });
  assert.equal(enlarged.freshnessWindowMs, GOAL_DASHBOARD_FRESHNESS_WINDOW_MS);
  assert.equal(enlarged.sourceTruth.goalsCurrent, false);
});

test('null and structured live goal entries fail closed without throwing', () => {
  for (const goal of [null, [], 'invalid']) {
    const projection = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, localAdapter: { verified: true }, goals: [goal] });
    assert.equal(projection.totalGoals, 1);
    assert.equal(projection.sourceTruth.goalsCurrent, false);
    assert.equal(projection.refreshTruth, GOAL_DASHBOARD_REFRESH_TRUTH);
  }
});

test('standalone Goal Dashboard exposes guarded Build Concierge truth', () => {
  const projection = buildGoalDashboardStatusProjection({ now: NOW, buildConcierge: { candidates: [{ id: 'goal-v8', title: 'V8 goal', headSha: 'c'.repeat(40), state: 'OPEN', mergeable: true, requiredChecksClean: true, proofCommands: ['npm test'] }] } });
  assert.equal(projection.buildConcierge.roadmap.phases.find((phase) => phase.version === 'V5').status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.queue.oneActiveLaneGuardrail, 'satisfied');
  assert.equal(projection.buildConcierge.antiStallMergeLane.cliMergeFallbackAllowed, false);
});
