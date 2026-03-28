import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY,
  STEPHANOS_HOME_NODE_STORAGE_KEY,
} from './stephanosHomeNode.mjs';
import { createStephanosTileDataClient } from './tileDataContract.mjs';

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

test('tile data contract prefers shared backend and avoids legacy origin-local key when backend is available', async () => {
  const storage = createStorage({
    'legacy.tile.key': JSON.stringify({ version: 1, selection: { era: 'legacy' } }),
  });

  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if (!options.method || options.method === 'GET') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            data: {
              appId: 'music-tile',
              state: {
                version: 1,
                selection: { era: 'shared' },
              },
            },
          });
        },
      };
    }

    throw new Error('unexpected write');
  };

  const client = createStephanosTileDataClient({
    fetchImpl,
    storage,
    locationObj: {
      origin: 'https://hosted.example.com',
      hostname: 'hosted.example.com',
      port: '',
    },
    logger: { info() {} },
  });

  const loaded = await client.loadDurableState({
    appId: 'music-tile',
    schemaVersion: 1,
    defaultState: { version: 1, selection: { era: 'default' } },
    sanitizeState: (value) => value,
    legacyKeys: ['legacy.tile.key'],
  });

  assert.equal(loaded.source, 'shared-backend');
  assert.equal(loaded.state.selection.era, 'shared');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
});

test('tile data contract migrates legacy tile state into shared backend only when backend record is absent', async () => {
  const storage = createStorage({
    'legacy.tile.key': JSON.stringify({ version: 1, selection: { era: 'legacy' } }),
  });

  const methods = [];
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

    if (method === 'PUT') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ success: true, data: {} });
        },
      };
    }

    throw new Error('unexpected request');
  };

  const client = createStephanosTileDataClient({
    fetchImpl,
    storage,
    locationObj: {
      origin: 'http://127.0.0.1:4173',
      hostname: '127.0.0.1',
      port: '4173',
    },
    logger: { info() {} },
  });

  const loaded = await client.loadDurableState({
    appId: 'music-tile',
    schemaVersion: 1,
    defaultState: { version: 1, selection: { era: 'default' } },
    sanitizeState: (value) => value,
    legacyKeys: ['legacy.tile.key'],
  });

  assert.equal(loaded.migrated, true);
  assert.equal(loaded.source, 'legacy-migrated-to-shared-backend');
  assert.deepEqual(methods, ['GET', 'PUT']);
});

test('tile data contract does not migrate legacy when backend is unavailable but not 404', async () => {
  const storage = createStorage({
    'legacy.tile.key': JSON.stringify({ version: 1, selection: { era: 'legacy' } }),
  });

  const methods = [];
  const fetchImpl = async (_url, options = {}) => {
    methods.push(options.method || 'GET');
    return {
      ok: false,
      status: 503,
      async text() {
        return JSON.stringify({ success: false });
      },
    };
  };

  const client = createStephanosTileDataClient({
    fetchImpl,
    storage,
    locationObj: {
      origin: 'http://127.0.0.1:4173',
      hostname: '127.0.0.1',
      port: '4173',
    },
    logger: { info() {} },
  });

  const loaded = await client.loadDurableState({
    appId: 'music-tile',
    schemaVersion: 1,
    defaultState: { version: 1, selection: { era: 'default' } },
    sanitizeState: (value) => value,
    legacyKeys: ['legacy.tile.key'],
  });

  assert.equal(loaded.source, 'legacy-local-fallback');
  assert.equal(loaded.migrated, false);
  assert.deepEqual(methods, ['GET']);
});

test('tile data contract resolves hosted backend through persisted home-node backend URL', async () => {
  const storage = createStorage({
    [STEPHANOS_HOME_NODE_STORAGE_KEY]: JSON.stringify({
      host: '192.168.0.198',
      backendPort: 8787,
      uiPort: 5173,
      source: 'manual',
    }),
    [STEPHANOS_HOME_NODE_LAST_KNOWN_STORAGE_KEY]: JSON.stringify({
      host: '192.168.0.198',
      backendPort: 8787,
      uiPort: 5173,
      source: 'lastKnown',
    }),
  });

  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: { appId: 'wealthapp', state: { version: 1, inputs: {} } } });
      },
    };
  };

  const client = createStephanosTileDataClient({
    fetchImpl,
    storage,
    locationObj: {
      origin: 'https://hosted.example.com',
      hostname: 'hosted.example.com',
      port: '',
    },
    logger: { info() {} },
  });

  await client.loadDurableState({
    appId: 'wealthapp',
    schemaVersion: 1,
    defaultState: { version: 1, inputs: {} },
    sanitizeState: (value) => value,
  });

  assert.equal(client.apiBaseUrl, 'http://192.168.0.198:8787');
  assert.equal(urls[0], 'http://192.168.0.198:8787/api/tile-state/wealthapp');
});

test('tile data contract keeps localhost backend URL on localhost sessions', async () => {
  const storage = createStorage();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: { appId: 'wealthapp', state: { version: 1, inputs: {} } } });
      },
    };
  };

  const client = createStephanosTileDataClient({
    fetchImpl,
    storage,
    locationObj: {
      origin: 'http://127.0.0.1:4173',
      hostname: '127.0.0.1',
      port: '4173',
    },
    logger: { info() {} },
  });

  await client.loadDurableState({
    appId: 'wealthapp',
    schemaVersion: 1,
    defaultState: { version: 1, inputs: {} },
    sanitizeState: (value) => value,
  });

  assert.equal(client.apiBaseUrl, 'http://localhost:8787');
  assert.equal(urls[0], 'http://localhost:8787/api/tile-state/wealthapp');
});

test('tile data contract allows cross-surface durable save/load convergence via shared backend', async () => {
  const backendStore = new Map();
  const fetchImpl = async (url, options = {}) => {
    const appId = url.split('/').pop();
    const method = options.method || 'GET';
    if (method === 'PUT') {
      const payload = JSON.parse(options.body);
      backendStore.set(appId, payload.state);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ success: true, data: { appId, state: payload.state } });
        },
      };
    }

    if (!backendStore.has(appId)) {
      return {
        ok: false,
        status: 404,
        async text() {
          return JSON.stringify({ success: false, error: 'missing' });
        },
      };
    }

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: { appId, state: backendStore.get(appId) } });
      },
    };
  };

  const localhostClient = createStephanosTileDataClient({
    fetchImpl,
    storage: createStorage(),
    locationObj: { origin: 'http://127.0.0.1:4173', hostname: '127.0.0.1', port: '4173' },
    logger: { info() {} },
  });
  const hostedClient = createStephanosTileDataClient({
    fetchImpl,
    storage: createStorage({
      [STEPHANOS_HOME_NODE_STORAGE_KEY]: JSON.stringify({ host: '192.168.0.198', backendPort: 8787, uiPort: 5173, source: 'manual' }),
    }),
    locationObj: { origin: 'https://hosted.example.com', hostname: 'hosted.example.com', port: '' },
    logger: { info() {} },
  });

  await localhostClient.saveDurableState({
    appId: 'music-tile',
    state: { version: 1, selection: { era: 'localhost-write' } },
    sanitizeState: (value) => value,
  });

  const hostedLoad = await hostedClient.loadDurableState({
    appId: 'music-tile',
    defaultState: { version: 1, selection: { era: 'default' } },
    sanitizeState: (value) => value,
  });
  assert.equal(hostedLoad.state.selection.era, 'localhost-write');

  await hostedClient.saveDurableState({
    appId: 'music-tile',
    state: { version: 1, selection: { era: 'hosted-write' } },
    sanitizeState: (value) => value,
  });

  const localhostLoad = await localhostClient.loadDurableState({
    appId: 'music-tile',
    defaultState: { version: 1, selection: { era: 'default' } },
    sanitizeState: (value) => value,
  });
  assert.equal(localhostLoad.state.selection.era, 'hosted-write');
});
