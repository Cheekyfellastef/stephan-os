import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeedGardenProjectionV1 } from './seedGardenProjectionV1.mjs';

test('projects the canonical seeded project lanes as a shared seed garden', () => {
  const garden = buildSeedGardenProjectionV1({ observedAtUtc: '2026-10-04T19:00:00.000Z' });
  assert.equal(garden.schemaVersion, 'stephanos.seed-garden-projection.v1');
  assert.equal(garden.freshness, 'CURRENT');
  assert.equal(garden.seedCount, 15);
  assert.equal(garden.seeds[0].seedId, 'core-runtime-truth');
  assert.equal(garden.seeds[0].title, 'Core Runtime Truth');
  assert.equal(garden.seeds[0].progressPercent, 75);
  assert.ok(garden.seeds.some((seed) => seed.seedId === 'openclaw-control' && seed.status === 'blocked'));
  assert.ok(garden.seeds.some((seed) => seed.seedId === 'vr-spatial-surface' && seed.status === 'not-started'));
});

test('preserves evidence and blockers so assistants can help the flywheel', () => {
  const garden = buildSeedGardenProjectionV1({
    progressModel: {
      lanes: [{
        id: 'demo',
        title: 'Demo Seed',
        status: 'partial',
        confidence: 0.8,
        weight: 5,
        why: 'Needs help.',
        evidence: ['proof-a'],
        blockers: ['repair bridge'],
        dependsOn: ['runtime'],
        lastMilestone: 'Seed planted.',
      }],
    },
  });
  assert.deepEqual(garden.seeds[0].evidence, ['proof-a']);
  assert.deepEqual(garden.seeds[0].blockers, ['repair bridge']);
  assert.equal(garden.seeds[0].nextAction, 'repair bridge');
});
