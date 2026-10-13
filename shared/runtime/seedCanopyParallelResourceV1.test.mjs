import test from 'node:test';
import assert from 'node:assert/strict';
import { checkParallelSeedModelResourceV1 } from './seedCanopyParallelResourceV1.mjs';

const NOW = Date.parse('2026-10-13T16:00:00.000Z');
const idle = { schemaVersion: 'stephanos.vr-resource-governor.v1',
  active: false, localModelAllowed: true, updatedAtUtc: new Date(NOW - 1000).toISOString() };
const loaded = { models: [{ name: 'qwen3-coder:30b' }] };

test('already resident local coding model is eligible only with explicit idle VR governor', () => {
  const result = checkParallelSeedModelResourceV1({
    governor: idle, ollamaPs: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
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
    { ollamaPs: { models: [] } },
    { ollamaPs: { models: [{ name: 'other-heavy-model:30b' }] } },
    { selectedModel: 'http://not-local.example' },
    { selectedModel: '' },
  ];
  for (const delta of changes) {
    const result = checkParallelSeedModelResourceV1({
      governor: idle, ollamaPs: loaded, selectedModel: 'qwen3-coder:30b', ...delta,
    });
    assert.equal(result.ok, false, JSON.stringify(delta));
    assert.ok(result.reasonCodes.length > 0);
  }
});
