import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeedGardenProjectionV1 } from './seedGardenProjectionV1.mjs';

test('projects high-level Flywheel seeds above the static capability baseline without pretending it is live', () => {
  const garden = buildSeedGardenProjectionV1({ observedAtUtc: '2026-10-04T19:00:00.000Z' });
  assert.equal(garden.schemaVersion, 'stephanos.seed-garden-projection.v1');
  assert.equal(garden.freshness, 'STATIC');
  assert.equal(garden.highLevelSeedCount, 7);
  assert.equal(garden.capabilitySeedCount, 15);
  assert.equal(garden.seedCount, 22);
  assert.deepEqual(garden.highLevelSeeds.map((seed) => seed.seedId), [
    'starfield-vr-outcome-ownership',
    'stephanos-whole-system-capability-closure',
    'stephanos-runs-the-project',
    'stephanos-flywheel-conversational-intelligence',
    'sovereign-commander-safe-parity',
    'stephanos-sovereign-meter-independence',
    'workspace-integrity-provenance',
  ]);
  assert.equal(garden.highLevelSeeds[0].title, 'Starfield VR Excellence');
  assert.equal(garden.highLevelSeeds[0].northStar, 'Continuously improve Starfield into the best VR experience achievable on the Battle Bridge while preserving safe operator control.');
  assert.equal(garden.highLevelSeeds[1].title, 'Stephanos Whole-System Capability Closure');
  assert.equal(garden.highLevelSeeds[2].title, 'Stephanos Runs the Project');
  assert.equal(garden.highLevelSeeds[2].issue, '#2796');
  assert.match(garden.highLevelSeeds[2].northStar, /without routine operator or ChatGPT pokes/);
  assert.equal(garden.highLevelSeeds[3].title, 'Stephanos + Flywheel Conversational Intelligence');
  assert.equal(garden.highLevelSeeds[3].issue, '#2798');
  assert.match(garden.highLevelSeeds[3].northStar, /coherent, context-rich, grounded, insightful/);
  assert.equal(garden.highLevelSeeds[4].title, 'Teach Sovereign Commander Everything Remote Desktop Commander Can Do Safely');
  assert.equal(garden.highLevelSeeds[4].issue, '#2519');
  assert.match(garden.highLevelSeeds[4].northStar, /everything that Remote Desktop Commander can do safely/i);
  assert.equal(garden.highLevelSeeds[5].title, 'Stephanos Sovereign Meter Independence');
  assert.equal(garden.highLevelSeeds[5].issue, '#2968');
  assert.match(garden.highLevelSeeds[5].northStar, /third-party metered tool/i);
  assert.equal(garden.highLevelSeeds[5].source, 'shared/runtime/sovereignMeterIndependenceSeedV1.mjs');
  assert.equal(garden.highLevelSeeds[6].title, 'Every Workspace, Card and Visualiser Has Verified End-to-End Provenance');
  assert.equal(garden.highLevelSeeds[6].issue, '#2898');
  assert.match(garden.highLevelSeeds[6].northStar, /canonical source through transport and transformation/i);
  assert.ok(garden.capabilitySeeds.some((seed) => seed.seedId === 'openclaw-control' && seed.status === 'blocked'));
  assert.ok(garden.capabilitySeeds.some((seed) => seed.seedId === 'vr-spatial-surface' && seed.status === 'not-started'));
});

test('preserves producer timestamp but does not invent CURRENT freshness', () => {
  const garden = buildSeedGardenProjectionV1({
    progressModel: {
      generatedAt: '2026-10-04T20:30:00.000Z',
      lanes: [{ id: 'demo', title: 'Demo Seed', status: 'partial' }],
    },
  });
  assert.equal(garden.freshness, 'UNKNOWN');
  assert.equal(garden.observedAtUtc, '2026-10-04T20:30:00.000Z');
});

test('projects per-lane next action from the canonical adjudicated action queue', () => {
  const garden = buildSeedGardenProjectionV1({
    progressModel: {
      generatedAt: '2026-10-04T20:30:00.000Z',
      freshness: 'CURRENT',
      lanes: [{
        id: 'openclaw-control',
        title: 'OpenClaw Control',
        status: 'blocked',
        evidence: ['proof-a'],
        blockers: ['repair bridge'],
      }],
      nextBestActions: [{
        id: 'wire-openclaw-kill-switch',
        title: 'Wire OpenClaw Kill Switch',
        blocks: ['OpenClaw Control'],
        evidence: ['queue-proof'],
      }],
    },
  });
  assert.equal(garden.freshness, 'CURRENT');
  assert.deepEqual(garden.capabilitySeeds[0].evidence, ['proof-a']);
  assert.deepEqual(garden.capabilitySeeds[0].blockers, ['repair bridge']);
  assert.equal(garden.capabilitySeeds[0].nextAction, 'Wire OpenClaw Kill Switch');
  assert.equal(garden.capabilitySeeds[0].nextActionId, 'wire-openclaw-kill-switch');
  assert.equal(garden.nextBestActions[0].id, 'wire-openclaw-kill-switch');
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
