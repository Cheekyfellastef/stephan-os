import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildStarfieldVrOutcomeOwnershipSeedV1,
  publishStarfieldVrOutcomeOwnershipSeedV1,
} from './starfieldVrOutcomeOwnershipSeedV1.mjs';

test('Starfield VR seed preserves authority while declaring persistent outcome ownership', () => {
  const seed = buildStarfieldVrOutcomeOwnershipSeedV1({
    timestampUtc: '2026-10-03T00:30:00.000Z',
  });
  assert.equal(seed.statusId, STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID);
  assert.equal(seed.missionId, STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID);
  assert.equal(seed.kind, 'stephanos.shared_workspace.status');
  assert.equal(seed.outcomeOwnershipSeed.schemaVersion, STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1);
  assert.equal(seed.outcomeOwnershipSeed.missionKind, 'persistent-outcome-ownership-bootstrap');
  assert.equal(seed.outcomeOwnershipSeed.preservedRoutes.includes('mutar-openxr'), true);
  assert.equal(seed.outcomeOwnershipSeed.preservedRoutes.includes('vorpx'), true);
  assert.equal(seed.outcomeOwnershipSeed.authority.sourceMutationAllowedBySeed, false);
  assert.equal(seed.outcomeOwnershipSeed.authority.runtimeMutationAllowedBySeed, false);
  assert.equal(seed.outcomeOwnershipSeed.authority.mergeAllowedBySeed, false);
  assert.equal(seed.outcomeOwnershipSeed.authority.duplicateControllerAllowed, false);
});

test('publisher refreshes the active seed heartbeat without duplicating the planting event', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-starfield-seed-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await publishStarfieldVrOutcomeOwnershipSeedV1({
    root,
    repoRoot: process.cwd(),
    timestampUtc: '2026-10-03T00:30:00.000Z',
  });
  assert.equal(first.ok, true);

  const second = await publishStarfieldVrOutcomeOwnershipSeedV1({
    root,
    repoRoot: process.cwd(),
    timestampUtc: '2026-10-03T00:31:00.000Z',
  });
  assert.equal(second.ok, true);
  assert.equal(second.eventWrite.reason, 'STARFIELD_VR_OUTCOME_OWNERSHIP_PLANTING_EVENT_ALREADY_PRESENT');

  const status = JSON.parse(await readFile(
    join(root, 'status', `${STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID}.json`),
    'utf8',
  ));
  const event = JSON.parse(await readFile(
    join(root, 'events', `${STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID}.json`),
    'utf8',
  ));
  await assert.rejects(
    readFile(join(root, 'goals', `${STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID}.json`), 'utf8'),
    { code: 'ENOENT' },
  );
  assert.equal(status.timestampUtc, '2026-10-03T00:31:00.000Z');
  assert.equal(status.outcomeOwnershipSeed.refreshedAtUtc, '2026-10-03T00:31:00.000Z');
  assert.equal(status.kind, 'stephanos.shared_workspace.status');
  assert.equal(event.eventKind, 'outcome-ownership-seed');
  assert.equal(event.outcomeOwnershipSeed.growthStage, 'SEEDED');
});
