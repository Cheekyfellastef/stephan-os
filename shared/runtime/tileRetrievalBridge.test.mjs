import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileRetrievalBridge } from './tileRetrievalBridge.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('tile retrieval bridge uses local fallback when shared gateway is unavailable', () => {
  const storage = createStorage();
  const bridge = createTileRetrievalBridge({
    tileId: 'ideas',
    storage,
    allowlist: ['ideas'],
  });

  const result = bridge.contributeDocument({
    document: 'Idea retrieval payload',
    sourceRef: 'idea:1',
    tags: ['ideas'],
  });

  assert.equal(result.ingested, true);
  assert.equal(result.execution.mode, 'local-fallback');
  assert.equal(result.truth.retrievalValidationState, 'caravan-local-fallback');
  assert.equal(bridge.listCorpusEntries().length, 1);
  assert.equal(bridge.getSourceTruth(), 'local-fallback');
});

test('tile retrieval bridge reports shared-backed mode when gateway persists contribution', () => {
  const bridge = createTileRetrievalBridge({
    tileId: 'ideas',
    storage: createStorage(),
    allowlist: ['ideas'],
    memoryGateway: {
      persistTypedRecord(payload) {
        return { id: payload.id };
      },
    },
  });

  const result = bridge.contributeDocument({
    document: 'Shared candidate',
    sourceRef: 'idea:2',
  });

  assert.equal(result.ingested, true);
  assert.equal(result.execution.mode, 'shared-backed');
  assert.equal(result.truth.retrievalValidationState, 'implemented-not-battle-bridge-validated');
  assert.equal(bridge.getSourceTruth(), 'scaffolded-unvalidated');
});
