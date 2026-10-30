import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchElasticGoalBuilds } from './criticalBacklogConveyorServiceCore.js';

const now = new Date('2026-09-12T17:30:00.000Z');
const paths = Object.freeze({
  repoRoot: '/repo',
  workspaceRoot: '/workspace',
  orchestratorRoot: '/orchestrator',
  snapshotRoot: '/snapshots',
});

function elasticImplementationMission(issueNumber) {
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

function capacityFor(mission) {
  return [{
    route: 'FOUNDRY_FORGE',
    adapter: 'foundry-forge',
    workerId: `forge-worker-${mission.missionId}`,
    receiptId: `capacity-${mission.missionId}`,
    proofRefs: [`proof-${mission.missionId}`],
  }];
}

test('scheduler-selected runnable mission consumes real provider capacity instead of a phantom reserved slot', async () => {
  const selected = elasticImplementationMission(2002);
  const other = elasticImplementationMission(2003);
  const capacityLookups = [];
  const publications = [];

  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1,
    selectedMission: selected,
    activeMissions: [],
    runnableMissions: [other, selected],
  }, {
    now,
    paths,
    sourceRevision: 'a'.repeat(40),
    resolveCapacityCandidates: (mission) => {
      capacityLookups.push(mission.missionId);
      return capacityFor(mission);
    },
    publishWorkerAction: async ({ actionGrant }) => {
      publications.push(actionGrant);
      return { published: true, actionGrantAccepted: true, reason: 'published' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.availableSlots, 1);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.dispatched[0].missionId, selected.missionId);
  assert.equal(result.dispatched[0].adapter, 'foundry-forge');
  assert.deepEqual(capacityLookups, [selected.missionId]);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].missionId, selected.missionId);
  assert.equal(publications[0].workerId, `forge-worker-${selected.missionId}`);
  assert.equal(publications[0].mergeAuthority, false);
  assert.equal(publications[0].leaseSeizureAllowed, false);
  assert.deepEqual(result.held, []);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('already-running selected mission is never offered to a second provider writer', async () => {
  const selected = elasticImplementationMission(2004);
  let capacityLookups = 0;
  let publications = 0;

  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1,
    selectedMission: selected,
    activeMissions: [{
      ...selected,
      dispatch: {
        status: 'running',
        adapter: 'foundry-forge',
        workerId: 'existing-worker',
        capacityReceiptId: 'existing-capacity',
      },
    }],
    runnableMissions: [selected],
  }, {
    now,
    paths,
    sourceRevision: 'b'.repeat(40),
    resolveCapacityCandidates: () => {
      capacityLookups += 1;
      return capacityFor(selected);
    },
    publishWorkerAction: async () => {
      publications += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_NOT_REQUIRED');
  assert.equal(result.availableSlots, 0);
  assert.equal(result.dispatchCount, 0);
  assert.deepEqual(result.dispatched, []);
  assert.deepEqual(result.held, []);
  assert.equal(capacityLookups, 0);
  assert.equal(publications, 0);
  assert.equal(result.resourceDisjointOneWriterProven, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});
