import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPersistedStephanosHostedExecutionBridgeUrl,
  persistStephanosHostedExecutionBridgeUrl,
  readPersistedStephanosHostedExecutionBridgeUrl,
} from '../shared/runtime/stephanosHomeNode.mjs';
import { requestStephanosBackend, resolveStephanosBackendClientBaseUrl } from '../shared/runtime/backendClient.mjs';
import { createStephanosTileDataClient } from '../shared/runtime/tileDataContract.mjs';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('hosted execution bridge persists only HTTPS backend origins', () => {
  const storage = createStorage();
  const frontendOrigin = 'https://cheekyfellastef.github.io';

  const rejected = persistStephanosHostedExecutionBridgeUrl('http://100.100.100.100:8787', storage, { frontendOrigin });
  assert.equal(rejected.ok, false);
  assert.equal(readPersistedStephanosHostedExecutionBridgeUrl(storage, { frontendOrigin }), '');

  const saved = persistStephanosHostedExecutionBridgeUrl('https://battle-bridge.example.ts.net', storage, { frontendOrigin });
  assert.equal(saved.ok, true);
  assert.equal(saved.normalizedUrl, 'https://battle-bridge.example.ts.net');
  assert.equal(readPersistedStephanosHostedExecutionBridgeUrl(storage, { frontendOrigin }), 'https://battle-bridge.example.ts.net');

  clearPersistedStephanosHostedExecutionBridgeUrl(storage);
  assert.equal(readPersistedStephanosHostedExecutionBridgeUrl(storage, { frontendOrigin }), '');
});

test('hosted backend client resolves persisted HTTPS execution bridge', () => {
  const storage = createStorage();
  const frontendOrigin = 'https://cheekyfellastef.github.io';
  persistStephanosHostedExecutionBridgeUrl('https://battle-bridge.example.ts.net', storage, { frontendOrigin });

  const baseUrl = resolveStephanosBackendClientBaseUrl({
    frontendOrigin,
    storage,
  });

  assert.equal(baseUrl, 'https://battle-bridge.example.ts.net');
});

test('shared tile data client resolves persisted HTTPS execution bridge', () => {
  const storage = createStorage();
  const frontendOrigin = 'https://cheekyfellastef.github.io';
  persistStephanosHostedExecutionBridgeUrl('https://battle-bridge.example.ts.net', storage, { frontendOrigin });

  const client = createStephanosTileDataClient({
    storage,
    locationObj: {
      origin: frontendOrigin,
      hostname: 'cheekyfellastef.github.io',
    },
    fetchImpl: async () => {
      throw new Error('not used');
    },
    logger: { info() {} },
  });

  assert.equal(client.apiBaseUrl, 'https://battle-bridge.example.ts.net');
});


test('hosted backend client fails closed when no HTTPS execution bridge is configured', async () => {
  const storage = createStorage();
  const frontendOrigin = 'https://cheekyfellastef.github.io';

  const baseUrl = resolveStephanosBackendClientBaseUrl({
    frontendOrigin,
    storage,
    bridgeUrl: 'http://100.100.100.100:8787',
  });
  assert.equal(baseUrl, '');

  await assert.rejects(
    requestStephanosBackend({
      path: '/api/shared-workspace/dashboard-feed',
      runtimeContext: {
        frontendOrigin,
        storage,
        bridgeUrl: 'http://100.100.100.100:8787',
      },
      fetchImpl: async () => {
        throw new Error('fetch should not run');
      },
    }),
    (error) => error?.code === 'hosted-backend-route-unavailable',
  );
});

test('shared tile data client does not point a hosted page at phone localhost when bridge is absent', () => {
  const storage = createStorage();
  const client = createStephanosTileDataClient({
    storage,
    locationObj: {
      origin: 'https://cheekyfellastef.github.io',
      protocol: 'https:',
      hostname: 'cheekyfellastef.github.io',
    },
    fetchImpl: async () => {
      throw new Error('not used');
    },
    logger: { info() {} },
  });

  assert.equal(client.apiBaseUrl, '');
});
