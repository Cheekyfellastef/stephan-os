import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogConveyor.mjs';
import {
  dispatchElasticGoalBuilds,
  ensureCriticalBacklogMission,
  publishCriticalBacklogProjection,
  resolveCriticalBacklogRuntimePaths,
} from './criticalBacklogConveyorService.js';

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'critical-conveyor-'));
  return resolveCriticalBacklogRuntimePaths({
    repoRoot: join(root, 'repo'),
    workspaceRoot: join(root, 'workspace'),
    worktreeRoot: join(root, 'worktrees'),
    orchestratorRoot: join(root, 'orchestrator'),
    snapshotRoot: join(root, 'snapshots'),
  });
}

function inMemoryMissionStore(initial = []) {
  const records = structuredClone(initial);
  return {
    records,
    listMissions: async () => structuredClone(records),
    createMission: async (mission) => {
      if (records.some((record) => record.missionId === mission.missionId)) {
        throw new Error(`Mission already exists: ${mission.missionId}`);
      }
      const state = {
        missionId: mission.missionId,
        currentPhase: 'CREATE_WORKTREE',
        git: { branch: mission.branch, worktreePath: mission.worktreePath },
      };
      records.push(state);
      return { state };
    },
  };
}

const now = new Date('2026-07-17T18:00:00.000Z');
const sourceRevision = 'a'.repeat(40);

function elasticMission(issueNumber, path, overrides = {}) {
  return {
    missionId: `critical-${issueNumber}-elastic-goal`,
    revision: 3,
    currentPhase: 'AGENT_IMPLEMENTATION',
    repository: 'Cheekyfellastef/stephan-os',
    operatorIntent: `Build goal ${issueNumber}.`,
    intendedOutcome: `Goal ${issueNumber} is implemented and tested.`,
    providerRouteIntent: 'AUTO',
    allowedFiles: [path],
    requiredTests: ['npm run stephanos:verify'],
    requiredEvidence: [`Goal #${issueNumber} bounded implementation and focused verification evidence`],
    git: {
      branch: `openclaw/elastic-goal-${issueNumber}`,
      worktreePath: `C:/worktrees/critical-${issueNumber}-elastic-goal`,
    },
    dispatch: { status: 'pending' },
    ...overrides,
  };
}

function capacity(route, adapter, workerId, receiptId) {
  return {
    route,
    adapter,
    workerId,
    receiptId,
    proofRefs: [`proofs/${receiptId}.json`],
    queueDepth: 0,
    p95StartLatencySeconds: 1,
  };
}

test('idle conveyor creates exactly one bounded critical mission and publishes active status', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].missionId, DEFAULT_CRITICAL_BACKLOG[0].mission.missionId);
  assert.equal(store.records[0].git.branch, 'openclaw/critical-1291-worker-watchdog-repair');
  assert.equal(result.projection.decision, 'WAIT_ACTIVE_MISSION');
  const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'), 'utf8'));
  assert.equal(status.activeMissionId, DEFAULT_CRITICAL_BACKLOG[0].mission.missionId);
  assert.equal(status.oneActiveMissionEnforced, true);
  assert.equal(status.mergeAuthority, false);
  assert.doesNotMatch(JSON.stringify(status), /critical-conveyor-.*(?:repo|worktrees)/);
});

test('subsequent ticks wait on the same active mission without duplicate creation', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const first = await ensureCriticalBacklogMission({ paths, now, ...store });
  const second = await ensureCriticalBacklogMission({ paths, now: new Date(now.getTime() + 60_000), ...store });
  assert.equal(first.createdMission, true);
  assert.equal(second.createdMission, false);
  assert.equal(store.records.length, 1);
  assert.equal(second.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(second.publication.changed, false);
});

test('mission creation fails closed when the preflight status cannot be published', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    publishProjection: async () => ({ ok: false, reason: 'workspace-unavailable' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'CREATE_NEXT_MISSION_PUBLICATION_BLOCKED');
  assert.equal(result.createdMission, false);
  assert.equal(store.records.length, 0);
});

test('external active mission prevents critical mission creation', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore([{ missionId: 'external-active-mission', currentPhase: 'CHECK_PULL_REQUEST' }]);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, false);
  assert.equal(result.classification, 'WAIT_EXTERNAL_ACTIVE_MISSION');
  assert.equal(store.records.length, 1);
});

test('multiple active missions fail closed and never create another lane', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore([
    { missionId: 'external-active-one', currentPhase: 'AGENT_IMPLEMENTATION' },
    { missionId: 'external-active-two', currentPhase: 'CHECK_PULL_REQUEST' },
  ]);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, false);
  assert.equal(result.createdMission, false);
  assert.equal(result.classification, 'BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS');
  assert.equal(store.records.length, 2);
});

test('publication emits one idempotent event file for one state change', async () => {
  const paths = await roots();
  const projection = {
    decision: 'WAIT_ACTIVE_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
    selectedItem: { itemId: 'worker-watchdog-self-heal' },
    activeMission: { missionId: 'critical-1291-worker-watchdog-repair', currentPhase: 'AGENT_IMPLEMENTATION' },
    completedItemIds: [],
    remainingItemIds: ['worker-watchdog-self-heal'],
    exactNextAction: 'Continue the active mission.',
  };
  const first = await publishCriticalBacklogProjection(projection, { paths, now });
  const second = await publishCriticalBacklogProjection(projection, { paths, now: new Date(now.getTime() + 60_000) });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  const events = await readdir(join(paths.workspaceRoot, 'events', 'critical-backlog-conveyor'));
  assert.equal(events.length, 1);
  assert.match(events[0], /^critical-backlog-[a-f0-9]{20}\.json$/);
});

test('elastic ignition publishes multiple disjoint pre-PR missions to distinct proven external capacity', async () => {
  const paths = await roots();
  const selected = elasticMission(101, 'shared/agents/selected.mjs');
  const githubMission = elasticMission(102, 'shared/agents/github.mjs');
  const forgeMission = elasticMission(103, 'shared/agents/forge.mjs');
  const publications = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: selected,
    activeMissions: [selected, githubMission, forgeMission],
    runnableMissions: [selected, githubMission, forgeMission],
  }, {
    paths,
    now,
    sourceRevision,
    capacityRouting: {},
    resolveCapacityCandidates: (mission) => mission.missionId.includes('102')
      ? [capacity('CHATGPT_GITHUB', 'chatgpt-github', 'github-builder-1', 'github-capacity-1')]
      : [capacity('FOUNDRY_FORGE', 'foundry-forge', 'forge-builder-1', 'forge-capacity-1')],
    publishWorkerAction: async ({ actionGrant }) => {
      publications.push(actionGrant);
      return { published: true, actionGrantAccepted: true, action: { actionId: actionGrant.actionId } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dispatchCount, 2);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.resourceDisjointOneWriterProven, true);
  assert.equal(result.blockedLaneDoesNotStallFleet, true);
  assert.deepEqual(publications.map(({ adapter }) => adapter), ['chatgpt-github', 'foundry-forge']);
  assert.ok(publications.every(({ boundedActionCount, mergeAuthority, leaseSeizureAllowed }) => (
    boundedActionCount === 1 && mergeAuthority === false && leaseSeizureAllowed === false
  )));
});

test('elastic ignition skips a conflicting lane and still dispatches a later resource-disjoint lane', async () => {
  const paths = await roots();
  const selected = elasticMission(111, 'shared/agents/selected.mjs');
  const running = elasticMission(112, 'shared/agents/conflict/**', {
    dispatch: { status: 'running', adapter: 'chatgpt-github', workerId: 'github-running', capacityReceiptId: 'github-running-capacity' },
  });
  const conflict = elasticMission(113, 'shared/agents/conflict/child.mjs');
  const safe = elasticMission(114, 'shared/runtime/safe.mjs');
  const publications = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: selected,
    activeMissions: [selected, running, conflict, safe],
    runnableMissions: [selected, conflict, safe],
  }, {
    paths,
    now,
    sourceRevision,
    capacityRouting: {},
    resolveCapacityCandidates: () => [capacity('FOUNDRY_FORGE', 'foundry-forge', 'forge-builder-2', 'forge-capacity-2')],
    publishWorkerAction: async ({ actionGrant }) => {
      publications.push(actionGrant);
      return { published: true, actionGrantAccepted: true, action: { actionId: actionGrant.actionId } };
    },
  });
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.dispatched[0].missionId, safe.missionId);
  assert.ok(result.held.some(({ missionId, reason }) => missionId === conflict.missionId && reason === 'RESOURCE_SCOPE_CONFLICT'));
  assert.equal(result.blockedLaneDoesNotStallFleet, true);
  assert.equal(publications.length, 1);
});

test('elastic ignition never side-dispatches PR-head work and never reuses one capacity identity', async () => {
  const paths = await roots();
  const selected = elasticMission(121, 'shared/agents/selected.mjs');
  const prHead = elasticMission(122, 'shared/agents/pr-head.mjs', {
    prNumber: 1999,
    headSha: 'b'.repeat(40),
    pullRequest: { number: 1999, headSha: 'b'.repeat(40) },
  });
  const first = elasticMission(123, 'shared/agents/first.mjs');
  const second = elasticMission(124, 'shared/agents/second.mjs');
  const sharedCapacity = capacity('CHATGPT_GITHUB', 'chatgpt-github', 'github-builder-one', 'github-capacity-one');
  const publications = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: selected,
    activeMissions: [selected, prHead, first, second],
    runnableMissions: [selected, prHead, first, second],
  }, {
    paths,
    now,
    sourceRevision,
    capacityRouting: {},
    resolveCapacityCandidates: () => [sharedCapacity],
    publishWorkerAction: async ({ actionGrant }) => {
      publications.push(actionGrant);
      return { published: true, actionGrantAccepted: true, action: { actionId: actionGrant.actionId } };
    },
  });
  assert.equal(result.dispatchCount, 1);
  assert.equal(publications.length, 1);
  assert.ok(result.held.some(({ missionId, reason }) => missionId === prHead.missionId && reason === 'EXACT_PR_HEAD_LANE_REQUIRES_CANONICAL_LEASE_PATH'));
  assert.ok(result.held.some(({ missionId, reason }) => missionId === second.missionId && reason === 'DISTINCT_PROVEN_EXTERNAL_CAPACITY_UNAVAILABLE'));
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});
