import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogConveyor.mjs';
import {
  GOAL_BUILDING_SELF_HOSTING_MISSION_ID,
  SELF_HOSTING_CRITICAL_BACKLOG,
} from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
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
});

test('completed legacy backlog creates Goal Building Agent self-hosting mission instead of idling', async () => {
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG.length, DEFAULT_CRITICAL_BACKLOG.length + 1);
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
