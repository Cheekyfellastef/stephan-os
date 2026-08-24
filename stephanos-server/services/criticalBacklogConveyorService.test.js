import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogConveyor.mjs';
import { buildSchedulerGoalsFromProgrammeSources } from '../../shared/agents/programmeAuthorityV1.mjs';
import { writeAtomicJson } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { buildMissionScheduler } from '../../shared/runtime/missionScheduler.mjs';
import {
  CRITICAL_BACKLOG_CURRENT_GOAL_FILE,
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
  const goal = JSON.parse(await readFile(join(paths.workspaceRoot, 'goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE), 'utf8'));
  assert.equal(goal.goalId, 'goal-1291');
  assert.equal(goal.issueNumber, 1291);
  assert.equal(goal.missionId, DEFAULT_CRITICAL_BACKLOG[0].mission.missionId);
  assert.equal(goal.state, 'READY');
  assert.equal(goal.route, 'CHATGPT_GITHUB');
  assert.equal(goal.chatMemoryAuthoritative, false);
  assert.equal(goal.mergeAuthority, false);
  const schedulerGoals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: now.toISOString(),
    goalRecords: [goal],
  });
  assert.equal(schedulerGoals.valid, true, schedulerGoals.blockers.join(','));
  const scheduler = buildMissionScheduler({ now: now.toISOString(), goals: schedulerGoals.goals });
  assert.equal(scheduler.failClosed, false);
  assert.equal(scheduler.selectedGoal, '#1291');
  assert.equal(scheduler.selectedLifecycle, 'READY');
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
  const goal = JSON.parse(await readFile(join(paths.workspaceRoot, 'goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE), 'utf8'));
  assert.equal(goal.timestampUtc, new Date(now.getTime() + 60_000).toISOString());
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
    selectedItem: DEFAULT_CRITICAL_BACKLOG[0],
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

test('an external active mission neutralizes the previous runnable critical goal', async () => {
  const paths = await roots();
  const selected = {
    decision: 'WAIT_ACTIVE_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
    selectedItem: DEFAULT_CRITICAL_BACKLOG[0],
    activeMission: { missionId: DEFAULT_CRITICAL_BACKLOG[0].mission.missionId, currentPhase: 'AGENT_IMPLEMENTATION' },
    completedItemIds: [],
    remainingItemIds: [DEFAULT_CRITICAL_BACKLOG[0].itemId],
    exactNextAction: 'Continue the active mission.',
  };
  await publishCriticalBacklogProjection(selected, { paths, now });
  const heldAt = new Date(now.getTime() + 60_000);
  const held = await publishCriticalBacklogProjection({
    decision: 'WAIT_EXTERNAL_ACTIVE_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
    selectedItem: null,
    activeMission: { missionId: 'external-active-mission', currentPhase: 'CHECK_PULL_REQUEST' },
    completedItemIds: [],
    remainingItemIds: DEFAULT_CRITICAL_BACKLOG.map(({ itemId }) => itemId),
    exactNextAction: 'Continue the external mission before admitting critical backlog work.',
  }, { paths, now: heldAt });
  assert.equal(held.ok, true);
  const goal = JSON.parse(await readFile(join(paths.workspaceRoot, 'goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE), 'utf8'));
  assert.equal(goal.goalId, 'goal-1291');
  assert.equal(goal.state, 'READY');
  assert.equal(goal.route, 'WAITING_FOR_EXTERNAL_CONDITION');
  assert.equal(goal.holdDecision, 'WAIT_EXTERNAL_ACTIVE_MISSION');
  const schedulerGoals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: heldAt.toISOString(),
    goalRecords: [goal],
  });
  const scheduler = buildMissionScheduler({ now: heldAt.toISOString(), goals: schedulerGoals.goals });
  assert.equal(scheduler.selectedGoal, null);
  assert.equal(scheduler.programmeStatus, 'WAITING');
});

test('held critical phases publish a non-runnable goal without widening approval authority', async () => {
  const paths = await roots();
  const store = inMemoryMissionStore([{
    missionId: DEFAULT_CRITICAL_BACKLOG[0].mission.missionId,
    currentPhase: 'AWAITING_OPERATOR_APPROVAL',
  }]);
  const result = await ensureCriticalBacklogMission({ paths, now, ...store });
  assert.equal(result.ok, true);
  const goal = JSON.parse(await readFile(join(paths.workspaceRoot, 'goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE), 'utf8'));
  assert.equal(goal.route, 'WAITING_FOR_EXTERNAL_CONDITION');
  assert.equal(goal.approvalRequired, false);
  assert.equal(goal.mergeAuthority, false);
});

test('goal publication failure blocks the conveyor after safe status publication', async () => {
  const paths = await roots();
  const projection = {
    decision: 'CREATE_NEXT_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_MISSION_READY',
    selectedItem: DEFAULT_CRITICAL_BACKLOG[0],
    activeMission: null,
    completedItemIds: [],
    remainingItemIds: DEFAULT_CRITICAL_BACKLOG.map(({ itemId }) => itemId),
    exactNextAction: 'Create the first bounded mission.',
  };
  const writeJson = async (root, segments, record, options) => segments[0] === 'goals'
    ? { ok: false, reason: 'goal-write-blocked' }
    : writeAtomicJson(root, segments, record, options);
  const result = await publishCriticalBacklogProjection(projection, { paths, now, writeJson });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'goal-write-blocked');
  assert.equal(result.goalWrite.ok, false);
  const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'), 'utf8'));
  assert.equal(status.decision, 'CREATE_NEXT_MISSION');
});

test('goal identity transition neutralizes the old authority before a new goal write can fail', async () => {
  const paths = await roots();
  await publishCriticalBacklogProjection({
    decision: 'WAIT_ACTIVE_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
    selectedItem: DEFAULT_CRITICAL_BACKLOG[0],
    activeMission: { missionId: DEFAULT_CRITICAL_BACKLOG[0].mission.missionId, currentPhase: 'AGENT_IMPLEMENTATION' },
    completedItemIds: [],
    remainingItemIds: DEFAULT_CRITICAL_BACKLOG.map(({ itemId }) => itemId),
    exactNextAction: 'Continue the active mission.',
  }, { paths, now });
  const nextAt = new Date(now.getTime() + 60_000);
  const writeJson = async (root, segments, record, options) => segments[0] === 'goals' && record.goalId === 'goal-1507'
    ? { ok: false, reason: 'next-goal-write-blocked' }
    : writeAtomicJson(root, segments, record, options);
  const result = await publishCriticalBacklogProjection({
    decision: 'CREATE_NEXT_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_MISSION_READY',
    selectedItem: DEFAULT_CRITICAL_BACKLOG[1],
    activeMission: null,
    completedItemIds: [DEFAULT_CRITICAL_BACKLOG[0].itemId],
    remainingItemIds: DEFAULT_CRITICAL_BACKLOG.slice(1).map(({ itemId }) => itemId),
    exactNextAction: 'Create the next bounded mission.',
  }, { paths, now: nextAt, writeJson });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'next-goal-write-blocked');
  assert.equal(result.goalPreflightWrite.ok, true);
  const goal = JSON.parse(await readFile(join(paths.workspaceRoot, 'goals', CRITICAL_BACKLOG_CURRENT_GOAL_FILE), 'utf8'));
  assert.equal(goal.goalId, 'goal-1291');
  assert.equal(goal.route, 'WAITING_FOR_EXTERNAL_CONDITION');
  const schedulerGoals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: nextAt.toISOString(),
    goalRecords: [goal],
  });
  const scheduler = buildMissionScheduler({ now: nextAt.toISOString(), goals: schedulerGoals.goals });
  assert.equal(scheduler.selectedGoal, null);
});

test('invalid selected goal evidence fails closed before publishing authority records', async () => {
  const paths = await roots();
  const result = await publishCriticalBacklogProjection({
    decision: 'CREATE_NEXT_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_MISSION_READY',
    selectedItem: { itemId: 'incomplete-source-entry' },
  }, { paths, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SELECTED_CRITICAL_BACKLOG_GOAL_INVALID');
  assert.equal(result.statusWrite, null);
  assert.equal(result.goalWrite, null);
});
