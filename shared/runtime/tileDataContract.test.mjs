import test from 'node:test';
import assert from 'node:assert/strict';
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

test('tile data contract migrates legacy tile state into shared backend when backend record is missing', async () => {
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
