import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

import { createTileEventBridge } from '../shared/runtime/tileEventBridge.js';
import { createTileMemoryBridge } from '../shared/runtime/tileMemoryBridge.js';
import { createTileRetrievalBridge } from '../shared/runtime/tileRetrievalBridge.js';

function createStorage(seed = {}) {
  const state = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
    },
    setItem(key, value) {
      state[key] = String(value);
    },
    removeItem(key) {
      delete state[key];
    },
    dump() {
      return { ...state };
    },
  };
}

test('context read returns bounded durable memory + retrieval context', async () => {
  const storage = createStorage({
    'stephanos.ai.tile-context.registry.v1': JSON.stringify({
      ideas: { tileId: 'ideas', tileTitle: 'Ideas', summary: 'saved ideas' },
    }),
    'stephanos.retrieval.tile-corpus.v1.ideas': JSON.stringify([
      { id: 'doc-1', document: 'idea retrieval document' },
    ]),
  });
  const windowObj = {
    localStorage: storage,
    parent: {
      stephanosMemory: {
        listRecords: () => [{ id: 'mem-1' }, { id: 'mem-2' }, { id: 'mem-3' }],
      },
    },
  };
  windowObj.window = windowObj;

  const source = await fs.readFile(new URL('../shared/runtime/tileContextBridge.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window: windowObj, JSON, Date });

  const bundle = windowObj.StephanosTileContextBridge.fetchTileContextBundle({
    tileId: 'ideas',
    includeRetrieval: true,
    memoryLimit: 2,
    retrievalLimit: 1,
  });

  assert.equal(bundle.tileSnapshot.tileId, 'ideas');
  assert.equal(bundle.memoryRecords.length, 2);
  assert.equal(bundle.retrieval.length, 1);
});

test('event write stores traceable artifacts and emits truth metadata', () => {
  const storage = createStorage();
  const loopEvents = [];
  const bridge = createTileEventBridge({
    tileId: 'ideas',
    storage,
    executionLoop: {
      publishTileEvent(event) {
        loopEvents.push(event);
      },
    },
  });

  const result = bridge.emitEvent({
    type: 'idea.created',
    payload: { title: 'Contract idea' },
    sourceRef: 'idea:1',
    tags: ['ideas'],
  });

  assert.equal(result.ok, true);
  assert.equal(bridge.listArtifacts().length, 1);
  assert.equal(loopEvents.length, 1);
  assert.equal(loopEvents[0].result.execution_metadata.tile_action_type, 'idea.created');
});

test('memory submission goes through adjudication and blocks invalid candidates', () => {
  const saved = [];
  const bridge = createTileMemoryBridge({
    tileId: 'ideas',
    stephanosMemory: {
      saveRecord(record) {
        saved.push(record);
        return { id: record.id };
      },
    },
    executionLoop: { publishTileEvent() {} },
  });

  const rejected = bridge.submitMemoryCandidate({ key: 'idea', value: 'short', reason: 'too short' });
  const promoted = bridge.submitMemoryCandidate({ key: 'idea', value: 'long enough payload', reason: 'Detailed operator reason for durable memory.' });

  assert.equal(rejected.promoted, false);
  assert.equal(promoted.promoted, true);
  assert.equal(saved.length, 1);
});

test('retrieval contribution ingests only explicit allowlisted docs and never auto-promotes memory', () => {
  const storage = createStorage();
  const bridge = createTileRetrievalBridge({
    tileId: 'ideas',
    storage,
    executionLoop: { publishTileEvent() {} },
  });

  const result = bridge.contributeDocument({
    document: 'Ideas artifact document for retrieval.',
    sourceRef: 'idea:retrieval-1',
    tags: ['ideas'],
    triggerReindex: true,
  });

  assert.equal(result.submitted, true);
  assert.equal(result.ingested, true);
  assert.equal(bridge.listCorpusEntries().length, 1);
  assert.equal(result.executionMetadata.memory_promoted, false);
});

test('separation guard: tile memory bridge does not expose direct durable write API', () => {
  const bridge = createTileMemoryBridge({
    tileId: 'ideas',
    stephanosMemory: { saveRecord() {} },
    executionLoop: { publishTileEvent() {} },
  });

  assert.equal(typeof bridge.saveRecord, 'undefined');
  assert.equal(typeof bridge.submitMemoryCandidate, 'function');
});

test('tile artifact persistence survives bridge re-initialization', () => {
  const storage = createStorage();
  const loop = { publishTileEvent() {} };
  const first = createTileEventBridge({ tileId: 'ideas', storage, executionLoop: loop });
  first.emitEvent({ type: 'idea.created', payload: { ideaId: 'a1' }, sourceRef: 'idea:a1' });

  const second = createTileEventBridge({ tileId: 'ideas', storage, executionLoop: loop });
  assert.equal(second.listArtifacts().length, 1);
});
