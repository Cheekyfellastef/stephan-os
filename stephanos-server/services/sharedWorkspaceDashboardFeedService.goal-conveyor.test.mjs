import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readBackendSharedWorkspaceDashboardFeed } from './sharedWorkspaceDashboardFeedService.js';
import {
  createSharedWorkspaceGoalRecord,
  createSharedWorkspaceStatusRecord,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';

const NOW = '2026-10-06T16:00:00.000Z';

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeJson(root, directory, name, record) {
  await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, directory, name), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

test('dashboard backend projects each goal build journey without borrowing another goal track', async () => {
  const root = await tempDir('goal-conveyor-workspace-');
  const repoRoot = await tempDir('goal-conveyor-repo-');
  const home = await tempDir('goal-conveyor-home-');
  for (const directory of ['goals', 'status', 'proof', 'capabilities', 'events']) {
    await mkdir(join(root, directory), { recursive: true });
  }

  await writeJson(root, 'goals', 'goal-2002.json', createSharedWorkspaceGoalRecord({
    goalId: 'goal-2002',
    participantId: 'mission-scheduler',
    timestampUtc: NOW,
    relatedIssue: '#2002',
    title: 'Stephanos Goal Building Agent',
    status: 'ACTIVE',
    summary: 'Goal is actively building.',
    nextAction: 'Continue through the current builder.',
  }));

  await writeJson(root, 'goals', 'goal-2003.json', createSharedWorkspaceGoalRecord({
    goalId: 'goal-2003',
    participantId: 'mission-scheduler',
    timestampUtc: NOW,
    relatedIssue: '#2003',
    title: 'Queued second goal',
    status: 'READY',
    summary: 'Goal is ready but has no builder pickup proof yet.',
    nextAction: 'Wait for exact builder pickup evidence.',
  }));

  await writeJson(root, 'status', 'stephanos-build-truth-current.json', {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'stephanos-build-truth-current',
      participantId: 'sovereign-commander',
      timestampUtc: NOW,
      relatedIssue: '#2002',
      status: 'BUILDING',
      summary: 'Stephanos build truth is current.',
    }),
    stephanosBuildTruth: {
      schemaVersion: 'stephanos.sovereign-build-truth.v1',
      observedAtUtc: NOW,
      state: 'BUILDING',
      trafficLight: 'GREEN',
      autonomous: true,
      activeGoalCount: 2,
      buildingGoalCount: 1,
      activeMaterialLaneCount: 1,
      targetMaterialLaneCount: 15,
      lastMaterialProgressAtUtc: NOW,
      blockers: [],
      nextAction: 'Continue autonomous building.',
      goals: [
        {
          issue: '#2002',
          title: 'Stephanos Goal Building Agent',
          state: 'BUILDING',
          controllerId: 'controller-1',
          controllerTitle: 'Stephanos Autonomous Goal Builder',
          logicalLaneId: 'logical-goal-2002',
          builder: 'openclaw-local',
          currentPhase: 'SOURCE_CONSTRUCTION',
          lastMaterialProgressAtUtc: NOW,
          proofRefs: ['proof/build-2002'],
          blocker: '',
          nextAction: 'Continue source construction.',
          autonomous: true,
          selectedForAdmission: true,
        },
        {
          issue: '#2003',
          title: 'Queued second goal',
          state: 'QUEUED',
          controllerId: 'controller-2',
          controllerTitle: 'Stephanos Queue Controller',
          logicalLaneId: 'logical-goal-2003',
          builder: '',
          currentPhase: 'WAITING_FOR_CAPACITY',
          lastMaterialProgressAtUtc: '',
          proofRefs: [],
          blocker: '',
          nextAction: 'Wait for proven builder capacity.',
          autonomous: false,
          selectedForAdmission: false,
        },
      ],
    },
  });

  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: {
      HOME: home,
      USERPROFILE: home,
      PATH: '',
      STEPHANOS_SHARED_AGENT_WORKSPACE: root,
    },
    repoRoot,
    nowMs: Date.parse(NOW),
    staleAfterMs: 60_000,
    liveProjection: null,
  });

  const building = payload.projection.goals.find((goal) => goal.issue === '#2002');
  const queued = payload.projection.goals.find((goal) => goal.issue === '#2003');

  assert.equal(payload.stephanosBuildTruthStatus.truth, 'CURRENT');
  assert.equal(payload.projection.stephanosBuildTruth.state, 'BUILDING');
  assert.equal(payload.projection.stephanosBuildTruth.goals.length, 2);
  assert.equal(building.buildJourney.schemaVersion, 'stephanos.goal-build-conveyor.v1');
  assert.equal(building.buildJourney.builder, 'openclaw-local');
  assert.equal(building.buildJourney.stages.find((stage) => stage.id === 'PICKED_UP').trafficLight, 'GREEN');
  assert.equal(building.buildJourney.stages.find((stage) => stage.id === 'BUILDING').trafficLight, 'GREEN');
  assert.equal(building.buildJourney.stages.find((stage) => stage.id === 'COMPLETED').trafficLight, 'GREY');

  assert.equal(queued.buildJourney.exactAutonomyTrackBound, false);
  assert.equal(queued.buildJourney.stages.find((stage) => stage.id === 'PICKED_UP').trafficLight, 'GREY');
  assert.equal(queued.buildJourney.stages.find((stage) => stage.id === 'BUILDING').trafficLight, 'GREY');

  assert.equal(payload.projection.goalBuildConveyor.visibleGoalCount, 2);
  assert.equal(payload.projection.goalBuildConveyor.provenToBuilderCount, 1);
  assert.equal(payload.projection.goalBuildConveyor.buildingCount, 1);
  assert.equal(payload.projection.goalBuildConveyor.completedCount, 0);
  assert.match(payload.projection.goalBuildConveyor.truthBoundary, /read-only projection/i);
});
