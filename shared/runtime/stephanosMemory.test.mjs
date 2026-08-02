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

test('durable deletion waits for an authority-bearing adapter receipt', async () => {
  let state = { schemaVersion: 2, updatedAt: '2026-08-02T00:00:00.000Z', records: {} };
  let durableWrites = 0;
  const adapter = {
    mode: 'authority-test-adapter',
    readState() { return state; },
    writeState(nextState) { state = nextState; },
    async writeStateDurably(nextState) {
      durableWrites += 1;
      state = nextState;
      return { authorityConfirmed: true, source: 'test-durable-authority', receiptId: 'receipt-1' };
    },
  };
  const memory = createStephanosMemory({ adapter, source: 'tile-system', surface: 'hosted' });
  memory.saveRecord({ namespace: 'continuity', id: 'owned-1', type: 'operator.preference', summary: 'Owned preference' });

  const result = await memory.deleteRecordDurably({ namespace: 'continuity', id: 'owned-1' });

  assert.equal(result.deleted, true);
  assert.equal(result.authorityConfirmed, true);
  assert.equal(result.receipt.receiptId, 'receipt-1');
  assert.equal(durableWrites, 1);
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'owned-1' }), null);
});

test('durable deletion fails closed without an authority receipt', async () => {
  const adapter = createInMemoryAdapter();
  const memory = createStephanosMemory({ adapter, source: 'tile-system', surface: 'hosted' });
  memory.saveRecord({ namespace: 'continuity', id: 'owned-2', type: 'operator.preference', summary: 'Owned preference' });

  const result = await memory.deleteRecordDurably({ namespace: 'continuity', id: 'owned-2' });

  assert.equal(result.deleted, false);
  assert.equal(result.authorityConfirmed, false);
  assert.notEqual(memory.getRecord({ namespace: 'continuity', id: 'owned-2' }), null);
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

test('durable shared-memory deletion waits behind earlier writes and is the final backend authority', async () => {
  const storage = createStorage({
    [STEPHANOS_DURABLE_MEMORY_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 2,
      updatedAt: '2026-08-02T00:00:00.000Z',
      records: {},
    }),
  });
  const writes = [];
  let releaseFirstWrite;
  const firstWriteBlocked = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const fetchImpl = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    writes.push(body);
    if (writes.length === 1) await firstWriteBlocked;
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ success: true, data: body }); },
    };
  };
  const adapter = createStephanosSharedMemoryAdapter({
    storage,
    fetchImpl,
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
  });
  const record = {
    schemaVersion: 2,
    type: 'operator.preference',
    source: 'music-tile',
    scope: 'runtime',
    summary: 'Temporary teaching',
    payload: {},
    tags: ['music'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'hosted',
  };
  adapter.writeState({ schemaVersion: 2, updatedAt: '2026-08-02T00:01:00.000Z', records: { 'continuity::teaching': record } });
  const durableDelete = adapter.writeStateDurably({ schemaVersion: 2, updatedAt: '2026-08-02T00:02:00.000Z', records: {} });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].source, 'memory-runtime');
  assert.equal(writes[0].ifUnmodifiedSince, '2026-08-02T00:00:00.000Z');

  releaseFirstWrite();
  const receipt = await durableDelete;
  assert.equal(receipt.authorityConfirmed, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].source, 'memory-runtime-durable');
  assert.equal(writes[1].ifUnmodifiedSince, '2026-08-02T00:01:00.000Z');
  assert.deepEqual(writes[1].records, {});
  assert.deepEqual(adapter.readState().records, {});
});

test('queued durable record mutation rebases after conflict and preserves another device record', async () => {
  const teaching = {
    schemaVersion: 2,
    type: 'operator.preference',
    source: 'music-tile',
    scope: 'runtime',
    summary: 'Teaching to forget',
    payload: {},
    tags: ['music'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'hosted',
  };
  const remoteRecord = {
    ...teaching,
    type: 'continuity.note',
    source: 'other-device',
    summary: 'Another device record',
  };
  const storage = createStorage({
    [STEPHANOS_DURABLE_MEMORY_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 2,
      updatedAt: '2026-08-02T00:00:00.000Z',
      records: { 'continuity::teaching': teaching },
    }),
  });
  const writes = [];
  let putCount = 0;
  const fetchImpl = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'GET') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            data: {
              schemaVersion: 2,
              updatedAt: '2026-08-02T00:01:00.000Z',
              records: {
                'continuity::teaching': teaching,
                'continuity::remote': remoteRecord,
              },
            },
          });
        },
      };
    }
    putCount += 1;
    const body = JSON.parse(options.body || '{}');
    writes.push(body);
    if (putCount === 1) {
      return {
        ok: false,
        status: 409,
        async text() {
          return JSON.stringify({ success: false, error_code: 'DURABLE_MEMORY_CONFLICT', error: 'conflict' });
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: { ...body, updatedAt: '2026-08-02T00:02:00.000Z' } });
      },
    };
  };
  const adapter = createStephanosSharedMemoryAdapter({
    storage,
    fetchImpl,
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  adapter.writeState({
    schemaVersion: 2,
    updatedAt: '2026-08-02T00:00:30.000Z',
    records: { 'continuity::teaching': teaching },
  });
  const deletion = memory.deleteRecordDurably({ namespace: 'continuity', id: 'teaching' });
  const result = await deletion;

  assert.equal(result.authorityConfirmed, true);
  assert.equal(writes.length, 3);
  assert.equal(result.receipt.state, undefined);
  assert.equal(result.receipt.baseState, undefined);
  assert.equal(writes[1].ifUnmodifiedSince, '2026-08-02T00:01:00.000Z');
  assert.equal(writes[1].records['continuity::teaching'].summary, 'Teaching to forget');
  assert.equal(writes[1].records['continuity::remote'].summary, 'Another device record');
  assert.equal(writes[2].records['continuity::teaching'], undefined);
  assert.equal(writes[2].records['continuity::remote'].summary, 'Another device record');
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'remote' })?.summary, 'Another device record');
});

test('durable mutation rehydrates recovered backend authority before its first write', async () => {
  const remoteRecord = {
    schemaVersion: 2,
    type: 'continuity.note',
    source: 'other-device',
    scope: 'runtime',
    summary: 'Remote record must survive recovery',
    payload: {},
    tags: ['shared'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'shared',
  };
  let getCount = 0;
  let writtenBody = null;
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async (_url, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        getCount += 1;
        if (getCount === 1) throw new Error('backend temporarily offline');
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              success: true,
              data: {
                schemaVersion: 2,
                updatedAt: '2026-08-02T00:01:00.000Z',
                records: { 'continuity::remote': remoteRecord },
              },
            });
          },
        };
      }
      writtenBody = JSON.parse(options.body || '{}');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ success: true, data: { ...writtenBody, updatedAt: '2026-08-02T00:02:00.000Z' } });
        },
      };
    },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });
  const degraded = await memory.hydrate();
  assert.equal(degraded.source, 'local-mirror-fallback');

  const result = await memory.saveRecordDurably({
    namespace: 'continuity',
    id: 'new-teaching',
    type: 'operator.preference',
    summary: 'New teaching',
  });

  assert.equal(result.authorityConfirmed, true);
  assert.equal(getCount, 2);
  assert.equal(writtenBody.ifUnmodifiedSince, '2026-08-02T00:01:00.000Z');
  assert.equal(writtenBody.records['continuity::remote'].summary, 'Remote record must survive recovery');
  assert.equal(writtenBody.records['continuity::new-teaching'].summary, 'New teaching');
});

test('durable mutation mirrors the rebased authority after its own conflict', async () => {
  const teaching = {
    schemaVersion: 2,
    type: 'operator.preference',
    source: 'music-tile',
    scope: 'runtime',
    summary: 'Teaching to forget',
    payload: {},
    tags: ['music'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'hosted',
  };
  const remoteRecord = { ...teaching, type: 'continuity.note', source: 'other-device', summary: 'Conflict winner' };
  let getCount = 0;
  let putCount = 0;
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async (_url, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        getCount += 1;
        const conflicted = getCount > 1;
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              success: true,
              data: {
                schemaVersion: 2,
                updatedAt: conflicted ? '2026-08-02T00:01:00.000Z' : '2026-08-02T00:00:00.000Z',
                records: conflicted
                  ? { 'continuity::teaching': teaching, 'continuity::remote': remoteRecord }
                  : { 'continuity::teaching': teaching },
              },
            });
          },
        };
      }
      putCount += 1;
      const body = JSON.parse(options.body || '{}');
      if (putCount === 1) {
        return {
          ok: false,
          status: 409,
          async text() {
            return JSON.stringify({ success: false, error_code: 'DURABLE_MEMORY_CONFLICT', error: 'conflict' });
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ success: true, data: { ...body, updatedAt: '2026-08-02T00:02:00.000Z' } });
        },
      };
    },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  const result = await memory.deleteRecordDurably({ namespace: 'continuity', id: 'teaching' });

  assert.equal(result.authorityConfirmed, true);
  assert.equal(getCount, 2);
  assert.equal(putCount, 2);
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'teaching' }), null);
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'remote' })?.summary, 'Conflict winner');
});

test('authority refresh mirrors canonical records before a later durable mutation failure', async () => {
  const remoteRecord = {
    schemaVersion: 2,
    type: 'operator.preference',
    source: 'other-device',
    scope: 'runtime',
    summary: 'Remote teaching',
    payload: {},
    tags: ['tile.memory.candidate', 'tile.music-tile', 'explicit-teaching'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'hosted',
  };
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async (_url, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ success: true, data: {
              schemaVersion: 2,
              updatedAt: '2026-08-02T00:01:00.000Z',
              records: { 'continuity::remote-teaching': remoteRecord },
            } });
          },
        };
      }
      return {
        ok: false,
        status: 503,
        async text() { return JSON.stringify({ success: false, error: 'write unavailable' }); },
      };
    },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  await assert.rejects(memory.saveRecordDurably({
    namespace: 'continuity',
    id: 'new-teaching',
    type: 'operator.preference',
    summary: 'New teaching',
  }));

  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'remote-teaching' })?.summary, 'Remote teaching');
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'new-teaching' }), null);
});

test('durable record listing refreshes canonical authority before filtering owned records', async () => {
  const record = {
    schemaVersion: 2,
    type: 'operator.preference',
    source: 'music-tile',
    scope: 'runtime',
    summary: 'Shared music teaching',
    payload: { value: { id: 'music-teaching-remote', trait: 'ghost vocals', polarity: 'positive', status: 'active' } },
    tags: ['tile.memory.candidate', 'tile.music-tile', 'explicit-teaching'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'hosted',
  };
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: {
          schemaVersion: 2,
          updatedAt: '2026-08-02T00:01:00.000Z',
          records: { 'continuity::remote-teaching': record },
        } });
      },
    }),
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  const result = await memory.listRecordsDurably({ namespace: 'continuity', type: 'operator.preference', tag: 'tile.music-tile' });

  assert.equal(result.authorityConfirmed, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, 'remote-teaching');
});

test('legacy mirror writes queued behind authority refresh rebase instead of deleting fetched records', async () => {
  let releaseGet;
  let markGetStarted;
  let markPutFinished;
  const getGate = new Promise((resolve) => { releaseGet = resolve; });
  const getStarted = new Promise((resolve) => { markGetStarted = resolve; });
  const putFinished = new Promise((resolve) => { markPutFinished = resolve; });
  let writtenBody = null;
  const remoteRecord = {
    schemaVersion: 2,
    type: 'continuity.note',
    source: 'other-device',
    scope: 'runtime',
    summary: 'Remote record',
    payload: {},
    tags: ['shared'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'hosted',
  };
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async (_url, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        markGetStarted();
        await getGate;
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ success: true, data: {
              schemaVersion: 2,
              updatedAt: '2026-08-02T00:01:00.000Z',
              records: { 'continuity::remote': remoteRecord },
            } });
          },
        };
      }
      writtenBody = JSON.parse(options.body || '{}');
      markPutFinished();
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ success: true, data: { ...writtenBody, updatedAt: '2026-08-02T00:02:00.000Z' } });
        },
      };
    },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  const refresh = memory.listRecordsDurably({ namespace: 'continuity' });
  await getStarted;
  memory.saveRecord({
    namespace: 'continuity',
    id: 'local-event',
    type: 'tile.event',
    summary: 'Local event queued during refresh',
  });
  releaseGet();
  await refresh;
  await putFinished;

  assert.equal(writtenBody.ifUnmodifiedSince, '2026-08-02T00:01:00.000Z');
  assert.equal(writtenBody.records['continuity::remote'].summary, 'Remote record');
  assert.equal(writtenBody.records['continuity::local-event'].summary, 'Local event queued during refresh');
});

test('confirmed legacy writes preserve every later pending mirror intent', async () => {
  let releaseFirstPut;
  let releaseSecondPut;
  let markSecondPutStarted;
  const firstPutGate = new Promise((resolve) => { releaseFirstPut = resolve; });
  const secondPutGate = new Promise((resolve) => { releaseSecondPut = resolve; });
  const secondPutStarted = new Promise((resolve) => { markSecondPutStarted = resolve; });
  const writes = [];
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      writes.push(body);
      if (writes.length === 1) await firstPutGate;
      if (writes.length === 2) {
        markSecondPutStarted();
        await secondPutGate;
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ success: true, data: { ...body, updatedAt: `2026-08-02T00:0${writes.length}:00.000Z` } });
        },
      };
    },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  memory.saveRecord({ namespace: 'continuity', id: 'first', type: 'tile.event', summary: 'First pending record' });
  memory.saveRecord({ namespace: 'continuity', id: 'second', type: 'tile.event', summary: 'Second pending record' });
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'first' })?.summary, 'First pending record');
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'second' })?.summary, 'Second pending record');

  releaseFirstPut();
  await secondPutStarted;
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'first' })?.summary, 'First pending record');
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'second' })?.summary, 'Second pending record');
  assert.equal(writes[1].records['continuity::first'].summary, 'First pending record');
  assert.equal(writes[1].records['continuity::second'].summary, 'Second pending record');
  releaseSecondPut();
});

test('conflicted legacy intent is retried and preserved ahead of later queued writes', async () => {
  let markThirdPutFinished;
  const thirdPutFinished = new Promise((resolve) => { markThirdPutFinished = resolve; });
  const writes = [];
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async (_url, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ success: true, data: {
              schemaVersion: 2,
              updatedAt: '2026-08-02T00:01:00.000Z',
              records: {
                'continuity::remote': {
                  schemaVersion: 2,
                  type: 'continuity.note',
                  source: 'other-device',
                  scope: 'runtime',
                  summary: 'Remote record',
                  payload: {},
                  tags: ['shared'],
                  importance: 'normal',
                  retentionHint: 'default',
                  createdAt: '2026-08-02T00:00:00.000Z',
                  updatedAt: '2026-08-02T00:00:00.000Z',
                  surface: 'hosted',
                },
              },
            } });
          },
        };
      }
      const body = JSON.parse(options.body || '{}');
      writes.push(body);
      if (writes.length === 1) {
        return {
          ok: false,
          status: 409,
          async text() { return JSON.stringify({ success: false, error_code: 'DURABLE_MEMORY_CONFLICT' }); },
        };
      }
      if (writes.length === 3) markThirdPutFinished();
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ success: true, data: { ...body, updatedAt: `2026-08-02T00:0${writes.length}:00.000Z` } });
        },
      };
    },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  memory.saveRecord({ namespace: 'continuity', id: 'first', type: 'tile.event', summary: 'First pending record' });
  memory.saveRecord({ namespace: 'continuity', id: 'second', type: 'tile.event', summary: 'Second pending record' });
  await thirdPutFinished;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(writes.length, 3);
  assert.equal(writes[1].ifUnmodifiedSince, '2026-08-02T00:01:00.000Z');
  assert.equal(writes[1].records['continuity::remote'].summary, 'Remote record');
  assert.equal(writes[1].records['continuity::first'].summary, 'First pending record');
  assert.equal(writes[1].records['continuity::second'], undefined);
  assert.equal(writes[2].records['continuity::remote'].summary, 'Remote record');
  assert.equal(writes[2].records['continuity::first'].summary, 'First pending record');
  assert.equal(writes[2].records['continuity::second'].summary, 'Second pending record');
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'first' })?.summary, 'First pending record');
  assert.equal(memory.getRecord({ namespace: 'continuity', id: 'second' })?.summary, 'Second pending record');
});

test('atomic owned-set deletion rebases over a concurrent teaching and preserves unrelated records', async () => {
  const teaching = (summary) => ({
    schemaVersion: 2,
    type: 'operator.preference',
    source: 'music-tile',
    scope: 'runtime',
    summary,
    payload: {},
    tags: ['tile.memory.candidate', 'tile.music-tile', 'explicit-teaching'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    surface: 'hosted',
  });
  const unrelated = { ...teaching('Unrelated'), tags: ['tile.memory.candidate', 'tile.other-tile', 'explicit-teaching'] };
  let getCount = 0;
  let putCount = 0;
  const writes = [];
  const adapter = createStephanosSharedMemoryAdapter({
    storage: createStorage(),
    runtimeContext: { baseUrl: 'http://localhost:8787' },
    logger: { info() {} },
    fetchImpl: async (_url, options = {}) => {
      if ((options.method || 'GET') === 'GET') {
        getCount += 1;
        const records = {
          'continuity::tile-memory-music-tile-first': teaching('First teaching'),
          'continuity::tile-memory-other-tile-first': unrelated,
        };
        if (getCount > 1) records['continuity::tile-memory-music-tile-concurrent'] = teaching('Concurrent teaching');
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ success: true, data: { schemaVersion: 2, updatedAt: `2026-08-02T00:0${getCount}:00.000Z`, records } });
          },
        };
      }
      putCount += 1;
      const body = JSON.parse(options.body || '{}');
      writes.push(body);
      if (putCount === 1) {
        return {
          ok: false,
          status: 409,
          async text() { return JSON.stringify({ success: false, error_code: 'DURABLE_MEMORY_CONFLICT' }); },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ success: true, data: { ...body, updatedAt: '2026-08-02T00:03:00.000Z' } }); },
      };
    },
  });
  const memory = createStephanosMemory({ adapter, source: 'music-tile', surface: 'hosted' });

  const result = await memory.deleteRecordsDurably({
    namespace: 'continuity',
    idPrefix: 'tile-memory-music-tile-',
    type: 'operator.preference',
    tags: ['tile.memory.candidate', 'tile.music-tile', 'explicit-teaching'],
  });

  assert.equal(result.authorityConfirmed, true);
  assert.equal(result.deletedCount, 2);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].records['continuity::tile-memory-music-tile-first'], undefined);
  assert.equal(writes[1].records['continuity::tile-memory-music-tile-concurrent'], undefined);
  assert.equal(writes[1].records['continuity::tile-memory-other-tile-first'].summary, 'Unrelated');
});

test('shared memory adapter retains its projected local intent after an exhausted conflict retry', async () => {
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

  assert.equal(putCount, 2);
  assert.equal(adapter.readState().records['continuity::canonical'], undefined);
  assert.equal(adapter.readState().records['continuity::local-change'].summary, 'Stale local change');
  assert.equal(adapter.diagnostics().sourceUsedOnSave, 'local-mirror-fallback');
  assert.equal(adapter.diagnostics().fallbackReason, 'backend-memory-conflict-after-retry');
});
