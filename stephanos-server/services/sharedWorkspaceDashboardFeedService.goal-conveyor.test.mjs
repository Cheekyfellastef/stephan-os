import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, unlink } from 'node:fs/promises';
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

  await writeJson(root, 'status', 'autonomy-build-track-current.json', {
    ...createSharedWorkspaceStatusRecord({ statusId: 'autonomy-build-track-current', participantId: 'mission-scheduler',
      timestampUtc: NOW, status: 'WAITING', summary: 'Canonical cycle is waiting for a claim.' }),
    autonomyTrack: { schemaVersion: 'stephanos.autonomy-build-track.v1', timestampUtc: NOW,
      sourceHead: '', missionId: 'mission-2002', issueNumber: 2002,
      currentGate: 'CLAIM', currentState: 'WAITING', gates: [{ id: 'CLAIM', state: 'WAITING' }] },
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
  assert.equal(payload.projection.goalBuildConveyorOverview.schemaVersion, 'stephanos.goal-build-conveyor-overview.v1');
  assert.equal(payload.projection.goalBuildConveyorOverview.trace.observedAtUtc, NOW);
  assert.equal(payload.projection.goalBuildConveyorOverview.trace.sourceBinding, 'SOURCE_HEAD_MISSING');
  assert.equal(payload.projection.goalBuildConveyorOverview.stages.find(stage => stage.id === 'claim').operational.label, 'Waiting here');
  assert.equal(payload.projection.goalBuildConveyorOverview.buildingGoalCount, 1);
  assert.equal(payload.projection.goalBuildConveyorOverview.workers[0].id, 'openclaw-local');
  assert.equal(payload.projection.goalBuildConveyorOverview.stages.find(stage => stage.id === 'merge').state, 'UNKNOWN');
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


test('stale Sovereign build truth cannot render a goal as picked up or building', async () => {
  const root = await tempDir('goal-conveyor-stale-workspace-');
  const repoRoot = await tempDir('goal-conveyor-stale-repo-');
  const home = await tempDir('goal-conveyor-stale-home-');
  for (const directory of ['goals', 'status', 'proof', 'capabilities', 'events']) {
    await mkdir(join(root, directory), { recursive: true });
  }

  const staleAt = '2026-10-06T15:50:00.000Z';
  await writeJson(root, 'goals', 'goal-2002.json', createSharedWorkspaceGoalRecord({
    goalId: 'goal-2002',
    participantId: 'mission-scheduler',
    timestampUtc: NOW,
    relatedIssue: '#2002',
    title: 'Stephanos Goal Building Agent',
    status: 'ACTIVE',
  }));
  await writeJson(root, 'status', 'stephanos-build-truth-current.json', {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'stephanos-build-truth-current',
      participantId: 'sovereign-commander',
      timestampUtc: staleAt,
      relatedIssue: '#2002',
      status: 'BUILDING',
      summary: 'This build truth is deliberately stale.',
    }),
    stephanosBuildTruth: {
      schemaVersion: 'stephanos.sovereign-build-truth.v1',
      observedAtUtc: staleAt,
      state: 'BUILDING',
      trafficLight: 'GREEN',
      autonomous: true,
      goals: [{
        issue: '#2002',
        title: 'Stephanos Goal Building Agent',
        state: 'BUILDING',
        builder: 'openclaw-local',
        selectedForAdmission: true,
        proofRefs: ['proof/stale-build-2002'],
      }],
    },
  });

  const payload = await readBackendSharedWorkspaceDashboardFeed({
    env: { HOME: home, USERPROFILE: home, PATH: '', STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot,
    nowMs: Date.parse(NOW),
    staleAfterMs: 60_000,
    liveProjection: null,
  });

  const goal = payload.projection.goals.find((item) => item.issue === '#2002');
  assert.equal(payload.stephanosBuildTruthStatus.truth, 'STALE');
  assert.equal(goal.buildTruthTruth, 'STALE');
  assert.equal(goal.buildState, 'STALE');
  assert.equal(goal.builder, '');
  assert.notEqual(goal.buildJourney.stages.find((stage) => stage.id === 'DISPATCHED').trafficLight, 'GREEN');
  assert.notEqual(goal.buildJourney.stages.find((stage) => stage.id === 'PICKED_UP').trafficLight, 'GREEN');
  assert.notEqual(goal.buildJourney.stages.find((stage) => stage.id === 'BUILDING').trafficLight, 'GREEN');
  assert.equal(payload.projection.goalBuildConveyor.buildingCount, 0);
});


test('freshness diagnostics follow fresh, stale, fresh and absent evidence without inventing progress', async () => {
  const root=await tempDir('goal-conveyor-diagnostic-');
  const repoRoot=await tempDir('goal-conveyor-diagnostic-repo-');
  const home=await tempDir('goal-conveyor-diagnostic-home-');
  for(const directory of ['goals','status','proof','capabilities','events']) await mkdir(join(root,directory),{recursive:true});
  await writeJson(root,'goals','goal-2002.json',{...createSharedWorkspaceGoalRecord({
    goalId:'goal-2002',participantId:'mission-scheduler',timestampUtc:NOW,relatedIssue:'#2002',
    title:'Diagnostic fixture goal',status:'READY'
  }),nextAction:'Preserve this real goal action.'});
  async function publish(at){
    await writeJson(root,'status','stephanos-build-truth-current.json',{
      ...createSharedWorkspaceStatusRecord({statusId:'stephanos-build-truth-current',participantId:'sovereign-commander',
        timestampUtc:at,relatedIssue:'#2002',status:'BUILDING',summary:'Fixture build activity'}),
      stephanosBuildTruth:{schemaVersion:'stephanos.sovereign-build-truth.v1',observedAtUtc:at,
        state:'BUILDING',trafficLight:'GREEN',goals:[{issue:'#2002',state:'BUILDING',builder:'fixture-worker',
          selectedForAdmission:true,blocker:'',nextAction:'Continue this actual worker action.',proofRefs:['proof/fixture-build']}]}});
  }
  const options={env:{HOME:home,USERPROFILE:home,PATH:'',STEPHANOS_SHARED_AGENT_WORKSPACE:root},
    repoRoot,nowMs:Date.parse(NOW),staleAfterMs:60000,liveProjection:null};
  const readGoal=async()=> (await readBackendSharedWorkspaceDashboardFeed(options)).projection.goals.find(g=>g.issue==='#2002');
  await publish(NOW);
  const fresh=await readGoal();
  assert.equal(fresh.buildEvidenceDiagnostic,'');
  assert.equal(fresh.buildNextAction,'Continue this actual worker action.');
  await publish('2026-10-06T15:50:00.000Z');
  const stale=await readGoal();
  assert.match(stale.buildEvidenceDiagnostic,/evidence is stale/);
  assert.equal(stale.state,'READY');assert.equal(stale.builder,'');assert.equal(stale.selectedForAdmission,false);
  assert.equal(stale.exactNextAction,'Preserve this real goal action.');assert.deepEqual(stale.blockers,[]);
  assert.equal(stale.buildJourney.provenStageCount,2);
  for(const id of ['SELECTED','DISPATCHED','PICKED_UP','BUILDING','COMPLETED'])
    assert.notEqual(stale.buildJourney.stages.find(s=>s.id===id).trafficLight,'GREEN');
  await publish(NOW);
  const refreshed=await readGoal();
  assert.equal(refreshed.buildEvidenceDiagnostic,'');assert.deepEqual(refreshed.buildJourney,fresh.buildJourney);
  await unlink(join(root,'status','stephanos-build-truth-current.json'));
  const absent=await readGoal();
  assert.match(absent.buildEvidenceDiagnostic,/evidence is unavailable/);
  assert.equal(absent.exactNextAction,'Preserve this real goal action.');assert.deepEqual(absent.blockers,[]);
  assert.equal(absent.builder,'');assert.equal(absent.buildJourney.provenStageCount,2);
  assert.notEqual(absent.buildJourney.stages.find(s=>s.id==='PICKED_UP').trafficLight,'GREEN');
  assert.notEqual(absent.buildJourney.stages.find(s=>s.id==='COMPLETED').trafficLight,'GREEN');
});
