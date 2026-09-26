import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogConveyor.mjs';
import {
  applyMissionOrchestratorEvent,
  createMissionOrchestratorState,
} from '../../shared/agents/missionOrchestrator.mjs';
import { createMissionWorkerHeartbeatRecord } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';
import {
  GOAL_BUILDING_SELF_HOSTING_MISSION_ID,
  LEGACY_COMPLETED_RETIRED_MISSION_ID,
  LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  RETIRED_COMPLETED_LEGACY_ACCEPTANCE,
  SELF_HOSTING_CRITICAL_BACKLOG,
  SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES,
} from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
  dispatchElasticGoalBuilds,
  ensureCriticalBacklogMission,
  publishCriticalBacklogProjection,
  projectExecutiveIngressAcceptance,
  recoverOrphanedLegacyCriticalMission,
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

function activeCriticalMission(overrides = {}) {
  const mission = DEFAULT_CRITICAL_BACKLOG[0].mission;
  return {
    missionId: mission.missionId,
    title: mission.title,
    repository: mission.repository,
    operatorIntent: mission.operatorIntent,
    intendedOutcome: mission.intendedOutcome,
    allowedFiles: [...mission.allowedFiles],
    requiredTests: [...mission.requiredTests],
    requiredEvidence: [...mission.requiredEvidence],
    revision: 7,
    currentPhase: 'AGENT_IMPLEMENTATION',
    git: {
      branch: mission.branch,
      worktreePath: '/bounded/critical-1291-worker-watchdog-repair',
    },
    ...overrides,
  };
}

function elasticImplementationMission(issueNumber = 91) {
  return {
    missionId: `critical-${issueNumber}-elastic-goal`,
    title: `Elastic goal ${issueNumber}`,
    repository: 'Cheekyfellastef/stephan-os',
    operatorIntent: `Advance durable goal #${issueNumber} through one bounded implementation lane.`,
    intendedOutcome: `Durable goal #${issueNumber} reaches its next governed source checkpoint.`,
    allowedFiles: [`shared/agents/elastic-goal-${issueNumber}.mjs`],
    requiredTests: [`node --test shared/agents/elastic-goal-${issueNumber}.test.mjs`],
    requiredEvidence: ['focused elastic-goal proof'],
    revision: 1,
    currentPhase: 'AGENT_IMPLEMENTATION',
    git: {
      branch: `openclaw/elastic-goal-${issueNumber}`,
      worktreePath: `/bounded/critical-${issueNumber}-elastic-goal`,
    },
  };
}

test('idle conveyor creates exactly one bounded critical mission and publishes active status', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  const firstSchedulableMission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].missionId, firstSchedulableMission.missionId);
  assert.equal(store.records[0].git.branch, firstSchedulableMission.branch);
  assert.notEqual(store.records[0].missionId, LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID);
  assert.equal(result.projection.decision, 'WAIT_ACTIVE_MISSION');
  const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'), 'utf8'));
  assert.equal(status.activeMissionId, firstSchedulableMission.missionId);
  assert.equal(status.oneActiveMissionEnforced, true);
  assert.equal(status.mergeAuthority, false);
  assert.doesNotMatch(JSON.stringify(status), /critical-conveyor-.*(?:repo|worktrees)/);
});


test('discovery-mode conveyor defers legacy mission creation to the durable controller', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore();
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    allowLegacyMissionCreation: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, false);
  assert.equal(result.legacyMissionCreationAllowed, false);
  assert.equal(result.classification, 'CREATE_NEXT_MISSION_DEFERRED_TO_DURABLE_CONTROLLER');
  assert.equal(store.records.length, 0);
  assert.equal(result.projection.decision, 'CREATE_NEXT_MISSION');
});

test('stale CREATE_WORKTREE mission is classified orphaned only with fresh idle worker and no active lease', async () => {
  const paths = await roots();
  const mission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  let state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    worktreePath: join(paths.worktreeRoot, mission.missionId),
  }, { now: new Date('2026-09-23T12:00:00.000Z') });
  assert.equal(state.currentPhase, 'CREATE_WORKTREE');
  const head = 'a'.repeat(40);
  const heartbeat = createMissionWorkerHeartbeatRecord({
    timestampUtc: '2026-09-23T14:29:50.000Z',
    repositoryRoot: paths.repoRoot,
    branch: 'main',
    headSha: head,
    taskName: 'Stephanos Mission Orchestrator Worker',
    pid: 24408,
    launchIdentityId: 'b'.repeat(64),
    workerStartedAtUtc: '2026-09-23T11:59:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
  });
  let appendCalls = 0;
  const recovered = await recoverOrphanedLegacyCriticalMission({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: head },
    now: new Date('2026-09-23T14:30:00.000Z'),
    paths,
    listMissions: async () => [structuredClone(state)],
    readWorkerHeartbeat: async () => heartbeat,
    readMutationLease: async () => null,
    appendEvent: async (missionId, event, options) => {
      appendCalls += 1;
      assert.equal(missionId, state.missionId);
      assert.equal(event.eventType, 'MISSION_BLOCKED');
      assert.equal(event.expectedRevision, state.revision);
      assert.equal(event.expectedCurrentPhase, 'CREATE_WORKTREE');
      assert.match(event.reason, /ORPHANED_ACTIVE_MISSION/);
      state = applyMissionOrchestratorEvent(state, event, { now: options.now });
      return { state: structuredClone(state), preconditionFailed: false };
    },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.classification, 'ORPHANED_ACTIVE_MISSION_BLOCKED_FOR_PARKING');
  assert.equal(appendCalls, 1);
  assert.equal(state.currentPhase, 'BLOCKED');
});

test('fresh CREATE_WORKTREE work is never auto-classified as orphaned', async () => {
  const paths = await roots();
  const mission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  const state = createMissionOrchestratorState({
    ...mission,
    repositoryRoot: paths.repoRoot,
    worktreePath: join(paths.worktreeRoot, mission.missionId),
  }, { now: new Date('2026-09-23T14:25:00.000Z') });
  let appendCalls = 0;
  const recovered = await recoverOrphanedLegacyCriticalMission({
    backlog: SELF_HOSTING_CRITICAL_BACKLOG,
    now: new Date('2026-09-23T14:30:00.000Z'),
    paths,
    listMissions: async () => [structuredClone(state)],
    appendEvent: async () => { appendCalls += 1; },
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, false);
  assert.equal(recovered.classification, 'ORPHAN_CANDIDATE_WITHIN_PROGRESS_WINDOW');
  assert.equal(appendCalls, 0);
});

test('persisted #1291 and retired #1507 stay recorded but do not consume construction capacity', async () => {
  const paths = await roots();
  const legacy = activeCriticalMission();
  const retired = {
    missionId: LEGACY_COMPLETED_RETIRED_MISSION_ID,
    currentPhase: 'COMPLETE',
  };
  const store = inMemoryMissionStore([legacy, retired]);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  const firstSchedulableMission = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;

  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(store.records.length, 3);
  assert.equal(store.records[0].missionId, LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID);
  assert.equal(store.records[0].currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(store.records[1].missionId, LEGACY_COMPLETED_RETIRED_MISSION_ID);
  assert.equal(store.records[2].missionId, firstSchedulableMission.missionId);
  assert.equal(result.projection.activeMission?.missionId, firstSchedulableMission.missionId);
  assert.deepEqual(result.projection.nonBlockingPersistedMissionIds, [
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
  ]);
  assert.deepEqual(result.projection.nonBlockingMissionAcceptances, SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES);
  assert.equal(result.projection.nonBlockingMissionAcceptances[1].state, 'CLOSED_RETIRED');
  assert.deepEqual(result.projection.nonBlockingMissionAcceptances[1].successorIssueNumbers, [2158]);
  assert.deepEqual(result.projection.nonBlockingMissionAcceptances[1], RETIRED_COMPLETED_LEGACY_ACCEPTANCE);
});

test('completed legacy backlog creates Goal Building Agent self-hosting mission instead of idling', async () => {
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG.length, DEFAULT_CRITICAL_BACKLOG.length - 1);
  const paths = await roots();
  const completedLegacy = DEFAULT_CRITICAL_BACKLOG.map((entry) => ({
    missionId: entry.mission.missionId,
    currentPhase: 'COMPLETE',
  }));
  const store = inMemoryMissionStore(completedLegacy);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(result.missionRecord?.missionId, GOAL_BUILDING_SELF_HOSTING_MISSION_ID);
  assert.equal(result.missionRecord?.currentPhase, 'CREATE_WORKTREE');
  assert.equal(store.records.at(-1).missionId, GOAL_BUILDING_SELF_HOSTING_MISSION_ID);
  assert.equal(result.projection.decision, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.projection.selectedItem?.itemId, 'goal-building-self-hosting');
  assert.equal(result.projection.activeMission?.missionId, GOAL_BUILDING_SELF_HOSTING_MISSION_ID);
  assert.notEqual(result.classification, 'BACKLOG_COMPLETE');
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

test('active legacy critical implementation is dispatched through canonical proven capacity', async () => {
  const paths = await roots();
  const sourceHead = 'a'.repeat(40);
  const store = inMemoryMissionStore([activeCriticalMission()]);
  let publishCalls = 0;
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    backlog: DEFAULT_CRITICAL_BACKLOG,
    testOnly: true,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead } }),
    readCapacityRouting: async () => ({ providerNeutralCapacity: 'fresh' }),
    blockedAdapters: ['OPENCLAW-LOCAL'],
    publishActiveMission: async (mission, options) => {
      publishCalls += 1;
      assert.equal(mission.missionId, DEFAULT_CRITICAL_BACKLOG[0].mission.missionId);
      assert.equal(options.sourceRevision, sourceHead);
      assert.equal(options.capacityRouting.providerNeutralCapacity, 'fresh');
      assert.deepEqual(options.capacityRouting.blockedAdapters, ['openclaw-local']);
      return {
        published: true,
        adapter: 'foundry-forge',
        action: {
          adapter: 'foundry-forge',
          capacityRoute: 'FOUNDRY_FORGE',
          capacityReceiptId: 'forge-capacity-1',
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.activeMissionIgnition.classification, 'CRITICAL_ACTIVE_MISSION_DISPATCH_LIVE');
  assert.equal(result.activeMissionIgnition.published, true);
  assert.equal(result.activeMissionIgnition.adapter, 'foundry-forge');
  assert.equal(result.activeMissionIgnition.sourceRevision, sourceHead);
  assert.equal(publishCalls, 1);
});

test('active legacy critical implementation exposes missing proven capacity instead of silently idling', async () => {
  const paths = await roots();
  const sourceHead = 'b'.repeat(40);
  const store = inMemoryMissionStore([activeCriticalMission()]);
  let publishCalls = 0;
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    backlog: DEFAULT_CRITICAL_BACKLOG,
    testOnly: true,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead } }),
    readCapacityRouting: async () => null,
    publishActiveMission: async () => {
      publishCalls += 1;
      return { published: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'WAIT_ACTIVE_MISSION');
  assert.equal(result.activeMissionIgnition.classification, 'CRITICAL_ACTIVE_MISSION_CAPACITY_ROUTING_UNAVAILABLE');
  assert.deepEqual(result.activeMissionIgnition.blockers, ['provider-independent-capacity-routing-unavailable']);
  assert.equal(result.finalVerdict, 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED');
  assert.equal(publishCalls, 0);
});

test('active legacy critical implementation preserves an existing running dispatch', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore([activeCriticalMission({
    dispatch: { status: 'running', adapter: 'foundry-forge' },
  })]);
  let readCalls = 0;
  let publishCalls = 0;
  const result = await ensureCriticalBacklogMission({
    paths,
    now,
    ...store,
    backlog: DEFAULT_CRITICAL_BACKLOG,
    testOnly: true,
    readProgrammeProjection: async () => {
      readCalls += 1;
      return { machineryInventory: { sourceHead: 'c'.repeat(40) } };
    },
    publishActiveMission: async () => {
      publishCalls += 1;
      return { published: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.activeMissionIgnition.classification, 'CRITICAL_ACTIVE_MISSION_ALREADY_RUNNING');
  assert.equal(readCalls, 1);
  assert.equal(publishCalls, 0);
});

test('elastic dispatcher retries the next distinct proven capacity when the first publication path rejects the handoff', async () => {
  const mission = elasticImplementationMission();
  const attempts = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: null,
    activeMissions: [],
    runnableMissions: [mission],
  }, {
    now,
    sourceRevision: 'd'.repeat(40),
    paths: {
      repoRoot: '/repo',
      workspaceRoot: '/workspace',
      orchestratorRoot: '/orchestrator',
      snapshotRoot: '/snapshots',
    },
    resolveCapacityCandidates: () => [
      {
        route: 'CHATGPT_GITHUB',
        adapter: 'chatgpt-github',
        workerId: 'github-worker',
        receiptId: 'github-capacity-1',
        proofRefs: ['github-capacity-proof'],
      },
      {
        route: 'FOUNDRY_FORGE',
        adapter: 'foundry-forge',
        workerId: 'forge-worker',
        receiptId: 'forge-capacity-1',
        proofRefs: ['forge-capacity-proof'],
      },
    ],
    publishWorkerAction: async ({ actionGrant }) => {
      attempts.push(actionGrant.adapter);
      if (actionGrant.adapter === 'chatgpt-github') {
        return { published: false, actionGrantAccepted: false, reason: 'github-publication-unavailable' };
      }
      return { published: true, actionGrantAccepted: true, reason: 'published' };
    },
  });

  assert.deepEqual(attempts, ['chatgpt-github', 'foundry-forge']);
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.dispatched[0].adapter, 'foundry-forge');
  assert.equal(result.dispatched[0].workerId, 'forge-worker');
  assert.deepEqual(result.held, []);
  assert.equal(result.blockedLaneDoesNotStallFleet, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('elastic dispatcher reconciles an indeterminate publication on the same exact candidate before considering fallback', async () => {
  const mission = elasticImplementationMission(92);
  const attempts = [];
  let firstAttempt = true;
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: null,
    activeMissions: [],
    runnableMissions: [mission],
  }, {
    now,
    sourceRevision: 'e'.repeat(40),
    paths: {
      repoRoot: '/repo',
      workspaceRoot: '/workspace',
      orchestratorRoot: '/orchestrator',
      snapshotRoot: '/snapshots',
    },
    resolveCapacityCandidates: () => [
      {
        route: 'CHATGPT_GITHUB',
        adapter: 'chatgpt-github',
        workerId: 'github-worker',
        receiptId: 'github-capacity-1',
        proofRefs: ['github-capacity-proof'],
      },
      {
        route: 'FOUNDRY_FORGE',
        adapter: 'foundry-forge',
        workerId: 'forge-worker',
        receiptId: 'forge-capacity-1',
        proofRefs: ['forge-capacity-proof'],
      },
    ],
    publishWorkerAction: async ({ actionGrant }) => {
      attempts.push(actionGrant.adapter);
      if (actionGrant.adapter !== 'chatgpt-github') throw new Error('fallback-must-not-run');
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error('event-append-failed-after-publication');
      }
      return { published: true, actionGrantAccepted: true, reason: 'external-action-publication-reconciled' };
    },
  });

  assert.deepEqual(attempts, ['chatgpt-github', 'chatgpt-github']);
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.dispatched[0].adapter, 'chatgpt-github');
  assert.equal(result.dispatched[0].workerId, 'github-worker');
  assert.deepEqual(result.held, []);
});

test('elastic dispatcher fails closed after repeated indeterminate publication and never assigns a second writer', async () => {
  const mission = elasticImplementationMission(93);
  const attempts = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 5,
    selectedMission: null,
    activeMissions: [],
    runnableMissions: [mission],
  }, {
    now,
    sourceRevision: 'f'.repeat(40),
    paths: {
      repoRoot: '/repo',
      workspaceRoot: '/workspace',
      orchestratorRoot: '/orchestrator',
      snapshotRoot: '/snapshots',
    },
    resolveCapacityCandidates: () => [
      {
        route: 'CHATGPT_GITHUB',
        adapter: 'chatgpt-github',
        workerId: 'github-worker',
        receiptId: 'github-capacity-1',
        proofRefs: ['github-capacity-proof'],
      },
      {
        route: 'FOUNDRY_FORGE',
        adapter: 'foundry-forge',
        workerId: 'forge-worker',
        receiptId: 'forge-capacity-1',
        proofRefs: ['forge-capacity-proof'],
      },
    ],
    publishWorkerAction: async ({ actionGrant }) => {
      attempts.push(actionGrant.adapter);
      if (actionGrant.adapter !== 'chatgpt-github') throw new Error('fallback-must-not-run');
      throw new Error('event-append-still-indeterminate');
    },
  });

  assert.deepEqual(attempts, ['chatgpt-github', 'chatgpt-github']);
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD');
  assert.equal(result.dispatchCount, 0);
  assert.deepEqual(result.dispatched, []);
  assert.equal(result.held.length, 1);
  assert.match(result.held[0].reason, /^EXTERNAL_DISPATCH_INDETERMINATE:/);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
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


test('executive ingress acceptance is bound to exact handoff correlation and selected goal', () => {
  const acceptance = projectExecutiveIngressAcceptance({
    executiveSelectedGoal: '#2002',
    executiveHandoffId: 'stephanos-chat-2002-handoff',
    executiveCorrelationId: 'stephanos-chat-2002',
  }, {
    ok: true,
    elasticAdmission: {
      selectedMission: { missionId: 'critical-2002-elastic-goal' },
    },
    elasticIgnition: {
      classification: 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE',
    },
  });

  assert.equal(acceptance.accepted, true);
  assert.equal(acceptance.consumer, 'critical-backlog-conveyor');
  assert.equal(acceptance.handoffId, 'stephanos-chat-2002-handoff');
  assert.equal(acceptance.correlationId, 'stephanos-chat-2002');
  assert.equal(acceptance.selectedGoal, '#2002');
  assert.equal(acceptance.acceptedGoalIssue, 2002);
  assert.equal(acceptance.dispatchClassification, 'ELASTIC_GOAL_BUILD_DISPATCH_LIVE');
});

test('executive ingress acceptance fails closed when conveyor goal differs from requested goal', () => {
  const acceptance = projectExecutiveIngressAcceptance({
    executiveSelectedGoal: '#2002',
    executiveHandoffId: 'stephanos-chat-2002-handoff',
    executiveCorrelationId: 'stephanos-chat-2002',
  }, {
    ok: true,
    elasticAdmission: {
      selectedMission: { missionId: 'critical-1556-elastic-goal' },
    },
  });

  assert.equal(acceptance.accepted, false);
  assert.equal(acceptance.classification, 'EXECUTIVE_INGRESS_SELECTED_GOAL_MISMATCH');
  assert.equal(acceptance.acceptedGoalIssue, 1556);
});
