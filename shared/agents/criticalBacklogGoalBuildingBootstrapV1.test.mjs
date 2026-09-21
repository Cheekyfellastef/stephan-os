import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CRITICAL_BACKLOG } from './criticalBacklogConveyor.mjs';
import {
  GOAL_BUILDING_SELF_HOSTING_ITEM_ID,
  LEGACY_RECOVERY_NON_BLOCKING_ISSUE,
  LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  LEGACY_RECOVERY_SUCCESSOR_ISSUES,
  NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE,
  SELF_HOSTING_CRITICAL_BACKLOG,
  projectSelfHostingCriticalMissionRecords,
} from './criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
  ensureCriticalBacklogMission,
  resolveCriticalBacklogRuntimePaths,
} from '../../stephanos-server/services/criticalBacklogConveyorService.js';

test('legacy #1291 acceptance stays visible but cannot block the production self-hosting backlog', () => {
  const legacy = DEFAULT_CRITICAL_BACKLOG.find(
    (entry) => entry?.mission?.missionId === LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  );
  assert.ok(legacy, 'historical source backlog should retain the #1291 recovery record');
  assert.equal(legacy.issueNumbers.includes(LEGACY_RECOVERY_NON_BLOCKING_ISSUE), true);

  assert.equal(
    SELF_HOSTING_CRITICAL_BACKLOG.some(
      (entry) => entry?.mission?.missionId === LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    ),
    false,
    '#1291 must not consume the canonical goal-building track',
  );
  assert.equal(
    SELF_HOSTING_CRITICAL_BACKLOG.some((entry) => entry?.itemId === GOAL_BUILDING_SELF_HOSTING_ITEM_ID),
    true,
    'goal-building self-hosting work must remain schedulable',
  );

  assert.equal(NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE.issueNumber, 1291);
  assert.equal(NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE.state, 'OPEN_NON_BLOCKING');
  assert.deepEqual(LEGACY_RECOVERY_SUCCESSOR_ISSUES, [1814, 1885, 1889, 1818]);
  assert.deepEqual(
    NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE.successorIssueNumbers,
    LEGACY_RECOVERY_SUCCESSOR_ISSUES,
  );
});

test('legacy source ordering stays historical while schedulable ordering advances past #1291', () => {
  assert.equal(DEFAULT_CRITICAL_BACKLOG[0]?.mission?.missionId, LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID);
  assert.equal(SELF_HOSTING_CRITICAL_BACKLOG[0]?.mission?.missionId, 'critical-1507-post-sync-runtime-refresh');
  assert.notEqual(
    SELF_HOSTING_CRITICAL_BACKLOG[0]?.mission?.missionId,
    DEFAULT_CRITICAL_BACKLOG[0]?.mission?.missionId,
    'production scheduling must not inherit the historical #1291 first-item handbrake',
  );
});

test('persisted #1291 mission remains in history but is projected out of construction capacity', () => {
  const records = [
    { missionId: LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID, currentPhase: 'AGENT_IMPLEMENTATION' },
    { missionId: 'unrelated-active-mission', currentPhase: 'CHECK_PULL_REQUEST' },
  ];
  const projection = projectSelfHostingCriticalMissionRecords(records);

  assert.deepEqual(
    projection.schedulableMissionRecords.map((record) => record.missionId),
    ['unrelated-active-mission'],
  );
  assert.deepEqual(projection.nonBlockingPersistedMissionIds, [LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID]);
  assert.deepEqual(projection.nonBlockingMissionAcceptances, [NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE]);
  assert.equal(records[0].currentPhase, 'AGENT_IMPLEMENTATION', 'raw persisted history must not be rewritten');
});

test('production service ignores persisted #1291 as a construction blocker and publishes canonical non-blocking truth', async () => {
  const root = await mkdtemp(join(tmpdir(), 'critical-1291-nonblocking-'));
  const paths = resolveCriticalBacklogRuntimePaths({
    repoRoot: join(root, 'repo'),
    workspaceRoot: join(root, 'workspace'),
    worktreeRoot: join(root, 'worktrees'),
    orchestratorRoot: join(root, 'orchestrator'),
    snapshotRoot: join(root, 'snapshots'),
  });
  const persisted1291 = {
    missionId: LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    currentPhase: 'AGENT_IMPLEMENTATION',
    revision: 17,
    dispatch: { status: 'idle' },
  };
  const records = [structuredClone(persisted1291)];
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
    now: new Date('2026-09-21T04:30:00.000Z'),
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
  assert.notEqual(result.classification, 'WAIT_EXTERNAL_ACTIVE_MISSION');
  assert.equal(result.projection.activeMission?.missionId, 'critical-1507-post-sync-runtime-refresh');
  assert.equal(result.projection.selectedItem?.itemId, 'post-sync-runtime-refresh');
  assert.deepEqual(result.projection.nonBlockingPersistedMissionIds, [LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID]);
  assert.equal(result.projection.nonBlockingMissionAcceptances[0].issueNumber, 1291);
  assert.equal(result.projection.nonBlockingMissionAcceptances[0].state, 'OPEN_NON_BLOCKING');
  assert.deepEqual(
    result.projection.nonBlockingMissionAcceptances[0].successorIssueNumbers,
    LEGACY_RECOVERY_SUCCESSOR_ISSUES,
  );
  assert.equal(
    records.some((record) => record.missionId === LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID
      && record.currentPhase === 'AGENT_IMPLEMENTATION'),
    true,
    'persisted #1291 record must remain untouched',
  );

  const status = JSON.parse(await readFile(
    join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'),
    'utf8',
  ));
  assert.equal(status.activeMissionId, 'critical-1507-post-sync-runtime-refresh');
  assert.deepEqual(status.nonBlockingPersistedMissionIds, [LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID]);
  assert.equal(status.nonBlockingMissionAcceptances[0].issueNumber, 1291);
  assert.equal(status.nonBlockingMissionAcceptances[0].state, 'OPEN_NON_BLOCKING');
  assert.deepEqual(status.nonBlockingMissionAcceptances[0].successorIssueNumbers, LEGACY_RECOVERY_SUCCESSOR_ISSUES);
});
