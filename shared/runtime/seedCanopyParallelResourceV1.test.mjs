import test from 'node:test';
import assert from 'node:assert/strict';
import { checkParallelSeedModelResourceV1, isParallelSeedGovernorSnapshotFreshV1 } from './seedCanopyParallelResourceV1.mjs';

const NOW = Date.parse('2026-10-13T16:00:00.000Z');
const idle = { schemaVersion: 'stephanos.vr-resource-governor.v1',
  active: false, localModelAllowed: true, updatedAtUtc: new Date(NOW - 1000).toISOString() };
const loaded = { data: [{ id: 'qwen3-coder:30b', status: { value: 'loaded' } }] };

test('already resident local coding model is eligible only with explicit idle VR governor', () => {
  const result = checkParallelSeedModelResourceV1({
    governor: idle, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyLoaded, true);
  assert.equal(result.addedModelResidencyAllowed, false);
});

test('missing, gaming-protected or stale local model evidence must not start heavyweight inference', () => {
  const changes = [
    { governor: null },
    { governor: { ...idle, active: true, localModelAllowed: false } },
    { governor: { ...idle, localModelAllowed: false } },
    { governor: { ...idle, schemaVersion: 'unknown' } },
    { governor: { ...idle, updatedAtUtc: new Date(NOW - 60000).toISOString() } },
    { governor: { ...idle, updatedAtUtc: new Date(NOW + 2000).toISOString() } },
    { governor: { ...idle, updatedAtUtc: '' } },
    { modelInventory: { data: [] } },
    { modelInventory: { data: [{ id: 'other-heavy-model:30b', status: { value: 'loaded' } }] } },
    { modelInventory: { data: [{ id: 'qwen3-coder:30b', status: { value: 'unloaded' } }] } },
    { selectedModel: 'http://not-local.example' },
    { selectedModel: '' },
  ];
  for (const delta of changes) {
    const result = checkParallelSeedModelResourceV1({
      governor: idle, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', ...delta,
    });
    assert.equal(result.ok, false, JSON.stringify(delta));
    assert.ok(result.reasonCodes.length > 0);
  }
});

test('a live canonical reconcile can restore idle freshness without trusting stale or gaming snapshots', () => {
  const stale = { ...idle, updatedAtUtc: new Date(NOW - 60000).toISOString() };
  assert.equal(isParallelSeedGovernorSnapshotFreshV1(stale, NOW), false);
  assert.equal(checkParallelSeedModelResourceV1({
    governor: stale, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  }).ok, false);
  const reconciled = { ...stale, updatedAtUtc: new Date(NOW).toISOString() };
  assert.equal(isParallelSeedGovernorSnapshotFreshV1(reconciled, NOW), true);
  assert.equal(checkParallelSeedModelResourceV1({
    governor: reconciled, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  }).ok, true);
  assert.equal(checkParallelSeedModelResourceV1({
    governor: { ...reconciled, active: true, localModelAllowed: false },
    modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  }).ok, false, 'fresh active game always retains resource protection');
  assert.equal(isParallelSeedGovernorSnapshotFreshV1({
    ...reconciled, updatedAtUtc: new Date(NOW + 1).toISOString(),
  }, NOW), false, 'future proof is not admissible');
});

test('direct autoload-capable Ollama generation is not an admissible Seed Forge route', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../../scripts/seed-canopy-parallel-builder.mjs', import.meta.url), 'utf8');
  assert.match(worker, /\/v1\/completions\?autoload=false/);
  assert.match(worker, /GAME_PRIORITY_ABORTED_LOCAL_INFERENCE/);
  assert.match(worker, /clearInterval\(gameWatch\)/);
  assert.doesNotMatch(worker, /'\/api\/generate'/);
  assert.doesNotMatch(worker, /'\/api\/ps'/);
});
