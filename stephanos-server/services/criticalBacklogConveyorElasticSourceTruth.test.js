import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalElasticSourceRevision,
  dispatchElasticGoalBuildsFromCanonicalMain,
} from './criticalBacklogConveyorService.js';

const MAIN_HEAD = 'a'.repeat(40);
const PHYSICAL_WORKER_HEAD = 'b'.repeat(40);
const NOW = new Date('2026-09-07T14:30:00.000Z');
const PATHS = Object.freeze({
  repoRoot: '/repo',
  workspaceRoot: '/workspace',
  orchestratorRoot: '/orchestrator',
  snapshotRoot: '/snapshots',
});

function emptyAdmission() {
  return {
    desiredWidth: 5,
    selectedMission: null,
    activeMissions: [],
    runnableMissions: [],
  };
}

test('canonical elastic source revision comes only from authoritative canonical-main source truth', () => {
  assert.equal(canonicalElasticSourceRevision({ machineryInventory: { sourceHead: MAIN_HEAD } }), MAIN_HEAD);
  assert.equal(canonicalElasticSourceRevision({ machineryInventory: { sourceHead: 'not-a-sha' } }), '');
  assert.equal(canonicalElasticSourceRevision({}), '');
});

test('elastic source-only dispatch can ignite without a physical Mission Worker head', async () => {
  const result = await dispatchElasticGoalBuildsFromCanonicalMain(emptyAdmission(), {
    testOnly: true,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: '' },
    now: NOW,
    paths: PATHS,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead: MAIN_HEAD } }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_NOT_REQUIRED');
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
});

test('physical Mission Worker head cannot substitute for missing canonical-main source truth', async () => {
  const result = await dispatchElasticGoalBuildsFromCanonicalMain(emptyAdmission(), {
    testOnly: true,
    env: { STEPHANOS_MISSION_WORKER_HEAD_SHA: PHYSICAL_WORKER_HEAD },
    now: NOW,
    paths: PATHS,
    readProgrammeProjection: async () => ({ machineryInventory: { sourceHead: '' } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'ELASTIC_IGNITION_SOURCE_REVISION_UNPROVEN');
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
});
