import test from 'node:test';
import '../runtime/sovereignMeterIndependenceSeedV1.test.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../project/seedGardenProjectionV1.mjs';
import {
  HIGH_LEVEL_FLYWHEEL_SEED_HEARTBEAT_SCHEMA_V1,
  STARFIELD_VR_OUTCOME_OWNERSHIP_EVENT_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1,
  buildHighLevelFlywheelSeedHeartbeatV1,
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

test('high-level seed heartbeat binds the seed itself to its canonical issue and contract source', () => {
  const conversationalSeed = HIGH_LEVEL_FLYWHEEL_SEEDS_V1.find(
    (seed) => seed.seedId === 'stephanos-flywheel-conversational-intelligence',
  );
  const heartbeat = buildHighLevelFlywheelSeedHeartbeatV1(conversationalSeed, {
    timestampUtc: '2026-10-07T19:30:00.000Z',
  });

  assert.equal(heartbeat.statusId, conversationalSeed.seedId);
  assert.equal(heartbeat.missionId, conversationalSeed.seedId);
  assert.equal(heartbeat.relatedIssue, '#2798');
  assert.equal(heartbeat.issueRef, '#2798');
  assert.equal(heartbeat.title, conversationalSeed.title);
  assert.equal(heartbeat.seedContractSource, 'shared/runtime/conversationalIntelligenceSeedV1.mjs');
  assert.equal(heartbeat.status, 'SEED_ACTIVE');
  assert.deepEqual(heartbeat.proofRefs, []);
  assert.equal(heartbeat.seedHeartbeat.schemaVersion, HIGH_LEVEL_FLYWHEEL_SEED_HEARTBEAT_SCHEMA_V1);
  assert.equal(heartbeat.seedHeartbeat.missionId, conversationalSeed.seedId);
  assert.equal(heartbeat.seedHeartbeat.issueRef, '#2798');
  assert.equal(heartbeat.seedHeartbeat.authorityWidened, false);
  assert.equal(heartbeat.seedHeartbeat.createsReplacementMachinery, false);
});

test('publisher refreshes all six actual seed heartbeats without duplicating the Starfield planting event', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-starfield-seed-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, 'goals'), { recursive: true });
  await writeFile(
    join(root, 'goals', `${STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID}.json`),
    JSON.stringify({
      goalId: STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
      outcomeOwnershipSeed: { schemaVersion: STARFIELD_VR_OUTCOME_OWNERSHIP_SEED_SCHEMA_V1 },
    }),
    'utf8',
  );

  const first = await publishStarfieldVrOutcomeOwnershipSeedV1({
    root,
    repoRoot: process.cwd(),
    timestampUtc: '2026-10-03T00:30:00.000Z',
  });
  assert.equal(first.ok, true);
  assert.equal(first.legacyGoalRetirement.ok, true);
  assert.equal(first.legacyGoalRetirement.reason, 'STARFIELD_VR_OUTCOME_OWNERSHIP_LEGACY_GOAL_RETIRED_OR_ABSENT');
  assert.equal(first.expectedHighLevelSeedCount, 8);
  assert.equal(first.publishedHighLevelSeedCount, 8);
  assert.deepEqual(
    first.seedHeartbeatWrites.map((entry) => entry.seedId).sort(),
    HIGH_LEVEL_FLYWHEEL_SEEDS_V1.map((seed) => seed.seedId).sort(),
  );

  const second = await publishStarfieldVrOutcomeOwnershipSeedV1({
    root,
    repoRoot: process.cwd(),
    timestampUtc: '2026-10-03T00:31:00.000Z',
  });
  assert.equal(second.ok, true);
  assert.equal(second.eventWrite.reason, 'STARFIELD_VR_OUTCOME_OWNERSHIP_PLANTING_EVENT_ALREADY_PRESENT');
  assert.equal(second.publishedHighLevelSeedCount, 8);

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

  for (const seed of HIGH_LEVEL_FLYWHEEL_SEEDS_V1.filter(
    (entry) => entry.seedId !== STARFIELD_VR_OUTCOME_OWNERSHIP_MISSION_ID,
  )) {
    const heartbeat = JSON.parse(await readFile(
      join(root, 'status', `${seed.seedId}.json`),
      'utf8',
    ));
    assert.equal(heartbeat.kind, 'stephanos.shared_workspace.status');
    assert.equal(heartbeat.statusId, seed.seedId);
    assert.equal(heartbeat.missionId, seed.seedId);
    assert.equal(heartbeat.relatedIssue, seed.issue);
    assert.equal(heartbeat.issueRef, seed.issue);
    assert.equal(heartbeat.title, seed.title);
    assert.equal(heartbeat.seedContractSource, seed.source);
    assert.equal(heartbeat.timestampUtc, '2026-10-03T00:31:00.000Z');
    assert.equal(heartbeat.seedHeartbeat.schemaVersion, HIGH_LEVEL_FLYWHEEL_SEED_HEARTBEAT_SCHEMA_V1);
    assert.equal(heartbeat.seedHeartbeat.contractSource, seed.source);
    assert.deepEqual(heartbeat.proofRefs, []);
  }
});
