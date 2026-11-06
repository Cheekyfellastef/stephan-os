import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOAL_COCKPIT_CHAT_SCHEMA_VERSION,
  buildGoalCockpitChatProjection,
} from './goalCockpitChatProjection.mjs';

const NOW = '2026-07-30T12:00:00.000Z';
const CURRENT_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function liveProjection({
  observedAt = NOW,
  cards = [],
  sourceTruth = 'live',
  blockers = [],
  staleWarnings = [],
} = {}) {
  return {
    schemaVersion: 'stephanos.live-goal-projection.v1',
    generatedAt: observedAt,
    sourceTruth,
    dashboardGoals: {
      schemaVersion: 'stephanos.live-dashboard-goals.v1',
      sourceTruth: sourceTruth === 'live' ? 'LIVE READ-ONLY GITHUB' : 'UNKNOWN',
      freshnessVerdict: sourceTruth === 'live' ? 'CURRENT_AT_REQUEST' : 'NO_CURRENT_GOAL_RECORDS',
      observedAt,
      totalAvailable: cards.length,
      displayedCount: cards.length,
      cards,
    },
    currentAgentStates: {},
    proofTruth: { github: sourceTruth === 'live' ? 'adapter-provided' : 'unknown', local: 'unknown', browser: 'unknown' },
    blockers,
    staleWarnings,
    nextOperatorAction: 'Inspect current proof.',
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  };
}

function sharedWorkspaceFeed({
  state = 'ready',
  activeLane = null,
  eventRecords = [],
} = {}) {
  return {
    state,
    reason: state === 'ready' ? 'WORKSPACE_RECORDS_CURRENT_OR_UNKNOWN_BY_GOAL' : 'NO_WORKSPACE_RECORDS',
    exactNextAction: 'Publish current proof.',
    records: {
      goalRecords: [],
      statusRecords: [],
      proofRecords: [],
      capabilityRecords: [],
      eventRecords,
    },
    projection: {
      sourceTruth: state === 'ready' ? 'CURRENT' : 'UNKNOWN',
      goals: [],
      captainsBridge: {
        activeLane,
        currentPr: activeLane?.prNumber || null,
        branch: activeLane?.branch || 'UNKNOWN',
        exactHead: activeLane?.headSha || 'UNKNOWN',
        latestProof: activeLane?.latestProof?.status || 'UNKNOWN',
      },
      operatorAttention: { approvals: [], blockers: [], exactNextAction: 'Inspect current proof.' },
    },
  };
}

function goalCard({
  issue = '#1700',
  observedAt = NOW,
  status = 'READY FOR REVIEW',
  statusTruth = 'CURRENT',
  headSha = CURRENT_HEAD,
  proofTruth = { github: 'CURRENT', checks: 'passed', review: 'unknown', runtime: 'unknown', browser: 'unknown' },
} = {}) {
  return {
    issue,
    issueNumber: Number(issue.replace(/\D/g, '')),
    title: 'Build the cockpit',
    status,
    statusTruth,
    sourceTruth: 'LIVE READ-ONLY GITHUB',
    observedAt,
    lastUpdatedAt: observedAt,
    currentOwner: 'Codex / review lane',
    nextOwner: 'Independent reviewer',
    milestone: `PR #1701 · ${headSha.slice(0, 10)}`,
    operatorNeeded: 'No',
    proofIndex: 4,
    nextAction: 'Request independent exact-head review.',
    proofTruth,
    linkedPr: {
      number: 1701,
      branch: 'feat/goal-cockpit',
      headSha,
      draft: false,
      checksStatus: proofTruth.checks,
      approvalStatus: proofTruth.review,
      mergeReadiness: 'unknown',
    },
    linkedPullRequests: [],
  };
}

test('goal cockpit keeps work state separate from proof truth and never paints missing proof green', () => {
  const projection = buildGoalCockpitChatProjection({
    now: new Date(NOW),
    liveGoalProjection: liveProjection({ cards: [goalCard({ status: 'COMPLETE' })] }),
    sharedWorkspaceFeed: sharedWorkspaceFeed(),
  });

  assert.equal(projection.schemaVersion, GOAL_COCKPIT_CHAT_SCHEMA_VERSION);
  assert.equal(projection.goals.length, 1);
  assert.equal(projection.goals[0].workState, 'COMPLETE');
  assert.equal(projection.goals[0].truth, 'UNKNOWN');
  assert.equal(projection.guardrails.readOnly, true);
  assert.equal(projection.guardrails.commandExecutionAllowed, false);
  assert.equal(projection.guardrails.repoMutationAllowed, false);
  assert.equal(projection.guardrails.mergeAllowed, false);
});

test('goal cockpit marks an aged otherwise-valid card STALE', () => {
  const staleAt = '2026-07-30T09:00:00.000Z';
  const projection = buildGoalCockpitChatProjection({
    now: new Date(NOW),
    maxCurrentAgeMs: 60 * 60 * 1000,
    liveGoalProjection: liveProjection({
      observedAt: staleAt,
      cards: [goalCard({
        observedAt: staleAt,
        proofTruth: { github: 'CURRENT', checks: 'CURRENT', review: 'CURRENT', runtime: 'CURRENT', browser: 'CURRENT' },
      })],
    }),
    sharedWorkspaceFeed: sharedWorkspaceFeed(),
  });

  assert.equal(projection.goals[0].truth, 'STALE');
});

test('goal cockpit marks exact-head disagreement as CONFLICT', () => {
  const otherHead = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const projection = buildGoalCockpitChatProjection({
    now: new Date(NOW),
    liveGoalProjection: liveProjection({
      cards: [goalCard({
        proofTruth: { github: 'CURRENT', checks: 'CURRENT', review: 'CURRENT', runtime: 'CURRENT', browser: 'CURRENT' },
      })],
    }),
    sharedWorkspaceFeed: sharedWorkspaceFeed({
      activeLane: {
        prNumber: 1701,
        branch: 'feat/goal-cockpit',
        headSha: otherHead,
        latestProof: { status: 'passed' },
      },
    }),
  });

  assert.equal(projection.goals[0].truth, 'CONFLICT');
  assert.match(JSON.stringify(projection), /exact.?head|head/i);
});

test('an authoritative empty estate clears goal cards instead of retaining an earlier snapshot', () => {
  const populated = buildGoalCockpitChatProjection({
    now: new Date(NOW),
    liveGoalProjection: liveProjection({ cards: [goalCard()] }),
    sharedWorkspaceFeed: sharedWorkspaceFeed(),
  });
  assert.equal(populated.goals.length, 1);

  const empty = buildGoalCockpitChatProjection({
    now: new Date(NOW),
    liveGoalProjection: liveProjection({ cards: [] }),
    sharedWorkspaceFeed: sharedWorkspaceFeed(),
  });

  assert.deepEqual(empty.goals, []);
  assert.ok(Object.values(empty.summary).includes(0));
});

test('request time alone does not churn the stable snapshot id', () => {
  const card = goalCard({
    proofTruth: { github: 'CURRENT', checks: 'CURRENT', review: 'CURRENT', runtime: 'CURRENT', browser: 'CURRENT' },
  });
  const first = buildGoalCockpitChatProjection({
    now: new Date(NOW),
    liveGoalProjection: liveProjection({ observedAt: NOW, cards: [card] }),
    sharedWorkspaceFeed: sharedWorkspaceFeed(),
  });
  const second = buildGoalCockpitChatProjection({
    now: new Date('2026-07-30T12:00:15.000Z'),
    liveGoalProjection: liveProjection({ observedAt: '2026-07-30T12:00:15.000Z', cards: [card] }),
    sharedWorkspaceFeed: sharedWorkspaceFeed(),
  });

  assert.equal(first.snapshotId, second.snapshotId);
});

test('a malformed live envelope fails closed instead of presenting an authoritative empty estate', () => {
  const malformed = liveProjection({ cards: [] });
  delete malformed.dashboardGoals.cards;
  const projection = buildGoalCockpitChatProjection({
    now: new Date(NOW),
    liveGoalProjection: malformed,
    sharedWorkspaceFeed: sharedWorkspaceFeed(),
  });

  assert.equal(projection.truth, 'UNKNOWN');
  assert.deepEqual(projection.goals, []);
  assert.match(projection.systems.find((system) => system.id === 'stephanos').detail, /unavailable|invalid/i);
});
