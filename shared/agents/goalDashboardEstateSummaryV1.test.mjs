import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGoalDashboardEstateSummary } from './goalDashboardEstateSummaryV1.mjs';

const NOW = Date.parse('2026-09-22T06:30:00.000Z');

function goals(count, status = 'ACTIVE') {
  return Array.from({ length: count }, (_, index) => ({
    goalId: `goal-${1200 + index}`,
    title: `Durable goal ${index + 1}`,
    status,
    timestampUtc: '2026-09-22T06:29:00.000Z',
  }));
}

test('the complete 86-goal estate is preserved without portfolio truncation', () => {
  const goalRecords = goals(86);
  const proofRecords = goalRecords.map((goal) => ({
    goalId: goal.goalId,
    status: 'PASS',
    timestampUtc: '2026-09-22T06:29:30.000Z',
  }));
  const summary = buildGoalDashboardEstateSummary({ goalRecords, proofRecords, nowMs: NOW });

  assert.equal(summary.totalOpenGoals, 86);
  assert.equal(summary.goals.length, 86);
  assert.equal(summary.stateCounts.active, 86);
  assert.equal(summary.proofCounts.current, 86);
  assert.equal(summary.goals[0].goalId, '#1200');
  assert.equal(summary.goals.at(-1).goalId, '#1285');
});

test('latest terminal state removes a goal while old active history cannot resurrect it', () => {
  const summary = buildGoalDashboardEstateSummary({
    nowMs: NOW,
    goalRecords: [
      { goalId: 'goal-1219', title: 'Old active state', status: 'ACTIVE', timestampUtc: '2026-09-22T06:00:00Z' },
      { goalId: 'goal-1219', title: 'Closed state', status: 'COMPLETED', timestampUtc: '2026-09-22T06:20:00Z' },
      { goalId: 'goal-1622', title: 'Still active', status: 'ACTIVE', timestampUtc: '2026-09-22T06:25:00Z' },
    ],
  });

  assert.equal(summary.totalOpenGoals, 1);
  assert.deepEqual(summary.goals.map((goal) => goal.goalId), ['#1622']);
});

test('estate state buckets remain explicit rather than collapsing into one green status', () => {
  const states = [
    ['goal-1', 'ELIGIBLE'],
    ['goal-2', 'BUILDING'],
    ['goal-3', 'PARKED_EXACT_BLOCKER'],
    ['goal-4', 'WAITING_DEPENDENCY'],
    ['goal-5', 'OPERATOR_READY_PARKED'],
    ['goal-6', 'SOMETHING_NEW'],
  ];
  const summary = buildGoalDashboardEstateSummary({
    nowMs: NOW,
    goalRecords: states.map(([goalId, status]) => ({ goalId, title: goalId, status, timestampUtc: '2026-09-22T06:29:00Z' })),
  });

  assert.deepEqual(summary.stateCounts, {
    eligible: 1,
    active: 1,
    parked: 1,
    waitingDependency: 1,
    operatorReady: 1,
    unknown: 1,
  });
  assert.equal(summary.proofCounts.unknown, 6);
});

test('proof freshness is tracked independently from open-goal state', () => {
  const summary = buildGoalDashboardEstateSummary({
    nowMs: NOW,
    staleAfterMs: 60_000,
    goalRecords: [
      { goalId: 'goal-10', title: 'Fresh proof', status: 'ACTIVE', timestampUtc: '2026-09-22T06:29:00Z' },
      { goalId: 'goal-11', title: 'Stale proof', status: 'ACTIVE', timestampUtc: '2026-09-22T06:29:00Z' },
      { goalId: 'goal-12', title: 'No proof', status: 'ACTIVE', timestampUtc: '2026-09-22T06:29:00Z' },
    ],
    proofRecords: [
      { goalId: 'goal-10', timestampUtc: '2026-09-22T06:29:30Z' },
      { goalId: 'goal-11', timestampUtc: '2026-09-22T06:00:00Z' },
    ],
  });

  assert.deepEqual(summary.proofCounts, { current: 1, stale: 1, unknown: 1 });
});
