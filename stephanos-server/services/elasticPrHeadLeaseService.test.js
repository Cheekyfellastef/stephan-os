import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchElasticPrHeadBuildsFromCanonicalLease,
  exactElasticPrHeadIdentity,
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
