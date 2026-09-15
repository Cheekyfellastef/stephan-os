import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureCriticalBacklogMission } from './criticalBacklogConveyorService.js';

const CURRENT_MAIN = 'a'.repeat(40);
const STALE_WORKER_HEAD = 'b'.repeat(40);
const NOW = new Date('2026-09-15T22:30:00.000Z');

const mission = Object.freeze({
  missionId: 'critical-1622-elastic-goal',
  currentPhase: 'AGENT_IMPLEMENTATION',
  repository: 'Cheekyfellastef/stephan-os',
  allowedFiles: ['stephanos-server/services/criticalBacklogConveyorServiceCore.js'],
  git: { branch: 'openclaw/elastic-goal-1622', worktreePath: '/bounded/critical-1622-elastic-goal' },
});

const paths = Object.freeze({
  repoRoot: '/repo',
  workspaceRoot: '/workspace',
  worktreeRoot: '/worktrees',
  orchestratorRoot: '/orchestrator',
  snapshotRoot: '/snapshots',
});

test('stale worker HOLD admits canonical main but keeps worker dispatch fail closed', async () => {
  let admissionCount = 0;
  let capacityReadCount = 0;
  let dispatchCount = 0;
  const result = await ensureCriticalBacklogMission({
    now: NOW,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: STALE_WORKER_HEAD },
    paths,
    readProgrammeProjection: async () => ({
      status: 'HOLD',
      blockers: ['worker-heartbeat-invalid-or-missing'],
      machineryInventory: { sourceHead: CURRENT_MAIN },
      scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
    }),
    ensureElasticMissions: async () => {
      admissionCount += 1;
      return {
        ok: true,
        createdMissionCount: 0,
        desiredWidth: 1,
        selectedMission: mission,
        elasticMissions: [mission],
        activeMissions: [],
        runnableMissions: [mission],
      };
    },
    readCapacityRouting: async () => {
      capacityReadCount += 1;
      return { providerNeutralCapacity: 'fresh' };
    },
    dispatchElasticBuilds: async () => {
      dispatchCount += 1;
      return { ok: true, dispatchCount: 1, dispatched: [{ missionId: mission.missionId }] };
    },
    dispatchActiveCriticalMission: async () => ({ ok: true, classification: 'CRITICAL_ACTIVE_MISSION_DISPATCH_NOT_REQUIRED' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_GOAL_MISSION_SELECTED');
  assert.equal(result.programmeStatus, 'HOLD');
  assert.equal(result.workerRuntimeHold, true);
  assert.deepEqual(result.programmeBlockers, ['worker-heartbeat-invalid-or-missing']);
  assert.equal(admissionCount, 1);
  assert.equal(capacityReadCount, 0);
  assert.equal(dispatchCount, 0);
  assert.equal(result.elasticIgnition.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD');
  assert.equal(result.elasticIgnition.sourceRevision, CURRENT_MAIN);
  assert.equal(result.elasticIgnition.dispatchCount, 0);
  assert.deepEqual(result.elasticIgnition.dispatched, []);
  assert.deepEqual(result.elasticIgnition.held, [{
    missionId: mission.missionId,
    reason: 'MISSION_WORKER_RUNTIME_NOT_READY',
  }]);
  assert.deepEqual(result.elasticIgnition.runtimeBlockers, ['worker-heartbeat-invalid-or-missing']);
  assert.equal(result.elasticIgnition.runtimeMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('non-worker programme HOLD cannot enter elastic source admission', async () => {
  let admissionCount = 0;
  let dispatchCount = 0;
  const result = await ensureCriticalBacklogMission({
    backlog: [],
    now: NOW,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: STALE_WORKER_HEAD },
    paths,
    readProgrammeProjection: async () => ({
      status: 'HOLD',
      blockers: ['controller-heartbeat-stale'],
      machineryInventory: { sourceHead: CURRENT_MAIN },
      scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
    }),
    ensureElasticMissions: async () => {
      admissionCount += 1;
      return { ok: true, selectedMission: mission };
    },
    dispatchElasticBuilds: async () => {
      dispatchCount += 1;
      return { ok: true, dispatchCount: 1 };
    },
    listMissions: async () => [],
    publishProjection: async () => ({ ok: true }),
  });

  assert.equal(admissionCount, 0);
  assert.equal(dispatchCount, 0);
  assert.equal(result.ok, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});
