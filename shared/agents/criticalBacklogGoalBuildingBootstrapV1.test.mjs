import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CRITICAL_BACKLOG, buildCriticalBacklogProjection } from './criticalBacklogConveyor.mjs';
import {
  GOAL_BUILDING_SELF_HOSTING_ITEM_ID,
  COMPLETED_DISPATCH_CONVEYOR_ACCEPTANCE,
  COMPLETED_DISPATCH_CONVEYOR_ACCEPTANCES,
  COMPLETED_DISPATCH_CONVEYOR_ISSUES,
  COMPLETED_DISPATCH_CONVEYOR_MISSION_ID,
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

const NEXT_REAL_MISSION_ID = 'critical-1418-universal-chat-bootstrap';
const NEXT_REAL_ITEM_ID = 'universal-chat-bootstrap';

test('legacy acceptance remains historical and excludes completed work from new mission creation', () => {
  const legacy1291 = DEFAULT_CRITICAL_BACKLOG.find(
    (entry) => entry?.mission?.missionId === LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  );
  const legacy1507 = DEFAULT_CRITICAL_BACKLOG.find(
    (entry) => entry?.mission?.missionId === LEGACY_COMPLETED_RETIRED_MISSION_ID,
  );
  const completedDispatch = DEFAULT_CRITICAL_BACKLOG.find(
    (entry) => entry?.mission?.missionId === COMPLETED_DISPATCH_CONVEYOR_MISSION_ID,
  );
  assert.ok(legacy1291, 'historical source backlog should retain #1291');
  assert.ok(legacy1507, 'historical source backlog should retain #1507');
  assert.ok(completedDispatch, 'historical source backlog should retain #1292/#1293');
  assert.equal(legacy1291.issueNumbers.includes(LEGACY_RECOVERY_NON_BLOCKING_ISSUE), true);
  assert.equal(legacy1507.issueNumbers.includes(LEGACY_COMPLETED_RETIRED_ISSUE), true);
  assert.deepEqual(completedDispatch.issueNumbers, COMPLETED_DISPATCH_CONVEYOR_ISSUES);

  for (const missionId of [LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID, LEGACY_COMPLETED_RETIRED_MISSION_ID, COMPLETED_DISPATCH_CONVEYOR_MISSION_ID]) {
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
  assert.equal(COMPLETED_DISPATCH_CONVEYOR_ACCEPTANCE.issueNumber, 1292);
  assert.equal(COMPLETED_DISPATCH_CONVEYOR_ACCEPTANCE.state, 'CLOSED_RETIRED');
  assert.deepEqual(COMPLETED_DISPATCH_CONVEYOR_ACCEPTANCE.successorIssueNumbers, []);
  assert.deepEqual(COMPLETED_DISPATCH_CONVEYOR_ACCEPTANCES.map(({ issueNumber }) => issueNumber), [1292, 1293]);
  assert.deepEqual(SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES, [
    NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE,
    RETIRED_COMPLETED_LEGACY_ACCEPTANCE,
    ...COMPLETED_DISPATCH_CONVEYOR_ACCEPTANCES,
  ]);
});

test('production schedulable ordering advances past completed #1292/#1293 to #1418', () => {
  assert.equal(DEFAULT_CRITICAL_BACKLOG[0]?.mission?.missionId, LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID);
  assert.equal(DEFAULT_CRITICAL_BACKLOG[1]?.mission?.missionId, LEGACY_COMPLETED_RETIRED_MISSION_ID);
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG[0]?.mission?.missionId, NEXT_REAL_MISSION_ID);
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG[0]?.itemId, NEXT_REAL_ITEM_ID);
});

test('persisted #1292/#1293 records remain visible to canonical capacity gates', () => {
  const records = [
    { missionId: LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID, currentPhase: 'AGENT_IMPLEMENTATION' },
    { missionId: LEGACY_COMPLETED_RETIRED_MISSION_ID, currentPhase: 'CREATE_WORKTREE' },
    { missionId: COMPLETED_DISPATCH_CONVEYOR_MISSION_ID, currentPhase: 'BLOCKED' },
    { missionId: 'unrelated-active-mission', currentPhase: 'CHECK_PULL_REQUEST' },
  ];
  const projection = projectSelfHostingCriticalMissionRecords(records);

  assert.deepEqual(
    projection.schedulableMissionRecords.map((record) => record.missionId),
    [COMPLETED_DISPATCH_CONVEYOR_MISSION_ID, 'unrelated-active-mission'],
  );
  assert.deepEqual(projection.nonBlockingPersistedMissionIds, [
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
  ]);
  assert.deepEqual(projection.nonBlockingMissionAcceptances, SELF_HOSTING_NON_BLOCKING_MISSION_ACCEPTANCES);
  assert.equal(records[0].currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(records[1].currentPhase, 'CREATE_WORKTREE');
  assert.equal(projection.schedulableMissionRecords[0], records[2]);
});

test('completed dispatch acceptance does not replace terminal or proof-parking release gates', async (t) => {
  const cases = [
    { currentPhase: 'AGENT_IMPLEMENTATION', decision: 'WAIT_EXTERNAL_ACTIVE_MISSION' },
    { currentPhase: 'CREATE_WORKTREE', decision: 'WAIT_EXTERNAL_ACTIVE_MISSION' },
    { currentPhase: 'BLOCKED', decision: 'WAIT_EXTERNAL_ACTIVE_MISSION' },
    { currentPhase: 'UNKNOWN', decision: 'WAIT_EXTERNAL_ACTIVE_MISSION' },
    { decision: 'WAIT_EXTERNAL_ACTIVE_MISSION' },
    { currentPhase: 'BLOCKED', continuity: { parkingStatus: 'ACTIVE' }, decision: 'WAIT_EXTERNAL_ACTIVE_MISSION' },
    { currentPhase: 'BLOCKED', continuity: { parkingStatus: 'PARKED_BLOCKED' }, decision: 'CREATE_NEXT_MISSION' },
    { currentPhase: 'BLOCKED', continuity: { parkingStatus: 'REENTRY_READY' }, decision: 'CREATE_NEXT_MISSION' },
    { currentPhase: 'COMPLETE', decision: 'CREATE_NEXT_MISSION' },
    { currentPhase: 'CANCELLED', decision: 'CREATE_NEXT_MISSION' },
  ];
  for (const { decision, ...state } of cases) {
    await t.test(`${state.currentPhase || 'missing phase'}:${state.continuity?.parkingStatus || 'no parking'}`, () => {
      const record = { missionId: COMPLETED_DISPATCH_CONVEYOR_MISSION_ID, ...state };
      const policy = projectSelfHostingCriticalMissionRecords([record]);
      assert.equal(policy.schedulableMissionRecords[0], record);
      assert.deepEqual(policy.nonBlockingPersistedMissionIds, []);
      const projection = buildCriticalBacklogProjection({
        backlog: SELF_HOSTING_CRITICAL_BACKLOG,
        missionRecords: policy.schedulableMissionRecords,
      });
      assert.equal(projection.decision, decision);
      if (decision === 'WAIT_EXTERNAL_ACTIVE_MISSION') {
        assert.equal(projection.activeMission, record);
        assert.equal(projection.selectedItem, null);
      } else {
        assert.equal(projection.selectedItem.mission.missionId, NEXT_REAL_MISSION_ID);
      }
    });
  }
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
    {
      missionId: COMPLETED_DISPATCH_CONVEYOR_MISSION_ID,
      currentPhase: 'COMPLETE',
      revision: 22,
      dispatch: { status: 'failed' },
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
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
  ]);
  assert.equal(records.some((record) => record.missionId === NEXT_REAL_MISSION_ID), true);
  assert.equal(records[0].currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(records[1].currentPhase, 'CREATE_WORKTREE');
  assert.equal(records[2].currentPhase, 'COMPLETE');

  const status = JSON.parse(await readFile(
    join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'),
    'utf8',
  ));
  assert.equal(status.activeMissionId, NEXT_REAL_MISSION_ID);
  assert.deepEqual(status.nonBlockingPersistedMissionIds, [
    LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    LEGACY_COMPLETED_RETIRED_MISSION_ID,
  ]);
  assert.deepEqual(status.nonBlockingMissionAcceptances
    .filter(({ missionId }) => missionId === COMPLETED_DISPATCH_CONVEYOR_MISSION_ID)
    .map(({ issueNumber }) => issueNumber), [1292, 1293]);
});
