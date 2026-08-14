import test from 'node:test';
import assert from 'node:assert/strict';

import { overlayGoalDashboardWithLivePortfolio } from './liveGoalDashboardPortfolioOverlay.mjs';

const NOW = Date.parse('2026-08-14T11:30:00Z');

function baseProjection() {
  return {
    schemaVersion: 'stephanos.landing-goal-dashboard-projection.v1',
    sourceTruth: 'UNKNOWN',
    goals: [
      { issue: '#1290', title: 'Legacy seeded goal', statusTruth: 'UNKNOWN', proofTruth: 'UNKNOWN', blockers: ['UNKNOWN_STATUS_RECORD'], exactNextAction: 'Refresh legacy seed.' },
    ],
    operatorAttention: { approvals: [], localProofNeeded: ['#1290'], blockers: ['UNKNOWN_STATUS_RECORD'], exactNextAction: 'Refresh legacy seed.' },
    finalVerdict: 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED',
  };
}

test('current GitHub PR portfolio replaces legacy seed with exact current execution state', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: {
      generatedAt: '2026-08-14T11:29:40Z',
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:29:40Z',
        pullRequests: [
          {
            number: 1778,
            title: 'Wire Goal Dashboard to current programme truth',
            branch: 'agent/goal-dashboard-realtime-portfolio-wiring-v1',
            headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            checksStatus: 'passed',
            mergeReadiness: 'awaiting_exact_head_approval',
            approvalStatus: 'unknown',
            blockers: [],
            supersededStatus: 'active',
          },
        ],
      },
    },
  });

  assert.equal(projection.portfolioSource, 'LIVE_GITHUB_PLUS_SHARED_WORKSPACE');
  assert.equal(projection.sourceTruth, 'CURRENT');
  assert.equal(projection.liveGithubPrCount, 1);
  assert.equal(projection.goals[0].issue, 'PR #1778');
  assert.equal(projection.goals[0].title, 'Wire Goal Dashboard to current programme truth');
  assert.equal(projection.goals[0].exactHead, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(projection.goals[0].proofTruth, 'CURRENT');
  assert.match(projection.goals[0].summary, /APPROVAL_REQUIRED/);
  assert.doesNotMatch(projection.goals[0].title, /Legacy seeded goal/);
});

test('stale GitHub telemetry is never painted current', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    staleAfterMs: 60_000,
    liveProjection: {
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:20:00Z',
        pullRequests: [
          { number: 1777, title: 'Old observation', checksStatus: 'passed', mergeReadiness: 'awaiting_exact_head_approval', blockers: [] },
        ],
      },
    },
  });

  assert.equal(projection.sourceTruth, 'STALE');
  assert.equal(projection.goals[0].statusTruth, 'STALE');
  assert.equal(projection.goals[0].proofTruth, 'STALE');
  assert.ok(projection.goals[0].blockers.includes('STALE_GITHUB_TELEMETRY'));
  assert.equal(projection.finalVerdict, 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED');
});

test('current Shared Workspace goals provide live portfolio when GitHub adapter is unavailable', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: { githubTelemetry: { adapterAvailable: false, pullRequests: [] } },
    goalRecords: [
      {
        goalId: 'goal-1282',
        title: 'Goal Dashboard realtime truth',
        status: 'ACTIVE',
        timestampUtc: '2026-08-14T11:29:30Z',
      },
    ],
    proofRecords: [
      {
        proofId: 'proof-1282',
        goalId: 'goal-1282',
        status: 'PASS',
        timestampUtc: '2026-08-14T11:29:35Z',
        proofRefs: ['proofs/goal-1282.json'],
      },
    ],
  });

  assert.equal(projection.portfolioSource, 'LIVE_SHARED_WORKSPACE');
  assert.equal(projection.sourceTruth, 'CURRENT');
  assert.equal(projection.liveWorkspaceGoalCount, 1);
  assert.equal(projection.goals[0].issue, 'goal-1282');
  assert.equal(projection.goals[0].title, 'Goal Dashboard realtime truth');
  assert.equal(projection.goals[0].statusTruth, 'CURRENT');
  assert.equal(projection.goals[0].proofTruth, 'CURRENT');
});

test('terminal Shared Workspace goal records do not replace current portfolio', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: { githubTelemetry: { adapterAvailable: false, pullRequests: [] } },
    goalRecords: [
      { goalId: 'goal-old', title: 'Completed historical goal', status: 'COMPLETED', timestampUtc: '2026-08-14T11:29:30Z' },
    ],
  });

  assert.equal(projection.portfolioSource, 'BASE_PROJECTION_FALLBACK');
  assert.equal(projection.goals[0].issue, '#1290');
});

test('GitHub blockers remain visible instead of converting source progress into live completion', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: {
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:29:50Z',
        pullRequests: [
          {
            number: 1779,
            title: 'Blocked current PR',
            checksStatus: 'failed',
            mergeReadiness: 'blocked_or_unknown',
            blockers: ['checks_not_passed_or_unknown'],
          },
        ],
      },
    },
  });

  assert.equal(projection.goals[0].proofTruth, 'UNKNOWN');
  assert.ok(projection.goals[0].blockers.includes('GITHUB_CHECKS_FAILED'));
  assert.match(projection.goals[0].exactNextAction, /Repair failing exact-head checks/);
  assert.equal(projection.finalVerdict, 'LANDING_GOAL_DASHBOARD_ATTENTION_REQUIRED');
});
