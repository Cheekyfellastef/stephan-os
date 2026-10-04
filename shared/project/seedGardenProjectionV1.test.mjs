import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeedGardenProjectionV1 } from './seedGardenProjectionV1.mjs';

test('projects high-level Flywheel seeds above the static capability baseline without pretending it is live', () => {
  const garden = buildSeedGardenProjectionV1({ observedAtUtc: '2026-10-04T19:00:00.000Z' });
  assert.equal(garden.schemaVersion, 'stephanos.seed-garden-projection.v1');
  assert.equal(garden.freshness, 'STATIC');
  assert.equal(garden.highLevelSeedCount, 2);
  assert.equal(garden.capabilitySeedCount, 15);
  assert.equal(garden.seedCount, 17);
  assert.deepEqual(garden.highLevelSeeds.map((seed) => seed.seedId), [
    'starfield-vr-outcome-ownership',
    'stephanos-whole-system-capability-closure',
  ]);
  assert.equal(garden.highLevelSeeds[0].title, 'Starfield VR Excellence');
  assert.equal(garden.highLevelSeeds[1].title, 'Stephanos Whole-System Capability Closure');
  assert.ok(garden.capabilitySeeds.some((seed) => seed.seedId === 'openclaw-control' && seed.status === 'blocked'));
  assert.ok(garden.capabilitySeeds.some((seed) => seed.seedId === 'vr-spatial-surface' && seed.status === 'not-started'));
});

test('preserves adjudicated freshness, evidence and explicit next action without turning blockers into instructions', () => {
  const garden = buildSeedGardenProjectionV1({
    progressModel: {
      generatedAtUtc: '2026-10-04T20:30:00.000Z',
      freshness: 'CURRENT',
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
        nextAction: 'inspect canonical bridge owner',
      }],
    },
  });
  assert.equal(garden.freshness, 'CURRENT');
  assert.equal(garden.observedAtUtc, '2026-10-04T20:30:00.000Z');
  assert.equal(garden.capabilitySeedCount, 1);
  assert.deepEqual(garden.capabilitySeeds[0].evidence, ['proof-a']);
  assert.deepEqual(garden.capabilitySeeds[0].blockers, ['repair bridge']);
  assert.equal(garden.capabilitySeeds[0].nextAction, 'inspect canonical bridge owner');
});

test('blocker-only capability state leaves next action unknown', () => {
  const garden = buildSeedGardenProjectionV1({
    progressModel: {
      freshness: 'CURRENT',
      lanes: [{
        id: 'blocked-demo',
        title: 'Blocked Demo',
        status: 'blocked',
        blockers: ['physical proof required'],
      }],
    },
  });
  assert.deepEqual(garden.capabilitySeeds[0].blockers, ['physical proof required']);
  assert.equal(garden.capabilitySeeds[0].nextAction, '');
});
