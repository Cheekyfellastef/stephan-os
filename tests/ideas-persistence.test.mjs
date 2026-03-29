import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdeasPersistence, LEGACY_STORAGE_KEY } from '../apps/ideas/ideas-persistence.js';
import { createStephanosTileDataClient } from '../shared/runtime/tileDataContract.mjs';

function createStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function createSharedBackendHarness() {
  const durableStore = new Map();
  const apiBaseUrl = 'http://192.168.0.198:8787';

  function createClient() {
    return {
      apiBaseUrl,
      async loadDurableState({ appId, defaultState }) {
        if (!durableStore.has(appId)) {
          return {
            source: 'default-state',
            state: defaultState,
            diagnostics: { status: 404 },
          };
        }

        return {
          source: 'shared-backend',
          state: durableStore.get(appId),
          diagnostics: { status: 200 },
        };
      },
      async saveDurableState({ appId, state }) {
        durableStore.set(appId, state);
        return {
          ok: true,
          source: 'shared-backend',
        };
      },
    };
  }

  return {
    durableStore,
    apiBaseUrl,
    createClient,
  };
}

test('localhost and hosted load converge on same shared durable Ideas data and ignore local-only fallback', async () => {
  const backend = createSharedBackendHarness();

  const localhostStorage = createStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({
      records: [{ id: 'legacy_local', title: 'Legacy local only' }],
    }),
  });

  const hostedStorage = createStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({
      records: [{ id: 'legacy_hosted', title: 'Legacy hosted only' }],
    }),
  });

  const localhost = createIdeasPersistence({
    localStorage: localhostStorage,
    StephanosTileDataContract: { client: backend.createClient() },
    console: { info() {} },
  });

  const hosted = createIdeasPersistence({
    localStorage: hostedStorage,
    StephanosTileDataContract: { client: backend.createClient() },
    console: { info() {} },
  });

  await localhost.saveState({
    state: {
      records: [{ id: 'shared_1', title: 'Shared record', updatedAt: '2026-03-28T00:00:00.000Z' }],
    },
    hydrationCompleted: true,
  });

  const hostedLoaded = await hosted.loadStateWithMeta();
  assert.equal(hostedLoaded.meta.source, 'shared-backend');
  assert.equal(hostedLoaded.state.records.length, 1);
  assert.equal(hostedLoaded.state.records[0].id, 'shared_1');

  await hosted.saveState({
    state: {
      records: [{ id: 'shared_2', title: 'Hosted edit', updatedAt: '2026-03-28T00:01:00.000Z' }],
    },
    hydrationCompleted: true,
  });

  const localhostLoaded = await localhost.loadStateWithMeta();
  assert.equal(localhostLoaded.meta.source, 'shared-backend');
  assert.equal(localhostLoaded.state.records.length, 1);
  assert.equal(localhostLoaded.state.records[0].id, 'shared_2');
});

test('Ideas save is blocked before hydration completes', async () => {
  const backend = createSharedBackendHarness();
  const persistence = createIdeasPersistence({
    localStorage: createStorage(),
    StephanosTileDataContract: { client: backend.createClient() },
    console: { info() {} },
  });

  const skipped = await persistence.saveState({
    state: {
      records: [{ id: 'pre_hydration', title: 'Should not persist' }],
    },
    hydrationCompleted: false,
  });

  assert.equal(skipped.skipped, true);
  assert.equal(backend.durableStore.size, 0);
});

test('Ideas legacy migration to shared backend happens only when backend record is absent (404)', async () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({
      records: [{ id: 'legacy_migrate', title: 'Legacy migrate me' }],
    }),
  });

  const methods = [];
  let storedState = null;
  const fetchImpl = async (_url, options = {}) => {
    const method = options.method || 'GET';
    methods.push(method);

    if (method === 'GET') {
      return {
        ok: false,
        status: 404,
        async text() {
          return JSON.stringify({ success: false });
        },
      };
    }

    storedState = JSON.parse(options.body).state;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: { state: storedState } });
      },
    };
  };

  const tileDataClient = createStephanosTileDataClient({
    fetchImpl,
    storage,
    locationObj: { origin: 'http://127.0.0.1:4173' },
    logger: { info() {} },
  });

  const persistence = createIdeasPersistence({
    localStorage: storage,
    StephanosTileDataContract: { client: tileDataClient },
    console: { info() {} },
  });

  const loaded = await persistence.loadStateWithMeta();
  assert.equal(loaded.meta.source, 'legacy-migrated-to-shared-backend');
  assert.deepEqual(methods, ['GET', 'PUT']);
  assert.equal(storedState.records[0].id, 'legacy_migrate');
});

test('Ideas does not migrate legacy when backend has authoritative record', async () => {
  const storage = createStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({
      records: [{ id: 'legacy_must_lose', title: 'Should be ignored' }],
    }),
  });

  const methods = [];
  const fetchImpl = async (_url, options = {}) => {
    const method = options.method || 'GET';
    methods.push(method);

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          data: {
            state: {
              records: [{ id: 'backend_truth', title: 'Authoritative backend record' }],
            },
          },
        });
      },
    };
  };

  const tileDataClient = createStephanosTileDataClient({
    fetchImpl,
    storage,
    locationObj: { origin: 'https://hosted.example.com' },
    logger: { info() {} },
  });

  const persistence = createIdeasPersistence({
    localStorage: storage,
    StephanosTileDataContract: { client: tileDataClient },
    console: { info() {} },
  });

  const loaded = await persistence.loadStateWithMeta();
  assert.equal(loaded.meta.source, 'shared-backend');
  assert.equal(loaded.state.records[0].id, 'backend_truth');
  assert.deepEqual(methods, ['GET']);
});

test('local UI state remains separate from shared durable Ideas data payload', async () => {
  const backend = createSharedBackendHarness();
  const storage = createStorage({
    'stephanos.ideas.ui.local.v1': JSON.stringify({ draftFilter: 'vr' }),
  });

  const persistence = createIdeasPersistence({
    localStorage: storage,
    StephanosTileDataContract: { client: backend.createClient() },
    console: { info() {} },
  });

  await persistence.saveState({
    state: {
      records: [{ id: 'shared_ui_split', title: 'Durable idea' }],
    },
    ui: {
      expandedCard: 'shared_ui_split',
    },
    hydrationCompleted: true,
  });

  assert.deepEqual(backend.durableStore.get('ideas'), {
    records: [{ id: 'shared_ui_split', title: 'Durable idea', summary: '', tags: [], media: [], createdAt: '', updatedAt: '' }],
  });

  const loaded = await persistence.loadStateWithMeta();
  assert.deepEqual(loaded.ui, { expandedCard: 'shared_ui_split' });
});

test('localhost and hosted edit/save converge on the same durable idea identity', async () => {
  const backend = createSharedBackendHarness();
  const localhost = createIdeasPersistence({
    localStorage: createStorage(),
    StephanosTileDataContract: { client: backend.createClient() },
    console: { info() {} },
  });
  const hosted = createIdeasPersistence({
    localStorage: createStorage(),
    StephanosTileDataContract: { client: backend.createClient() },
    console: { info() {} },
  });

  await localhost.saveState({
    state: {
      records: [{
        id: 'idea_sync_1',
        title: 'Initial shared idea',
        summary: 'initial',
        updatedAt: '2026-03-29T00:00:00.000Z',
      }],
    },
    hydrationCompleted: true,
  });

  await hosted.saveState({
    state: {
      records: [{
        id: 'idea_sync_1',
        title: 'Hosted edited shared idea',
        summary: 'hosted edit',
        updatedAt: '2026-03-29T00:01:00.000Z',
      }],
    },
    hydrationCompleted: true,
  });

  const localhostLoaded = await localhost.loadStateWithMeta();
  assert.equal(localhostLoaded.meta.source, 'shared-backend');
  assert.equal(localhostLoaded.state.records.length, 1);
  assert.equal(localhostLoaded.state.records[0].id, 'idea_sync_1');
  assert.equal(localhostLoaded.state.records[0].title, 'Hosted edited shared idea');
});
