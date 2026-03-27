import test from 'node:test';
import assert from 'node:assert/strict';

import { createStephanosMemory, createStephanosMemoryGateway } from './stephanosMemory.mjs';

function createInMemoryAdapter() {
  let state = null;
  return {
    mode: 'in-memory-test-adapter',
    readState() {
      return state || {
        schemaVersion: 1,
        updatedAt: '2026-03-27T00:00:00.000Z',
        records: {},
      };
    },
    writeState(nextState) {
      state = nextState;
    },
  };
}

test('stephanos memory CRUD flow persists records by namespace and id', () => {
  const memory = createStephanosMemory({
    adapter: createInMemoryAdapter(),
    source: 'ai-agent',
    surface: 'launcher-root',
  });

  const created = memory.createRecord({
    namespace: 'intel',
    id: 'note-1',
    type: 'ai.summary',
    summary: 'First note',
    payload: { confidence: 0.82 },
    tags: ['ai', 'continuity'],
  });
  assert.equal(created.namespace, 'intel');
  assert.equal(created.id, 'note-1');
  assert.equal(created.type, 'ai.summary');

  const fetched = memory.getRecord({ namespace: 'intel', id: 'note-1' });
  assert.equal(fetched?.summary, 'First note');
  assert.deepEqual(fetched?.payload, { confidence: 0.82 });

  const listed = memory.listRecords({ namespace: 'intel' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].source, 'ai-agent');
});

test('stephanos memory update and delete keep durable memory distinct and stable', () => {
  const memory = createStephanosMemory({
    adapter: createInMemoryAdapter(),
    source: 'tile-system',
    surface: 'hosted',
  });

  memory.saveRecord({
    namespace: 'tiles',
    id: 'artifact-42',
    type: 'tile.result',
    summary: 'Initial artifact',
    payload: { status: 'draft' },
    tags: ['tile'],
  });
  const updated = memory.updateRecord({
    namespace: 'tiles',
    id: 'artifact-42',
    patch: {
      summary: 'Published artifact',
      payload: { status: 'published' },
      tags: ['tile', 'published'],
    },
  });
  assert.equal(updated?.summary, 'Published artifact');
  assert.deepEqual(updated?.payload, { status: 'published' });

  const tagged = memory.listRecords({ namespace: 'tiles', tag: 'published' });
  assert.equal(tagged.length, 1);
  assert.equal(tagged[0].surface, 'hosted');

  const deleted = memory.deleteRecord({ namespace: 'tiles', id: 'artifact-42' });
  assert.equal(deleted, true);
  assert.equal(memory.getRecord({ namespace: 'tiles', id: 'artifact-42' }), null);
});

test('stephanos memory rejects untyped arbitrary records', () => {
  const memory = createStephanosMemory({
    adapter: createInMemoryAdapter(),
    source: 'runtime',
    surface: 'launcher-root',
  });

  assert.throws(() => {
    memory.saveRecord({
      namespace: 'intel',
      id: 'bad-record',
      type: 'unknown',
      summary: 'this should fail',
    });
  });
});

test('stephanos memory gateway persists structured event records', () => {
  const memory = createStephanosMemory({
    adapter: createInMemoryAdapter(),
    source: 'runtime',
    surface: 'launcher-root',
  });
  const gateway = createStephanosMemoryGateway(memory, {
    namespace: 'continuity',
    source: 'continuity-gateway-test',
  });

  const record = gateway.persistEventRecord({
    name: 'tile.opened',
    data: {
      tileId: 'wealthapp',
      summary: 'Opened Wealth App',
      tags: ['tile', 'open'],
    },
  });

  assert.equal(record.type, 'tile.event');
  assert.equal(record.source, 'continuity-gateway-test');
  assert.equal(record.payload.tileId, 'wealthapp');
});
