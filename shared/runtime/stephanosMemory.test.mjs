import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_DURABLE_MEMORY_STORAGE_KEY,
  createStephanosMemory,
  createStephanosMemoryGateway,
  createStephanosSharedMemoryAdapter,
} from './stephanosMemory.mjs';

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

function createStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
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

test('shared memory adapter hydrates from shared backend and mirrors locally for localhost/hosted parity', async () => {
  const storage = createStorage();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          data: {
            schemaVersion: 2,
            updatedAt: '2026-03-28T00:00:00.000Z',
            records: {
              'continuity::shared-note': {
                schemaVersion: 2,
                type: 'continuity.note',
                source: 'server',
                scope: 'runtime',
                summary: 'Shared note',
                payload: { text: 'same for hosted and localhost' },
                tags: ['shared'],
                importance: 'normal',
                retentionHint: 'default',
                createdAt: '2026-03-28T00:00:00.000Z',
                updatedAt: '2026-03-28T00:00:00.000Z',
                surface: 'shared',
              },
            },
          },
        });
      },
    };
  };

  const adapter = createStephanosSharedMemoryAdapter({
    storage,
    fetchImpl,
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
  });

  const hydration = await adapter.hydrate();
  assert.equal(hydration.source, 'shared-backend');
  assert.equal(adapter.readState().records['continuity::shared-note'].summary, 'Shared note');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, 'http://localhost:8787/api/memory/durable');
  assert.ok(storage.getItem(STEPHANOS_DURABLE_MEMORY_STORAGE_KEY));
});

test('shared memory adapter falls back to local mirror when backend is unavailable and reports diagnostics', async () => {
  const storage = createStorage({
    [STEPHANOS_DURABLE_MEMORY_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 2,
      updatedAt: '2026-03-28T00:00:00.000Z',
      records: {
        'continuity::local-note': {
          schemaVersion: 2,
          type: 'continuity.note',
          source: 'local',
          scope: 'runtime',
          summary: 'local fallback',
          payload: {},
          tags: [],
          importance: 'normal',
          retentionHint: 'default',
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          surface: 'localhost',
        },
      },
    }),
  });

  const adapter = createStephanosSharedMemoryAdapter({
    storage,
    fetchImpl: async () => {
      throw new Error('offline');
    },
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
  });

  const hydration = await adapter.hydrate();
  assert.equal(hydration.source, 'local-mirror-fallback');
  assert.equal(adapter.readState().records['continuity::local-note'].summary, 'local fallback');
  assert.equal(adapter.diagnostics().stateClass, 'local-fallback-mirror');
});

test('shared memory adapter rehydrates canonical backend state after conflict instead of silently overwriting newer shared truth', async () => {
  const storage = createStorage();
  let putCount = 0;
  const fetchImpl = async (_url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            data: {
              schemaVersion: 2,
              updatedAt: '2026-04-03T10:00:00.000Z',
              records: {
                'continuity::canonical': {
                  schemaVersion: 2,
                  type: 'continuity.note',
                  source: 'server',
                  scope: 'runtime',
                  summary: 'Canonical backend truth',
                  payload: { side: 'backend' },
                  tags: ['shared'],
                  importance: 'normal',
                  retentionHint: 'default',
                  createdAt: '2026-04-03T10:00:00.000Z',
                  updatedAt: '2026-04-03T10:00:00.000Z',
                  surface: 'shared',
                },
              },
            },
          });
        },
      };
    }

    putCount += 1;
    return {
      ok: false,
      status: 409,
      async text() {
        return JSON.stringify({
          success: false,
          error_code: 'DURABLE_MEMORY_CONFLICT',
          error: 'conflict',
        });
      },
    };
  };

  const adapter = createStephanosSharedMemoryAdapter({
    storage,
    fetchImpl,
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
  });

  await adapter.hydrate();
  adapter.writeState({
    schemaVersion: 2,
    updatedAt: '2026-04-03T10:00:00.000Z',
    records: {
      'continuity::local-change': {
        schemaVersion: 2,
        type: 'continuity.note',
        source: 'local',
        scope: 'runtime',
        summary: 'Stale local change',
        payload: {},
        tags: [],
        importance: 'normal',
        retentionHint: 'default',
        createdAt: '2026-04-03T10:01:00.000Z',
        updatedAt: '2026-04-03T10:01:00.000Z',
        surface: 'localhost',
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(putCount, 1);
  assert.equal(adapter.readState().records['continuity::canonical'].summary, 'Canonical backend truth');
  assert.equal(adapter.diagnostics().fallbackReason, 'backend-memory-conflict-resolved-by-rehydrate');
});
