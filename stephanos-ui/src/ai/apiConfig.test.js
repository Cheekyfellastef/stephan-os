import test from 'node:test';
import assert from 'node:assert/strict';
import { getApiRuntimeConfig, getApiRuntimeConfigSnapshotKey, resolveAdminAuthorityUrl } from './apiConfig.js';

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

test('getApiRuntimeConfig keeps hosted-web static shell sessions on localhost backend fallback when no home node exists', () => {
  const globals = installBrowserGlobals({
    origin: 'https://cheekyfellastef.github.io',
    storage: {},
  });

  try {
    const config = getApiRuntimeConfig();
    assert.equal(config.baseUrl, 'http://localhost:8787');
  } finally {
    globals.restore();
  }
});

test('getApiRuntimeConfig prefers persisted home bridge URL for hosted sessions', () => {
  const globals = installBrowserGlobals({
    origin: 'https://cheekyfellastef.github.io',
    storage: {
      stephanos_home_bridge_url: JSON.stringify('https://bridge.example.com'),
    },
  });

  try {
    const config = getApiRuntimeConfig();
    assert.equal(config.bridgeUrl, 'https://bridge.example.com');
    assert.equal(config.baseUrl, 'https://bridge.example.com');
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

test('resolveAdminAuthorityUrl forces loopback admin authority for local-desktop sessions', () => {
  const globals = installBrowserGlobals({
    origin: 'http://127.0.0.1:4173',
    storage: {
      stephanos_home_node_manual: JSON.stringify({
        host: '192.168.0.198',
        uiPort: 4173,
        backendPort: 8787,
        source: 'manual',
      }),
    },
  });

  try {
    const runtimeConfig = getApiRuntimeConfig();
    const authority = resolveAdminAuthorityUrl(runtimeConfig);
    assert.equal(authority.ok, true);
    assert.equal(authority.target, 'http://127.0.0.1:8787');
    assert.equal(authority.source, 'pc-local-admin');
  } finally {
    globals.restore();
  }
});

test('resolveAdminAuthorityUrl denies hosted sessions without local admin surface', () => {
  const globals = installBrowserGlobals({
    origin: 'https://cheekyfellastef.github.io',
    storage: {
      stephanos_home_node_manual: JSON.stringify({
        host: '192.168.0.198',
        uiPort: 4173,
        backendPort: 8787,
        source: 'manual',
      }),
    },
  });

  try {
    const runtimeConfig = getApiRuntimeConfig();
    const authority = resolveAdminAuthorityUrl(runtimeConfig);
    assert.equal(authority.ok, false);
    assert.equal(authority.reason, 'non-local-admin-route');
  } finally {
    globals.restore();
  }
});
