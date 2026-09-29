import test from 'node:test';
import assert from 'node:assert/strict';

import { overlayGoalDashboardWithLivePortfolio } from './liveGoalDashboardPortfolioOverlay.mjs';

const NOW = Date.parse('2026-08-14T11:30:00Z');
const HEAD = 'a'.repeat(40);
const REQUIRED_WORKFLOWS = [
  'OpenClaw GitHub Operator',
  'Protected Operator Merge Source Proof',
  'Exact-Head Review Dispatch',
  'PR Clean Guard',
  'Build Stephanos UI',
  'Battle Bridge Publisher Proof',
  'Codex Dispatch Queue Proof',
];

function exactHeadWorkflowRows(prNumber, headSha = HEAD, status = 'passed') {
  return REQUIRED_WORKFLOWS.map((name, index) => ({
    id: `workflow-${index + 1}`,
    name,
    status,
    prNumber,
    headSha,
    updatedAt: '2026-08-14T11:29:45Z',
  }));
}

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
            headSha: HEAD,
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
  assert.equal(projection.goals[0].exactHead, HEAD);
  assert.equal(projection.goals[0].proofTruth, 'CURRENT');
  assert.match(projection.goals[0].summary, /APPROVAL_REQUIRED/);
  assert.doesNotMatch(projection.goals[0].title, /Legacy seeded goal/);
  assert.deepEqual(projection.operatorAttention.blockers, []);
  assert.doesNotMatch(projection.operatorAttention.exactNextAction, /legacy seed/i);
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
          { number: 1777, title: 'Old observation', headSha: HEAD, checksStatus: 'passed', mergeReadiness: 'awaiting_exact_head_approval', blockers: [] },
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
            headSha: HEAD,
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

test('workspace proof records bind exact goal identity rather than substring identity', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: { githubTelemetry: { adapterAvailable: false, pullRequests: [] } },
    goalRecords: [
      { issueNumber: 12, title: 'Goal twelve', status: 'ACTIVE', timestampUtc: '2026-08-14T11:29:30Z' },
    ],
    proofRecords: [
      { issueNumber: 123, status: 'PASS', timestampUtc: '2026-08-14T11:29:35Z', proofRefs: ['proofs/wrong-goal.json'] },
    ],
  });

  assert.equal(projection.goals[0].issue, '#12');
  assert.equal(projection.goals[0].proofTruth, 'UNKNOWN');
  assert.deepEqual(projection.goals[0].proofRefs, []);
  assert.ok(projection.goals[0].blockers.includes('UNKNOWN_PROOF_RECORD'));
});

test('default GitHub workflow evidence can prove a PR only when all canonical rows match the exact head', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: {
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:29:50Z',
        pullRequests: [
          {
            number: 1780,
            title: 'Workflow-backed current PR',
            headSha: HEAD,
            checksStatus: 'unknown',
            mergeReadiness: 'awaiting_exact_head_approval',
            blockers: ['checks_not_passed_or_unknown'],
          },
        ],
        workflows: exactHeadWorkflowRows(1780),
      },
    },
  });

  assert.equal(projection.goals[0].proofTruth, 'CURRENT');
  assert.match(projection.goals[0].summary, /checks passed/);
  assert.equal(projection.goals[0].blockers.includes('GITHUB_CHECKS_UNKNOWN'), false);
  assert.equal(projection.goals[0].blockers.includes('checks_not_passed_or_unknown'), false);
  assert.deepEqual(projection.operatorAttention.blockers, []);
  assert.equal(projection.finalVerdict, 'LANDING_GOAL_DASHBOARD_CURRENT');
});

test('workflow proof on another head never upgrades the current PR', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: {
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:29:50Z',
        pullRequests: [{ number: 1781, title: 'Exact-head mismatch', headSha: HEAD, checksStatus: 'unknown', blockers: [] }],
        workflows: exactHeadWorkflowRows(1781, 'b'.repeat(40)),
      },
    },
  });

  assert.equal(projection.goals[0].proofTruth, 'UNKNOWN');
  assert.ok(projection.goals[0].blockers.includes('GITHUB_CHECKS_UNKNOWN'));
});

test('passed check labels without an exact PR head remain unknown', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: {
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:29:50Z',
        pullRequests: [{ number: 1782, title: 'Headless proof', checksStatus: 'passed', blockers: ['head_sha_unknown'] }],
      },
    },
  });

  assert.equal(projection.goals[0].proofTruth, 'UNKNOWN');
  assert.equal(projection.goals[0].exactHead, 'unknown');
  assert.ok(projection.goals[0].blockers.includes('GITHUB_HEAD_UNKNOWN'));
  assert.match(projection.goals[0].exactNextAction, /exact-head identity/);
});

test('combined GitHub and Shared Workspace source truth downgrades for stale workspace evidence', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    staleAfterMs: 60_000,
    liveProjection: {
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:29:50Z',
        pullRequests: [{ number: 1783, title: 'Current GitHub PR', headSha: HEAD, checksStatus: 'passed', blockers: [] }],
      },
    },
    goalRecords: [{ goalId: 'goal-stale', title: 'Stale workspace goal', status: 'ACTIVE', timestampUtc: '2026-08-14T11:20:00Z' }],
    proofRecords: [{ goalId: 'goal-stale', status: 'PASS', timestampUtc: '2026-08-14T11:20:00Z' }],
  });

  assert.equal(projection.portfolioSource, 'LIVE_GITHUB_PLUS_SHARED_WORKSPACE');
  assert.equal(projection.sourceTruth, 'STALE');
  assert.equal(projection.goals.some((goal) => goal.issue === 'goal-stale'), true);
});

test('legacy base blockers are discarded when live cards replace the seeded estate', () => {
  const projection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: baseProjection(),
    nowMs: NOW,
    liveProjection: {
      githubTelemetry: {
        adapterAvailable: true,
        lastUpdatedAt: '2026-08-14T11:29:50Z',
        pullRequests: [{ number: 1784, title: 'Clean live PR', headSha: HEAD, checksStatus: 'passed', blockers: [] }],
      },
    },
  });

  assert.deepEqual(projection.operatorAttention.blockers, []);
  assert.equal(projection.operatorAttention.localProofNeeded.length, 0);
  assert.equal(projection.finalVerdict, 'LANDING_GOAL_DASHBOARD_CURRENT');
});
