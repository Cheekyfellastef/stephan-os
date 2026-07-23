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

function verifiedGoal(overrides = {}) {
  return {
    issue: '#2002',
    title: 'Verified source goal',
    status: 'Active',
    linkedPr: { number: 2003, state: 'merged', mergeSha: 'b'.repeat(40) },
    proof: { lastProofStatus: 'ci-green', automationReceipt: 'receipt-2002' },
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
    automationReceipt: { verified: true },
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
  assert.equal(projection.localAutomationTruth, 'not-live-readonly-static-seed');
  assert.equal(projection.totalGoals, STATIC_GOAL_DASHBOARD_GOALS.length);
  assert.equal(projection.goals[0].issue, '#1278');
  assert.equal(projection.manualRefreshRequired, true);
});

test('unverified projection source and goal overrides fail closed to the static seed', () => {
  const projection = buildGoalDashboardStatusProjection({ now: NOW, projectionSource: 'verified-readonly-goal-status-adapter', goals: [] });
  assert.equal(projection.projectionSource, GOAL_DASHBOARD_PROJECTION_SOURCE);
  assert.equal(projection.githubTruth, 'not-live-readonly-static-seed');
  assert.equal(projection.totalGoals, STATIC_GOAL_DASHBOARD_GOALS.length);
});

test('verified adapters preserve an explicit empty goal result but require result-level freshness evidence', () => {
  const stale = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    goals: [],
  });
  assert.equal(stale.projectionSource, 'verified-readonly-goal-status-adapter');
  assert.equal(stale.githubTruth, 'live-readonly-adapter-verified');
  assert.equal(stale.totalGoals, 0);
  assert.deepEqual(stale.goals, []);
  assert.equal(stale.sourceTruth.goalsCurrent, false);
  assert.equal(stale.refreshTruth, 'MANUAL_REFRESH_REQUIRED');

  const forgedSource = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    goals: [],
    resultFreshness: {
      source: 'current',
      at: '2026-07-23T12:00:00.000Z',
      evidence: 'current',
    },
  });
  assert.equal(forgedSource.sourceTruth.goalsCurrent, false);
  assert.equal(forgedSource.refreshTruth, 'MANUAL_REFRESH_REQUIRED');

  const current = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    localAdapter: { verified: true },
    goals: [],
    resultFreshness: {
      source: 'verified-readonly-goal-status-adapter',
      at: '2026-07-23T12:00:00.000Z',
      evidence: 'current',
    },
  });
  assert.equal(current.sourceTruth.goalsCurrent, true);
  assert.equal(current.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
});

test('security remediation seed stays isolated and deeply immutable', () => {
  const projection = buildGoalDashboardStatusProjection({ now: NOW });
  const productiveLane = projection.goals.find((goal) => goal.issue === '#1385');
  const remediationSeed = STATIC_GOAL_DASHBOARD_GOALS.find((goal) => goal.issue === '#1568');
  assert.equal(productiveLane.status, 'Active');
  assert.equal(Object.isFrozen(remediationSeed), true);
  assert.equal(Object.isFrozen(remediationSeed.linkedPr), true);
  assert.throws(() => { remediationSeed.linkedPr.state = 'merged'; }, TypeError);
  assert.equal(remediationSeed.linkedPr.state, 'open');
});

test('linked PR normalization rejects malformed identity, structured SHA/state and unsupported state', () => {
  for (const value of ['1581oops', 1581.9, '0', -1, '01']) {
    const projection = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, goals: [{ issue: '#2001', linkedPr: { number: value, state: 'merged' }, manualRefreshRequired: false }] });
    assert.equal(projection.goals[0].linkedPr.number, null);
    assert.equal(projection.linkedPrCount, 0);
    assert.equal(projection.mergedPrCount, 0);
  }
  const unsupported = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, goals: [{ issue: '#2007', linkedPr: { number: 2008, state: 'MERGD' }, manualRefreshRequired: false }] });
  assert.equal(unsupported.goals[0].linkedPr.state, 'unknown');
  assert.equal(unsupported.unknownPrStateCount, 1);
  const structured = buildGoalDashboardStatusProjection({
    now: NOW,
    githubAdapter: { verified: true },
    goals: [{ issue: '#2010', linkedPr: { number: 2011, state: ['merged'], headSha: ['a'.repeat(40)], mergeSha: { value: 'b'.repeat(40) } }, manualRefreshRequired: false }],
  });
  assert.equal(structured.goals[0].linkedPr.state, 'unknown');
  assert.equal(structured.unknownPrStateCount, 1);
  assert.equal(structured.goals[0].linkedPr.headSha, null);
  assert.equal(structured.goals[0].linkedPr.mergeSha, null);
});

test('canonical draft value overrides compatibility fallback', () => {
  const projection = buildGoalDashboardStatusProjection({ now: NOW, githubAdapter: { verified: true }, goals: [{ issue: '#2002', linkedPr: { number: 2003, draft: false }, prDraft: true, manualRefreshRequired: false }] });
  assert.equal(projection.goals[0].linkedPr.draft, false);
});

test('verified adapters require affirmative, timestamped evidence and grant no execution authority', () => {
  const projection = verifiedProjection();
  assert.equal(projection.refreshTruth, 'VERIFIED_READONLY_SOURCES_CURRENT');
  assert.equal(projection.freshnessVerdict, 'CURRENT_VERIFIED_READONLY_SOURCES');
  assert.equal(projection.freshnessWindowMs, GOAL_DASHBOARD_FRESHNESS_WINDOW_MS);
  assert.equal(projection.githubTruth, 'live-readonly-adapter-verified');
  assert.equal(projection.localAutomationTruth, 'local-readonly-adapter-and-receipt-verified');
  assert.equal(projection.liveAutomationClaim, 'receipt-backed-readonly');
  assert.equal(projection.sourceTruth.goalsCurrent, true);
  assert.equal(projection.mergedPrCount, 1);
  assert.equal(projection.readOnly, true);
});

test('verified adapters may supply a primitive projection source label', () => {
  const projection = verifiedProjection(verifiedGoal(), { projectionSource: 'verified-custom-goal-adapter' });
  assert.equal(projection.projectionSource, 'verified-custom-goal-adapter');
});

test('caller freshness flags cannot make unknown, negative or structured evidence current', () => {
  const unknown = verifiedProjection(verifiedGoal({ proof: {}, truth: {}, lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T12:00:00.000Z' } }));
  assert.equal(unknown.sourceTruth.goalsCurrent, false);
  assert.equal(unknown.refreshTruth, 'MANUAL_REFRESH_REQUIRED');
  for (const value of [false, {}, [], ['ci-green'], 'none', 'stale', 'failed']) {
    const malformed = verifiedProjection(verifiedGoal({ proof: { lastProofStatus: value }, truth: {}, lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T12:00:00.000Z' } }));
    assert.equal(malformed.sourceTruth.goalsCurrent, false);
    assert.equal(malformed.freshnessVerdict, 'STALE_REFRESH_REQUIRED');
  }
});

test('negative evidence vetoes positive sibling evidence', () => {
  const projection = verifiedProjection(verifiedGoal({
    proof: { lastProofStatus: 'failed', browserProof: 'passed' },
    truth: { github: 'linked-pr-verified' },
  }));
  assert.equal(projection.sourceTruth.goalsCurrent, false);
  assert.equal(projection.refreshTruth, 'MANUAL_REFRESH_REQUIRED');
});

test('every populated evidence field must be recognized as current', () => {
  for (const goal of [
    verifiedGoal({ proof: { lastProofStatus: 'passed', browserProof: 'garbage' }, truth: {} }),
    verifiedGoal({ proof: { lastProofStatus: 'passed' }, truth: { github: 'linked-pr-verified', automation: 'pending' } }),
  ]) {
    const projection = verifiedProjection(goal);
    assert.equal(projection.sourceTruth.goalsCurrent, false);
    assert.equal(projection.refreshTruth, 'MANUAL_REFRESH_REQUIRED');
  }
});

test('compound, coded and unsupported negative evidence states fail closed', () => {
  for (const value of [
    'receipt-failed',
    'receipt-rejected',
    'receipt-expired',
    'receipt-cancelled',
    'receipt-canceled',
    'receipt-stalled',
    'receipt-error500',
    'receipt-rejected1',
    'receipt-error5xx',
    'receipt-rejected1a',
    'receipt-failed.v2',
    'receipt-2002.failed',
    'receipt-2rejected',
    'receipt-abc123stale',
    'receipt-2002canceled',
    'receipt-2002stalled',
    'current-stale',
    'verified-unavailable',
    'garbage-green',
  ]) {
    const projection = verifiedProjection(verifiedGoal({ proof: { lastProofStatus: value }, truth: {} }));
    assert.equal(projection.sourceTruth.goalsCurrent, false, value);
    assert.equal(projection.refreshTruth, 'MANUAL_REFRESH_REQUIRED', value);
  }
});

test('automation receipt proof requires a verified strict identifier', () => {
  for (const value of [
    'receipt-current',
    'receipt-verified',
    'receipt-abc123',
    'receipt-2002.failed',
    'receipt-2002canceled',
    'receipt-2002stalled',
  ]) {
    const projection = verifiedProjection(verifiedGoal({ proof: { automationReceipt: value }, truth: {} }));
    assert.equal(projection.sourceTruth.goalsCurrent, false, value);
  }

  const numeric = verifiedProjection(verifiedGoal({ proof: { automationReceipt: 'receipt-2002' }, truth: {} }));
  assert.equal(numeric.sourceTruth.goalsCurrent, true);

  const uuid = verifiedProjection(verifiedGoal({ proof: { automationReceipt: 'receipt-123e4567-e89b-42d3-a456-426614174000' }, truth: {} }));
  assert.equal(uuid.sourceTruth.goalsCurrent, true);
});

test('receipt-derived evidence requires separate verified receipt truth', () => {
  const receiptOnlyGoal = verifiedGoal({ proof: { automationReceipt: 'receipt-2002' }, truth: {} });
  const unverified = verifiedProjection(receiptOnlyGoal, { automationReceipt: { verified: false } });
  assert.equal(unverified.sourceTruth.automationReceiptVerified, false);
  assert.equal(unverified.sourceTruth.goalsCurrent, false);
  assert.equal(unverified.liveAutomationClaim, 'none');
  const verified = verifiedProjection(receiptOnlyGoal);
  assert.equal(verified.sourceTruth.goalsCurrent, true);
  assert.equal(verified.liveAutomationClaim, 'receipt-backed-readonly');
});

test('timestamps must be calendar-valid and inside the canonical freshness window', () => {
  const invalidCalendar = verifiedProjection(verifiedGoal({ lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-02-30T12:00:00.000Z' } }));
  assert.equal(invalidCalendar.sourceTruth.goalsCurrent, false);
  const old = verifiedProjection(verifiedGoal({ lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2000-01-01T00:00:00.000Z' } }));
  assert.equal(old.sourceTruth.goalsCurrent, false);
  const future = verifiedProjection(verifiedGoal({ lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T12:07:00.000Z' } }));
  assert.equal(future.sourceTruth.goalsCurrent, false);
  const offsetCurrent = verifiedProjection(verifiedGoal({ lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T13:00:00.000+01:00' } }));
  assert.equal(offsetCurrent.sourceTruth.goalsCurrent, true);
  const enlarged = verifiedProjection(verifiedGoal({ lastUpdated: { source: 'verified-readonly-goal-status-adapter', at: '2026-07-23T11:35:00.000Z' } }), { freshnessWindowMs: 60 * 60 * 1000 });
  assert.equal(enlarged.freshnessWindowMs, GOAL_DASHBOARD_FRESHNESS_WINDOW_MS);
  assert.equal(enlarged.sourceTruth.goalsCurrent, false);
  const smaller = verifiedProjection(verifiedGoal(), { freshnessWindowMs: 2 * 60 * 1000 });
  assert.equal(smaller.freshnessWindowMs, 2 * 60 * 1000);
  assert.equal(smaller.sourceTruth.goalsCurrent, false);
});

test('local adapter truth remains distinct from automation receipt truth', () => {
  const projection = buildGoalDashboardStatusProjection({ now: NOW, localAdapter: { verified: true }, goals: [{ issue: '#2009' }] });
  assert.equal(projection.localAutomationTruth, 'local-readonly-adapter-verified');
  assert.equal(projection.sourceTruth.automationReceiptVerified, false);
  assert.equal(projection.liveAutomationClaim, 'none');
});

test('standalone Goal Dashboard exposes guarded V5, V7 and V8 truth', () => {
  const projection = buildGoalDashboardStatusProjection({
    now: NOW,
    buildConcierge: {
      candidates: [{ id: 'goal-v8', title: 'V8 goal', headSha: 'c'.repeat(40), state: 'OPEN', mergeable: true, requiredChecksClean: true, proofCommands: ['npm test'] }],
      antiStallMergeLane: { connectorMergeAttempted: false },
      postMergeSync: { mergeReceipt: { receiptId: 'merge-1400' }, workingTreeClean: true, pullMainReceipt: { receiptId: 'pull-main' }, restartRefreshReceipt: { receiptId: 'refresh' } },
    },
  });
  assert.equal(projection.buildConcierge.roadmap.phases.find((phase) => phase.version === 'V5').status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.roadmap.phases.find((phase) => phase.version === 'V7').status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.roadmap.phases.find((phase) => phase.version === 'V8').status, 'implemented_guarded');
  assert.equal(projection.buildConcierge.queue.oneActiveLaneGuardrail, 'satisfied');
  assert.equal(projection.buildConcierge.antiStallMergeLane.cliMergeFallbackAllowed, false);
});
