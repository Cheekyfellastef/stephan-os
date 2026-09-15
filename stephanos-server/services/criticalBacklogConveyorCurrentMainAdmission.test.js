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

test('elastic ignition admits authoritative canonical main even when physical worker env still names the prior head', async () => {
  let observedSourceRevision = '';
  let observedCapacityRevision = '';
  const result = await ensureCriticalBacklogMission({
    now: NOW,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: STALE_WORKER_HEAD },
    paths: {
      repoRoot: '/repo',
      workspaceRoot: '/workspace',
      worktreeRoot: '/worktrees',
      orchestratorRoot: '/orchestrator',
      snapshotRoot: '/snapshots',
    },
    readProgrammeProjection: async () => ({
      status: 'READY',
      machineryInventory: { sourceHead: CURRENT_MAIN },
      scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } },
    }),
    ensureElasticMissions: async () => ({
      ok: true,
      createdMissionCount: 0,
      desiredWidth: 1,
      selectedMission: mission,
      elasticMissions: [mission],
      activeMissions: [],
      runnableMissions: [mission],
    }),
    readCapacityRouting: async ({ sourceRevision }) => {
      observedCapacityRevision = sourceRevision;
      return { providerNeutralCapacity: 'fresh' };
    },
    dispatchElasticBuilds: async (_admission, { sourceRevision }) => {
      observedSourceRevision = sourceRevision;
      return { ok: true, dispatchCount: 1, dispatched: [{ missionId: mission.missionId }] };
    },
    dispatchActiveCriticalMission: async () => ({ ok: true, classification: 'CRITICAL_ACTIVE_MISSION_DISPATCH_NOT_REQUIRED' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_GOAL_MISSION_SELECTED');
  assert.equal(observedCapacityRevision, CURRENT_MAIN);
  assert.equal(observedSourceRevision, CURRENT_MAIN);
  assert.notEqual(observedSourceRevision, STALE_WORKER_HEAD);
});
