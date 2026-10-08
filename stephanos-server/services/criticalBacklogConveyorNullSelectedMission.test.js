import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogConveyor.mjs';
import { ensureCriticalBacklogMission as runCore } from './criticalBacklogConveyorServiceCore.js';

test('elastic admission with no selected mission does not crash or fabricate an active lane', async () => {
  const projection = {
    status: 'READY', blockers: [],
    machineryInventory: { sourceHead: 'a'.repeat(40) },
    scheduler: { decisionReceipt: null, elasticCapacity: { readyIndependentWorkCount: 0 } },
  };
  const result = await runCore({
    backlog: DEFAULT_CRITICAL_BACKLOG,
    paths: {
      repoRoot: '/test/repo', workspaceRoot: '/test/workspace',
      worktreeRoot: '/test/worktrees', orchestratorRoot: '/test/orchestrator',
      snapshotRoot: '/test/snapshots',
    },
    now: new Date('2026-10-08T08:00:00.000Z'),
    env: {},
    listMissions: async () => [],
    allowLegacyMissionCreation: false,
    publishProjection: async () => ({ ok: true }),
    readProgrammeProjection: async () => projection,
    ensureElasticMissions: async () => ({
      ok: true, selectedMission: null, elasticMissions: [],
      activeMissions: [], runnableMissions: [], desiredWidth: 5,
    }),
    readCapacityRouting: async () => ({}),
    dispatchElasticBuilds: async () => {
      throw new Error('no selected elastic mission can be dispatched');
    },
  });
  assert.notEqual(result.elasticAdmission?.classification, 'ELASTIC_GOAL_ADMISSION_DIAGNOSTIC_FAILED');
  assert.equal(result.elasticAdmission?.ok, true);
  assert.equal(result.elasticIgnition, null);
  assert.equal(result.projection?.activeMission ?? null, null);
  assert.equal(result.mergeAuthority, false);
});
