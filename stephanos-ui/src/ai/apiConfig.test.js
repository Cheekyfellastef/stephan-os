import test from 'node:test';
import assert from 'node:assert/strict';
import { getApiRuntimeConfig, getApiRuntimeConfigSnapshotKey } from './apiConfig.js';

function installBrowserGlobals({ origin = 'https://cheekyfellastef.github.io', storage = {} } = {}) {
  const localStorage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
    },
    setItem(key, value) {
      storage[key] = String(value);
    },
    removeItem(key) {
      delete storage[key];
    },
  };

  globalThis.window = {
    location: {
      origin,
    },
    localStorage,
  };
  globalThis.localStorage = localStorage;

  return {
    storage,
    restore() {
      delete globalThis.window;
      delete globalThis.localStorage;
    },
  };
}

test('getApiRuntimeConfigSnapshotKey stays stable for equivalent direct-dist bootstrap state', () => {
  const globals = installBrowserGlobals({
    origin: 'https://cheekyfellastef.github.io',
    storage: {},
  });

  try {
    const firstConfig = getApiRuntimeConfig();
    const secondConfig = getApiRuntimeConfig();

    assert.deepEqual(secondConfig, firstConfig);
    assert.equal(
      getApiRuntimeConfigSnapshotKey(firstConfig),
      getApiRuntimeConfigSnapshotKey(secondConfig),
    );
  } finally {
    globals.restore();
  }
});

test('getApiRuntimeConfigSnapshotKey changes when the preferred home node changes', () => {
  const globals = installBrowserGlobals({
    origin: 'https://cheekyfellastef.github.io',
    storage: {
      stephanos_home_node_manual: JSON.stringify({
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        source: 'manual',
      }),
    },
  });

  try {
    const firstKey = getApiRuntimeConfigSnapshotKey(getApiRuntimeConfig());

    globals.storage.stephanos_home_node_manual = JSON.stringify({
      host: '192.168.0.199',
      uiPort: 5173,
      backendPort: 8787,
      source: 'manual',
    });

    const secondKey = getApiRuntimeConfigSnapshotKey(getApiRuntimeConfig());

    assert.notEqual(secondKey, firstKey);
  } finally {
    globals.restore();
  }
});

test('getApiRuntimeConfig keeps hosted-web sessions on current origin when no home node exists', () => {
  const globals = installBrowserGlobals({
    origin: 'https://cheekyfellastef.github.io',
    storage: {},
  });

  try {
    const config = getApiRuntimeConfig();
    assert.equal(config.baseUrl, 'https://cheekyfellastef.github.io');
    assert.notEqual(config.baseUrl, 'http://localhost:8787');
  } finally {
    globals.restore();
  }
});

test('getApiRuntimeConfig keeps local-desktop localhost fallback for loopback origins', () => {
  const globals = installBrowserGlobals({
    origin: 'http://localhost:5173',
    storage: {},
  });

  try {
    const config = getApiRuntimeConfig();
    assert.equal(config.baseUrl, 'http://localhost:8787');
  } finally {
    globals.restore();
  }
});
