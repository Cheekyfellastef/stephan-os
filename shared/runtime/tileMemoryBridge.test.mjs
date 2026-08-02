import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileMemoryBridge, resolveTileHostRuntime } from './tileMemoryBridge.js';

function ownedMusicRecord(id, overrides = {}) {
  return {
    namespace: 'continuity',
    id,
    type: 'operator.preference',
    tags: ['tile.memory.candidate', 'tile.music-tile', 'explicit-teaching'],
    ...overrides,
  };
}

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

test('durable tile submission waits for backend authority before reporting persistence', async () => {
  const events = [];
  let releaseAuthority;
  const authority = new Promise((resolve) => { releaseAuthority = resolve; });
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      async saveRecordDurably(payload) {
        await authority;
        return {
          record: { namespace: 'continuity', id: payload.id, ...payload },
          authorityConfirmed: true,
          receipt: { authorityConfirmed: true, id: 'authority-1' },
        };
      },
    },
    executionLoop: { publishTileEvent(event) { events.push(event); } },
  });

  const pending = bridge.submitMemoryCandidateDurably({
    key: 'music.preference',
    value: 'dark club pressure',
    reason: 'Operator explicitly confirmed this durable music preference.',
  });
  await Promise.resolve();
  assert.equal(events.length, 0);

  releaseAuthority();
  const result = await pending;
  assert.equal(result.execution.persisted, true);
  assert.equal(result.authorityReceipt.id, 'authority-1');
  assert.equal(events.length, 1);
  assert.equal(events[0].result.execution.persisted, true);
  assert.deepEqual(events[0].result.memoryRecordIdentity, {
    namespace: 'continuity',
    id: result.record.id,
  });
  assert.equal(events[0].result.candidate, undefined);
  assert.equal(events[0].result.persistedRecord, undefined);
  assert.equal(events[0].result.authorityReceipt, undefined);
  assert.doesNotMatch(JSON.stringify(events[0]), /dark club pressure|Operator explicitly confirmed/);
});

test('durable tile submissions use collision-resistant identities even in the same millisecond', async () => {
  const savedIds = [];
  const uuids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    cryptoImpl: { randomUUID() { return uuids.shift(); } },
    stephanosMemory: {
      async saveRecordDurably(payload) {
        savedIds.push(payload.id);
        return {
          record: { namespace: 'continuity', ...payload },
          authorityConfirmed: true,
          receipt: { authorityConfirmed: true },
        };
      },
    },
  });

  await Promise.all([
    bridge.submitMemoryCandidateDurably({ key: 'music.preference.one', value: 'one', reason: 'Operator explicitly confirmed the first preference.' }),
    bridge.submitMemoryCandidateDurably({ key: 'music.preference.two', value: 'two', reason: 'Operator explicitly confirmed the second preference.' }),
  ]);

  assert.deepEqual(savedIds, [
    'tile-memory-music-tile-11111111-1111-4111-8111-111111111111',
    'tile-memory-music-tile-22222222-2222-4222-8222-222222222222',
  ]);
  assert.equal(new Set(savedIds).size, 2);
});

test('tile memory bridge lists only authoritative owned durable teachings', async () => {
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      async listRecordsDurably(filters) {
        assert.deepEqual(filters, {
          namespace: 'continuity',
          type: 'operator.preference',
          tag: 'tile.music-tile',
        });
        return {
          authorityConfirmed: true,
          receipt: { authorityConfirmed: true },
          records: [
            ownedMusicRecord('tile-memory-music-tile-teaching'),
            ownedMusicRecord('generic-writer-record'),
            ownedMusicRecord('tile-memory-music-tile-other', { tags: ['tile.memory.candidate', 'tile.music-tile'] }),
          ],
        };
      },
    },
  });

  const result = await bridge.listDurableMemoryCandidates({ tags: ['explicit-teaching'] });

  assert.equal(result.authorityConfirmed, true);
  assert.deepEqual(result.records.map((record) => record.id), ['tile-memory-music-tile-teaching']);
});

test('tile memory bridge revokes its complete teaching set through one atomic owned-set mutation', async () => {
  const calls = [];
  const events = [];
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      async deleteRecordsDurably(filters) {
        calls.push(filters);
        return { deletedCount: 3, alreadyEmpty: false, authorityConfirmed: true, receipt: { authorityConfirmed: true } };
      },
    },
    executionLoop: { publishTileEvent(event) { events.push(event); } },
  });

  const result = await bridge.revokeAllMemoryCandidates({
    tags: ['explicit-teaching'],
    reason: 'Operator reset the Music Tile and requested all durable teachings be revoked.',
  });

  assert.equal(result.revoked, true);
  assert.equal(result.deletedCount, 3);
  assert.deepEqual(calls, [{
    namespace: 'continuity',
    idPrefix: 'tile-memory-music-tile-',
    type: 'operator.preference',
    tags: ['tile.memory.candidate', 'tile.music-tile', 'explicit-teaching'],
  }]);
  assert.equal(events[0].action, 'tile.memory.candidate.revoke-set');
  assert.equal(events[0].result.authorityConfirmed, true);
  assert.equal(events[0].result.revokedRecordCount, 3);
});

test('tile memory bridge revokes the original durable record through the guarded adapter', async () => {
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

  const result = await bridge.revokeMemoryCandidate({
    record: ownedMusicRecord('tile-memory-music-tile-1'),
    reason: 'Operator explicitly asked to forget this durable preference.',
    sourceRef: 'music-teaching:1',
  });

  assert.equal(result.revoked, true);
  assert.deepEqual(deleted, [{ namespace: 'continuity', id: 'tile-memory-music-tile-1' }]);
  assert.equal(events[0].action, 'tile.memory.candidate.revoke');
  assert.equal(events[0].result.execution.persisted, true);
});

test('tile memory revocation waits for durable deletion authority when available', async () => {
  let synchronousDeleteCalled = false;
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      deleteRecord() { synchronousDeleteCalled = true; return true; },
      async deleteRecordDurably() {
        return { deleted: true, alreadyAbsent: false, authorityConfirmed: true, receipt: { id: 'durable-1' } };
      },
    },
  });

  const result = await bridge.revokeMemoryCandidate({
    record: ownedMusicRecord('tile-memory-music-tile-durable'),
    reason: 'Operator explicitly asked to forget this durable preference.',
  });

  assert.equal(result.revoked, true);
  assert.equal(synchronousDeleteCalled, false);
});

test('tile memory revocation retains identity when durable deletion is unconfirmed', async () => {
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      async deleteRecordDurably() {
        return { deleted: true, alreadyAbsent: false, authorityConfirmed: false, receipt: null };
      },
    },
  });
  const result = await bridge.revokeMemoryCandidate({
    record: ownedMusicRecord('tile-memory-music-tile-unconfirmed'),
    reason: 'Operator explicitly asked to forget this durable preference.',
  });
  assert.equal(result.revoked, false);
});

test('tile memory revocation is idempotent when canonical storage proves the record is already absent', async () => {
  const events = [];
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      deleteRecord() { return false; },
      getRecord() { return null; },
    },
    executionLoop: { publishTileEvent(event) { events.push(event); } },
  });

  const result = await bridge.revokeMemoryCandidate({
    record: ownedMusicRecord('tile-memory-music-tile-already-gone'),
    reason: 'Operator reset the Music Tile and requested its durable teachings be revoked.',
  });

  assert.equal(result.revoked, true);
  assert.equal(result.alreadyAbsent, true);
  assert.equal(result.execution.mode, 'already-absent');
  assert.equal(result.truth.memoryRecordAlreadyAbsent, true);
  assert.equal(events[0].result.execution.persisted, true);
});

test('tile memory revocation fails closed when absence cannot be canonically verified', async () => {
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: {
      deleteRecord() { return false; },
      getRecord() { throw new Error('storage unavailable'); },
    },
  });
  const result = await bridge.revokeMemoryCandidate({
    record: ownedMusicRecord('tile-memory-music-tile-unknown'),
    reason: 'Operator reset the Music Tile and requested its durable teachings be revoked.',
  });
  assert.equal(result.revoked, false);
  assert.equal(result.alreadyAbsent, false);
});

test('tile memory revocation fails closed without original record identity', async () => {
  let deleted = false;
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: { deleteRecord() { deleted = true; return true; } },
  });
  const result = await bridge.revokeMemoryCandidate({ reason: 'Operator explicitly asked to forget this durable preference.' });
  assert.equal(result.ok, false);
  assert.equal(result.revoked, false);
  assert.equal(deleted, false);
});

test('tile memory revocation cannot delete a record owned by another tile', async () => {
  let deleted = false;
  const bridge = createTileMemoryBridge({
    tileId: 'music-tile',
    stephanosMemory: { deleteRecord() { deleted = true; return true; } },
  });
  const result = await bridge.revokeMemoryCandidate({
    record: ownedMusicRecord('tile-memory-ideas-1', { tags: ['tile.memory.candidate', 'tile.ideas', 'explicit-teaching'] }),
    reason: 'Operator explicitly asked to forget this durable preference.',
  });
  assert.equal(result.ok, false);
  assert.equal(result.revoked, false);
  assert.equal(deleted, false);
});
