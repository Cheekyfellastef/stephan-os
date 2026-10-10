import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchElasticGoalBuildsFromCanonicalMain } from './criticalBacklogConveyorService.js';
import {
  dispatchElasticPrHeadBuildsFromCanonicalLease,
  exactElasticPrHeadIdentity,
  reconcileExpiredElasticReviewLeaseV1,
} from './elasticPrHeadLeaseService.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE = 'b'.repeat(40);
const HEAD_A = 'a'.repeat(40);
const HEAD_C = 'c'.repeat(40);
const NOW = new Date('2026-09-08T10:00:00.000Z');
const PATHS = {
  workspaceRoot: '/workspace',
  repoRoot: '/repo',
  orchestratorRoot: '/orchestrator',
  snapshotRoot: '/snapshot',
};

function mission(issueNumber, prNumber, headSha, overrides = {}) {
  const missionId = `critical-${issueNumber}-elastic-goal`;
  return {
    missionId,
    revision: 7,
    currentPhase: 'CHECK_PULL_REQUEST',
    repository: REPOSITORY,
    git: {
      branch: `openclaw/elastic-goal-${issueNumber}`,
      worktreePath: `/worktrees/${missionId}`,
    },
    pullRequest: { number: prNumber, headSha },
    allowedFiles: [`shared/agents/goal-${issueNumber}.mjs`],
    requiredTests: [`node --test shared/agents/goal-${issueNumber}.test.mjs`],
    requiredEvidence: [`goal-${issueNumber}-proof`],
    dispatch: { status: 'idle' },
    ...overrides,
  };
}

function leaseFor(candidate, overrides = {}) {
  const identity = exactElasticPrHeadIdentity(candidate);
  return {
    leaseId: `${identity.missionId}-r${candidate.revision}-lease`,
    laneId: identity.missionId,
    repository: identity.repository,
    issueNumber: identity.issueNumber,
    prNumber: identity.prNumber,
    branch: identity.branch,
    headSha: identity.headSha,
    ownerId: 'mission-worker',
    ...overrides,
  };
}

function admission(missions, selectedMission = missions[0]) {
  return {
    desiredWidth: 5,
    selectedMission,
    elasticMissions: missions,
    activeMissions: missions,
    runnableMissions: missions.filter((item) => item.currentPhase !== 'AWAITING_OPERATOR_APPROVAL'),
  };
}

test('exact identity exists only after an elastic mission owns a PR head', () => {
  const exact = mission(1802, 2096, HEAD_A);
  assert.deepEqual(exactElasticPrHeadIdentity(exact), {
    missionId: 'critical-1802-elastic-goal',
    issueNumber: 1802,
    prNumber: 2096,
    headSha: HEAD_A,
    branch: 'openclaw/elastic-goal-1802',
    repository: REPOSITORY,
  });
  assert.equal(exactElasticPrHeadIdentity({
    ...exact,
    pullRequest: null,
  }), null);
});

test('claims the canonical lease before publishing one exact PR-head worker grant', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  const calls = [];
  let claimedRecord = null;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    testOnly: true,
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: false, reason: 'SOURCE_MUTATION_LEASE_NOT_CLAIMED' }),
    claimSourceMutationLease: async (input) => {
      calls.push(['claim', input]);
      claimedRecord = { ...input };
      return { ok: true, claimed: true, record: claimedRecord };
    },
    renewSourceMutationLease: async () => {
      throw new Error('renew must not run on first claim');
    },
    releaseSourceMutationLease: async () => {
      throw new Error('release must not run on active work');
    },
    isActionInFlight: async () => false,
    publishWorkerAction: async (options) => {
      calls.push(['publish', options.actionGrant]);
      return {
        published: true,
        actionGrantAccepted: true,
        adapter: 'openclaw-github-readonly',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.deepEqual(result.newlyOccupiedMissionIds, ['critical-1802-elastic-goal']);
  assert.equal(calls[0][0], 'claim');
  assert.equal(calls[0][1].prNumber, 2096);
  assert.equal(calls[0][1].headSha, HEAD_A);
  assert.equal(calls[0][1].branch, 'openclaw/elastic-goal-1802');
  assert.equal(calls[0][1].ownerId, 'mission-worker');
  assert.equal(calls[1][0], 'publish');
  assert.equal(calls[1][1].prNumber, 2096);
  assert.equal(calls[1][1].headSha, HEAD_A);
  assert.equal(calls[1][1].laneId, 'critical-1802-elastic-goal');
  assert.equal(calls[1][1].boundedActionCount, 1);
  assert.equal(calls[1][1].mergeAuthority, false);
  assert.equal(calls[1][1].leaseSeizureAllowed, false);
  assert.deepEqual(result.activeLease, claimedRecord);
});

test('renews an exact running PR-head lease without publishing a duplicate action', async () => {
  const candidate = mission(1802, 2096, HEAD_A, { dispatch: { status: 'running' } });
  const lease = leaseFor(candidate);
  let renewCount = 0;
  let publishCount = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease }),
    renewSourceMutationLease: async (input) => {
      renewCount += 1;
      assert.equal(input.leaseId, lease.leaseId);
      assert.equal(input.headSha, HEAD_A);
      return { ok: true, renewed: true, record: lease };
    },
    claimSourceMutationLease: async () => {
      throw new Error('claim must not run for an exact active lease');
    },
    releaseSourceMutationLease: async () => {
      throw new Error('release must not run for active source work');
    },
    publishWorkerAction: async () => {
      publishCount += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_LEASE_ALREADY_RUNNING');
  assert.equal(renewCount, 1);
  assert.equal(publishCount, 0);
});

test('releases a parked exact lease and refills the same lease slot with the next PR-head mission', async () => {
  const parked = mission(1802, 2096, HEAD_A, {
    currentPhase: 'AWAITING_OPERATOR_APPROVAL',
    dispatch: { status: 'idle' },
  });
  const next = mission(1899, 1920, HEAD_C);
  const parkedLease = leaseFor(parked);
  const calls = [];
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([parked, next], parked), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: parkedLease }),
    releaseSourceMutationLease: async (input) => {
      calls.push(['release', input]);
      return { ok: true, released: true, reason: 'SOURCE_MUTATION_LEASE_RELEASED' };
    },
    claimSourceMutationLease: async (input) => {
      calls.push(['claim', input]);
      return { ok: true, claimed: true, record: { ...input } };
    },
    renewSourceMutationLease: async () => {
      throw new Error('renew must not run after parked lease release');
    },
    isActionInFlight: async () => false,
    publishWorkerAction: async (options) => {
      calls.push(['publish', options.actionGrant]);
      return { published: true, actionGrantAccepted: true, adapter: 'openclaw-github-readonly' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE');
  assert.equal(calls[0][0], 'release');
  assert.equal(calls[0][1].prNumber, 2096);
  assert.equal(calls[1][0], 'claim');
  assert.equal(calls[1][1].prNumber, 1920);
  assert.equal(calls[1][1].headSha, HEAD_C);
  assert.equal(calls[2][0], 'publish');
  assert.equal(calls[2][1].prNumber, 1920);
  assert.equal(result.releasedLease.ok, true);
});

test('a lease owned by another canonical lane blocks PR-head takeover without seizure', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  const foreign = {
    ...leaseFor(candidate),
    laneId: 'critical-1899-elastic-goal',
    issueNumber: 1899,
    prNumber: 1920,
    branch: 'openclaw/elastic-goal-1899',
    headSha: HEAD_C,
  };
  let claimCount = 0;
  let publishCount = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: foreign }),
    claimSourceMutationLease: async () => {
      claimCount += 1;
      return { ok: true };
    },
    renewSourceMutationLease: async () => ({ ok: true }),
    releaseSourceMutationLease: async () => ({ ok: true }),
    publishWorkerAction: async () => {
      publishCount += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_LEASE_OCCUPIED');
  assert.equal(result.held[0].reason, 'SOURCE_MUTATION_LEASE_OWNED_BY_OTHER_LANE');
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(claimCount, 0);
  assert.equal(publishCount, 0);
});

test('signed PR-head commit actions use the canonical openclaw-signed adapter', async () => {
  const candidate = mission(1802, 2096, HEAD_A, { currentPhase: 'GITHUB_COMMIT' });
  const lease = leaseFor(candidate);
  let publishedGrant = null;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease }),
    renewSourceMutationLease: async () => ({ ok: true, renewed: true, record: lease }),
    claimSourceMutationLease: async () => { throw new Error('claim must not run'); },
    releaseSourceMutationLease: async () => { throw new Error('release must not run'); },
    isActionInFlight: async () => false,
    publishWorkerAction: async ({ actionGrant }) => {
      publishedGrant = actionGrant;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_DISPATCH_LIVE');
  assert.equal(publishedGrant.actionKind, 'signed-openclaw-operation');
  assert.equal(publishedGrant.adapter, 'openclaw-signed');
  assert.equal(publishedGrant.operation, 'commit');
});

test('an in-flight non-handoff grant renews its lease without republishing a duplicate action', async () => {
  const candidate = mission(1802, 2096, HEAD_A);
  const lease = leaseFor(candidate);
  let publishCount = 0;
  const result = await dispatchElasticPrHeadBuildsFromCanonicalLease(admission([candidate]), {
    now: NOW,
    paths: PATHS,
    sourceRevision: SOURCE,
    readSourceMutationLease: async () => ({ ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_ACTIVE', record: lease }),
    renewSourceMutationLease: async () => ({ ok: true, renewed: true, record: lease }),
    claimSourceMutationLease: async () => { throw new Error('claim must not run'); },
    releaseSourceMutationLease: async () => { throw new Error('release must not run'); },
    isActionInFlight: async ({ adapter, actionId }) => {
      assert.equal(adapter, 'openclaw-github-readonly');
      assert.match(actionId, /^critical-1802-elastic-goal-r7-/);
      return true;
    },
    publishWorkerAction: async () => {
      publishCount += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_PR_HEAD_ACTION_ALREADY_IN_FLIGHT');
  assert.equal(publishCount, 0);
});

test('aggregate ignition preserves a failed PR-head lease verdict even when sibling pre-PR work is healthy', async () => {
  const result = await dispatchElasticGoalBuildsFromCanonicalMain({
    desiredWidth: 1,
    selectedMission: null,
    elasticMissions: [],
    activeMissions: [],
    runnableMissions: [],
  }, {
    testOnly: true,
    now: NOW,
    paths: PATHS,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead: SOURCE } }),
    readCapacityRouting: async () => ({}),
    dispatchPrHeadBuilds: async () => ({
      ok: false,
      classification: 'ELASTIC_PR_HEAD_LEASE_RENEWAL_BLOCKED',
      dispatched: [],
      held: [{ missionId: 'critical-1802-elastic-goal', reason: 'LEASE_RENEWAL_FAILED' }],
      handledMissionIds: ['critical-1802-elastic-goal'],
    }),
    resolveCapacityCandidates: () => [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'ELASTIC_GOAL_BUILD_DISPATCH_PARTIAL_BLOCKED');
  assert.equal(result.prHeadLease.ok, false);
  assert.equal(result.held.some((item) => item.reason === 'LEASE_RENEWAL_FAILED'), true);
});

test('guarded expired r7 review lease can be released only after matching owner/phase and no pending worker action', async () => {
  const review = mission(1802, 2096, HEAD_A);
  const stale = leaseFor(review);
  const calls = [];
  const result = await reconcileExpiredElasticReviewLeaseV1({
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/worker-queue' },
    missionRecords: [review],
    readLease: async () => ({
      ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_STALE',
      validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
      record: stale,
    }),
    readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: null }),
    isActionInFlightFn: async (input) => {
      calls.push(['queue-observed', input.adapter]);
      assert.equal(input.adapter, 'openclaw-github-readonly');
      return false;
    },
    releaseLease: async (input) => {
      calls.push(['released', input.leaseId]);
      assert.equal(input.ownerId, 'mission-worker');
      assert.equal(input.headSha, HEAD_A);
      assert.equal(input.prNumber, 2096);
      return { ok: true, released: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.released, true);
  assert.equal(result.classification, 'ELASTIC_EXPIRED_REVIEW_LEASE_SAFELY_RELEASED');
  assert.equal(result.originalMissionId, 'critical-1802-elastic-goal');
  assert.deepEqual(calls.map((item) => item[0]), ['queue-observed', 'released']);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.materialPickupProven, false);
});

test('stale review lease refuses release for running, mismatched, queued, or unproven ownership', async () => {
  const review = mission(1802, 2096, HEAD_A);
  const stale = leaseFor(review);
  const goodLease = async () => ({
    ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_STALE',
    validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
    record: stale,
  });
  let releases = 0;
  const base = {
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/worker-queue' },
    missionRecords: [review],
    readLease: goodLease,
    readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: null }),
    isActionInFlightFn: async () => false,
    releaseLease: async () => { releases += 1; return { ok: true, released: true }; },
  };
  const cases = [
    { missionRecords: [mission(1802, 2096, HEAD_A, { dispatch: { status: 'running' } })] },
    { missionRecords: [mission(1802, 2096, HEAD_A, { currentPhase: 'AGENT_IMPLEMENTATION' })] },
    { missionRecords: [mission(1802, 2096, HEAD_C)] },
    { missionRecords: [review, review] },
    { isActionInFlightFn: async () => true },
    { readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: { state: 'started' } }) },
    { readReceiptHistoryFn: async () => ({ ok: false, reason: 'READ_FAILED' }) },
    { readLease: async () => ({ ...(await goodLease()), validation: { valid: true, active: true, stale: false } }) },
    { readLease: async () => ({ ...(await goodLease()), record: { ...stale, ownerId: 'another-worker' } }) },
    { sourceRevision: '' },
    { env: {} },
  ];
  for (const scenario of cases) {
    const result = await reconcileExpiredElasticReviewLeaseV1({ ...base, ...scenario });
    assert.equal(result.released, false, result.blocker);
    assert.equal(result.leaseSeizureAllowed, false);
    assert.equal(result.dispatchAuthority, false);
  }
  assert.equal(releases, 0, 'no unsafe source lease must be released');
});

test('canonical completed implementation dispatch in CHECK_PULL_REQUEST can release expired review lease only after queue/history prove idle', async () => {
  const review = mission(1802, 2096, HEAD_A, { dispatch: { status: 'complete' } });
  const stale = leaseFor(review);
  let released = 0;
  const args = {
    now: NOW, sourceRevision: SOURCE, paths: PATHS,
    env: { STEPHANOS_MISSION_WORKER_QUEUE_DIR: '/worker-queue' },
    missionRecords: [review],
    readLease: async () => ({
      ok: true, present: true, reason: 'SOURCE_MUTATION_LEASE_STALE',
      validation: { valid: true, active: false, stale: true, finalVerdict: 'SOURCE_MUTATION_LEASE_STALE' },
      record: stale,
    }),
    readReceiptHistoryFn: async () => ({ ok: true, latestReceipt: null }),
    isActionInFlightFn: async () => false,
    releaseLease: async () => {
      released += 1;
      return { ok: true, released: true };
    },
  };
  const safe = await reconcileExpiredElasticReviewLeaseV1(args);
  assert.equal(safe.released, true);
  assert.equal(released, 1);
  assert.equal(safe.leaseSeizureAllowed, false);

  const activeQueue = await reconcileExpiredElasticReviewLeaseV1({
    ...args, isActionInFlightFn: async () => true,
  });
  assert.equal(activeQueue.released, false);
  assert.equal(activeQueue.blocker, 'EXACT_REVIEW_ACTION_STILL_IN_FLIGHT');
  assert.equal(released, 1);

  const pending = await reconcileExpiredElasticReviewLeaseV1({
    ...args, missionRecords: [mission(1802, 2096, HEAD_A, { dispatch: { status: 'pending' } })],
  });
  assert.equal(pending.released, false);
  assert.equal(pending.blocker, 'REVIEW_DISPATCH_NOT_SAFELY_TERMINAL');
  assert.equal(released, 1);
});
