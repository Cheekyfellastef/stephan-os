import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileMemoryBridge, resolveTileHostRuntime } from './tileMemoryBridge.js';

test('tile runtime resolves the canonical same-origin parent adapter', () => {
  const parentMemory = { saveRecord() {} };
  const localMemory = { saveRecord() {} };
  assert.equal(resolveTileHostRuntime('stephanosMemory', { stephanosMemory: localMemory, parent: { stephanosMemory: parentMemory } }), localMemory);
  assert.equal(resolveTileHostRuntime('stephanosMemory', { parent: { stephanosMemory: parentMemory } }), parentMemory);
  const deniedRuntime = {};
  Object.defineProperty(deniedRuntime, 'parent', { get() { throw new Error('cross-origin'); } });
  assert.equal(resolveTileHostRuntime('stephanosMemory', deniedRuntime), null);
});

test('tile memory bridge resolves a parent adapter lazily after construction', () => {
  const originalParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');
  const saved = [];
  try {
    Object.defineProperty(globalThis, 'parent', {
      configurable: true,
      value: { stephanosMemory: { saveRecord(record) { saved.push(record); return record; } } },
    });
    const bridge = createTileMemoryBridge({ tileId: 'music-tile', stephanosMemory: null });
    const result = bridge.submitMemoryCandidate({
      key: 'music.preference',
      value: 'dark club pressure',
      reason: 'Operator explicitly confirmed this preference.',
    });
    assert.equal(result.execution.persisted, true);
    assert.equal(saved.length, 1);
  } finally {
    if (originalParent) Object.defineProperty(globalThis, 'parent', originalParent);
    else delete globalThis.parent;
  }
});

test('tile memory bridge preserves related idea provenance through adjudication', () => {
  let savedPayload = null;
  const bridge = createTileMemoryBridge({
    tileId: 'ideas',
    stephanosMemory: {
      saveRecord(payload) {
        savedPayload = payload;
        return payload;
      },
    },
  });

  const result = bridge.submitMemoryCandidate({
    key: 'idea.insight.1',
    value: 'A promoted insight',
    reason: 'Operator promoted this because it affects runtime planning.',
    sourceRef: 'idea:1',
    relatedIdeaIds: ['idea_2'],
    confidence: 'high',
    tags: ['ideas'],
  });

  assert.equal(result.promoted, true);
  assert.deepEqual(result.candidate.relatedIdeaIds, ['idea_2']);
  assert.equal(savedPayload.payload.relatedIdeaIds[0], 'idea_2');
});

test('tile memory bridge revokes the original durable record through the guarded adapter', () => {
  const deleted = [];
  const events = [];
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      deleteRecord(identity) {
        deleted.push(identity);
        return true;
      },
    },
    executionLoop: { publishTileEvent(event) { events.push(event); } },
  });

  const result = bridge.revokeMemoryCandidate({
    record: { namespace: 'continuity', id: 'tile-memory-music-tile-1' },
    reason: 'Operator explicitly asked to forget this durable preference.',
    sourceRef: 'music-teaching:1',
  });

  assert.equal(result.revoked, true);
  assert.deepEqual(deleted, [{ namespace: 'continuity', id: 'tile-memory-music-tile-1' }]);
  assert.equal(events[0].action, 'tile.memory.candidate.revoke');
  assert.equal(events[0].result.execution.persisted, true);
});

test('tile memory revocation fails closed without original record identity', () => {
  let deleted = false;
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: { deleteRecord() { deleted = true; return true; } },
  });
  const result = bridge.revokeMemoryCandidate({ reason: 'Operator explicitly asked to forget this durable preference.' });
  assert.equal(result.ok, false);
  assert.equal(result.revoked, false);
  assert.equal(deleted, false);
});

test('tile memory revocation cannot delete a record owned by another tile', () => {
  let deleted = false;
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: { deleteRecord() { deleted = true; return true; } },
  });
  const result = bridge.revokeMemoryCandidate({
    record: { namespace: 'continuity', id: 'tile-memory-ideas-1' },
    reason: 'Operator explicitly asked to forget this durable preference.',
  });
  assert.equal(result.ok, false);
  assert.equal(result.revoked, false);
  assert.equal(deleted, false);
});
