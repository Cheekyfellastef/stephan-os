import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CRITICAL_BACKLOG } from './criticalBacklogConveyor.mjs';
import {
  GOAL_BUILDING_SELF_HOSTING_ITEM_ID,
  LEGACY_COMPLETED_RETIRED_ISSUE,
  LEGACY_COMPLETED_RETIRED_MISSION_ID,
  LEGACY_RECOVERY_NON_BLOCKING_ISSUE,
  LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  LEGACY_RECOVERY_SUCCESSOR_ISSUES,
  NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE,
  RETIRED_COMPLETED_LEGACY_ACCEPTANCE,
  SELF_HOSTING_CRITICAL_BACKLOG,
  SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES,
  projectSelfHostingCriticalMissionRecords,
} from './criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
  ensureCriticalBacklogMission,
  resolveCriticalBacklogRuntimePaths,
} from '../../stephanos-server/services/criticalBacklogConveyorService.js';

const NEXT_REAL_MISSION_ID = 'critical-1292-1293-dispatch-conveyor';
const NEXT_REAL_ITEM_ID = 'automated-dispatch-conveyor';

test('legacy #1291 and completed #1507 remain historical but cannot block production scheduling', () => {
  const legacy1291 = DEFAULT_CRITICAL_BACKLOG.find(
    (entry) => entry?.mission?.missionId === LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  );
  const legacy1507 = DEFAULT_CRITICAL_BACKLOG.find(
    (entry) => entry?.mission?.missionId === LEGACY_COMPLETED_RETIRED_MISSION_ID,
  );
  assert.ok(legacy1291, 'historical source backlog should retain #1291');
  assert.ok(legacy1507, 'historical source backlog should retain #1507');
  assert.equal(legacy1291.issueNumbers.includes(LEGACY_RECOVERY_NON_BLOCKING_ISSUE), true);
  assert.equal(legacy1507.issueNumbers.includes(LEGACY_COMPLETED_RETIRED_ISSUE), true);

  for (const missionId of [LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID, LEGACY_COMPLETED_RETIRED_MISSION_ID]) {
    assert.equal(
      SELF_HOSTING_CRITICAL_BACKLOG.some((entry) => entry?.mission?.missionId === missionId),
      false,
      `${missionId} must not consume the canonical goal-building track`,
    );
  }
  assert.equal(
    SELF_HOSTING_CRITICAL_BACKLOG.some((entry) => entry?.itemId === GOAL_BUILDING_SELF_HOSTING_ITEM_ID),
    true,
  );

  assert.equal(NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE.state, 'OPEN_NON_BLOCKING');
  assert.deepEqual(LEGACY_RECOVERY_SUCCESSOR_ISSUES, [1814, 1885, 1889, 1818]);
  assert.equal(RETIRED_COMPLETED_LEGACY_ACCEPTANCE.issueNumber, 1507);
  assert.equal(RETIRED_COMPLETED_LEGACY_ACCEPTANCE.state, 'CLOSED_RETIRED');
  assert.deepEqual(RETIRED_COMPLETED_LEGACY_ACCEPTANCE.successorIssueNumbers, [2158]);
  assert.deepEqual(SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES, [
    NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE,
    RETIRED_COMPLETED_LEGACY_ACCEPTANCE,
  ]);
});

test('production schedulable ordering advances directly to open #1292/#1293 work', () => {
  assert.equal(DEFAULT_CRITICAL_BACKLOG[0]?.mission?.missionId, LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID);
  assert.equal(DEFAULT_CRITICAL_BACKLOG[1]?.mission?.missionId, LEGACY_COMPLETED_RETIRED_MISSION_ID);
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG[0]?.mission?.missionId, NEXT_REAL_MISSION_ID);
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG[0]?.itemId, NEXT_REAL_ITEM_ID);
});

test('persisted #1291 and #1507 remain in history but are projected out of construction capacity', () => {
  const records = [
    { missionId: LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID, currentPhase: 'AGENT_IMPLEMENTATION' },
    { missionId: LEGACY_COMPLETED_RETIRED_MISSION_ID, currentPhase: 'CREATE_WORKTREE' },
    { missionId: 'unrelated-active-mission', currentPhase: 'CHECK_PULL_REQUEST' },
  ];
  const projection = projectSelfHostingCriticalMissionRecords(records);

  assert.deepEqual(
    projection.schedulableMissionRecords.map((record) => record.missionId),
    ['unrelated-active-mission'],
  );
  assert.deepEqual(projection.nonBlockingPersistedMissionIds, [
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  ]);
  assert.deepEqual(projection.nonBlockingMissionAcceptances, SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES);
  assert.equal(records[0].currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(records[1].currentPhase, 'CREATE_WORKTREE');
});

test('production conveyor ignores persisted legacy fossils and creates the first real open mission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'critical-legacy-nonblocking-'));
  const paths = resolveCriticalBacklogRuntimePaths({
    repoRoot: join(root, 'repo'),
    workspaceRoot: join(root, 'workspace'),
    worktreeRoot: join(root, 'worktrees'),
    orchestratorRoot: join(root, 'orchestrator'),
    snapshotRoot: join(root, 'snapshots'),
  });
  const records = [
    {
      missionId: LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
      currentPhase: 'AGENT_IMPLEMENTATION',
      revision: 17,
      dispatch: { status: 'idle' },
    },
    {
      missionId: LEGACY_COMPLETED_RETIRED_MISSION_ID,
      currentPhase: 'CREATE_WORKTREE',
      revision: 2,
      dispatch: { status: 'idle' },
    },
  ];
  const listMissions = async () => structuredClone(records);
  const createMission = async (mission) => {
    const state = {
      missionId: mission.missionId,
      currentPhase: 'CREATE_WORKTREE',
      git: { branch: mission.branch, worktreePath: mission.worktreePath },
    };
    records.push(state);
    return { state };
  };

  const result = await ensureCriticalBacklogMission({
    paths,
    now: new Date('2026-09-21T09:45:00.000Z'),
    testOnly: true,
    listMissions,
    createMission,
    readProgrammeProjection: async () => ({ status: 'HOLD', blockers: ['test-non-elastic-path'] }),
    dispatchActiveCriticalMission: async () => ({
      ok: true,
      classification: 'TEST_DISPATCH_SUPPRESSED',
      published: false,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.createdMission, true);
  assert.equal(result.projection.activeMission?.missionId, NEXT_REAL_MISSION_ID);
  assert.equal(result.projection.selectedItem?.itemId, NEXT_REAL_ITEM_ID);
  assert.deepEqual(result.projection.nonBlockingPersistedMissionIds, [
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  ]);
  assert.equal(records.some((record) => record.missionId === NEXT_REAL_MISSION_ID), true);
  assert.equal(records[0].currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(records[1].currentPhase, 'CREATE_WORKTREE');

  const status = JSON.parse(await readFile(
    join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'),
    'utf8',
  ));
  assert.equal(status.activeMissionId, NEXT_REAL_MISSION_ID);
  assert.deepEqual(status.nonBlockingPersistedMissionIds, [
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  ]);
});
