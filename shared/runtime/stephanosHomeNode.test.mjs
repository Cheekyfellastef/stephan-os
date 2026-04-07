import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_HOME_BRIDGE_STORAGE_KEY,
  STEPHANOS_HOME_NODE_STORAGE_KEY,
  clearPersistedStephanosHomeBridgeUrl,
  isMalformedStephanosHost,
  normalizeStephanosHomeNode,
  persistStephanosHomeBridgeUrl,
  readPersistedStephanosHomeBridgeUrl,
  resolveStephanosBackendBaseUrl,
  discoverStephanosHomeNode,
  probeStephanosHomeNode,
  readPersistedStephanosHomeNode,
  setStephanosHomeBridgeGlobal,
  validateStephanosBackendTargetUrl,
  validateStephanosHomeBridgeUrl,
} from './stephanosHomeNode.mjs';

test('probeStephanosHomeNode keeps reachable manual LAN backend even when health payload publishes localhost backend values', async () => {
  const probe = await probeStephanosHomeNode({
    host: '192.168.0.198',
    backendPort: 8787,
    source: 'manual',
  }, {
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          ok: true,
          service: 'stephanos-server',
          api_status: 'online',
          backend_base_url: 'http://localhost:8787',
          backend_target_endpoint: 'http://localhost:8787/api/ai/chat',
        });
      },
      json: async () => ({
        ok: true,
        service: 'stephanos-server',
        api_status: 'online',
        backend_base_url: 'http://localhost:8787',
        backend_target_endpoint: 'http://localhost:8787/api/ai/chat',
      }),
    }),
  });

  assert.equal(probe.ok, true);
  assert.equal(probe.node?.reachable, true);
  assert.equal(probe.node?.source, 'manual');
  assert.equal(probe.node?.backendUrl, 'http://192.168.0.198:8787');
  assert.equal(probe.node?.backendHealthUrl, 'http://192.168.0.198:8787/api/health');
});

test('discoverStephanosHomeNode reports manual reachable LAN node as available even when health payload contains localhost internals', async () => {
  const discovery = await discoverStephanosHomeNode({
    currentOrigin: 'https://cheekyfellastef.github.io',
    manualNode: {
      host: '192.168.0.198',
      backendPort: 8787,
      uiPort: 5173,
      source: 'manual',
    },
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          ok: true,
          service: 'stephanos-server',
          api_status: 'online',
          backend_base_url: 'http://localhost:8787',
          backend_target_endpoint: 'http://localhost:8787/api/ai/chat',
        });
      },
      json: async () => ({
        ok: true,
        service: 'stephanos-server',
        api_status: 'online',
        backend_base_url: 'http://localhost:8787',
        backend_target_endpoint: 'http://localhost:8787/api/ai/chat',
      }),
    }),
  });

  assert.equal(discovery.reachable, true);
  assert.equal(discovery.status, 'available');
  assert.equal(discovery.source, 'manual');
  assert.equal(discovery.preferredNode?.source, 'manual');
  assert.equal(discovery.preferredNode?.reachable, true);
  assert.equal(discovery.preferredNode?.backendUrl, 'http://192.168.0.198:8787');
});

test('normalizeStephanosHomeNode rejects malformed numeric host values', () => {
  const normalized = normalizeStephanosHomeNode({
    host: 1,
    source: 'manual',
  }, { source: 'manual' });

  assert.equal(normalized.configured, false);
  assert.equal(normalized.host, '');
  assert.equal(normalized.backendUrl, '');
});

test('isMalformedStephanosHost rejects numeric shorthand canonicalized to 0.0.0.1', () => {
  assert.equal(isMalformedStephanosHost('0.0.0.1'), true);
  assert.equal(isMalformedStephanosHost('192.168.0.198'), false);
});

test('validateStephanosBackendTargetUrl rejects http://1:8787 for hosted sessions', () => {
  const validation = validateStephanosBackendTargetUrl('http://1:8787', { allowLoopback: false });

  assert.equal(validation.ok, false);
  assert.match(validation.reason, /malformed|unresolved/i);
});

test('validateStephanosHomeBridgeUrl enforces https and non-frontend-origin bridge URLs', () => {
  const valid = validateStephanosHomeBridgeUrl('https://bridge.example.com', {
    frontendOrigin: 'https://cheekyfellastef.github.io',
    requireHttps: true,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.normalizedUrl, 'https://bridge.example.com');

  const invalidProtocol = validateStephanosHomeBridgeUrl('http://bridge.example.com', {
    frontendOrigin: 'https://cheekyfellastef.github.io',
    requireHttps: true,
  });
  assert.equal(invalidProtocol.ok, false);
  assert.match(invalidProtocol.reason, /https/i);

  const invalidSameOrigin = validateStephanosHomeBridgeUrl('https://cheekyfellastef.github.io', {
    frontendOrigin: 'https://cheekyfellastef.github.io',
    requireHttps: true,
  });
  assert.equal(invalidSameOrigin.ok, false);
  assert.match(invalidSameOrigin.reason, /must not equal the frontend shell origin/i);
});

test('resolveStephanosBackendBaseUrl ignores malformed explicit backend target and falls back to valid manual home-node', () => {
  const resolved = resolveStephanosBackendBaseUrl({
    currentOrigin: 'https://cheekyfellastef.github.io',
    explicitBaseUrl: 'http://1:8787',
    manualNode: { host: '192.168.0.198', backendPort: 8787, source: 'manual' },
  });

  assert.equal(resolved, 'http://192.168.0.198:8787');
});

test('normalizeStephanosHomeNode rejects malformed backendUrl publication candidates and keeps canonical host backend URL', () => {
  const normalized = normalizeStephanosHomeNode({
    host: '192.168.0.198',
    backendPort: 8787,
    backendUrl: 'http://1:8787',
    source: 'manual',
  }, { source: 'manual' });

  assert.equal(normalized.host, '192.168.0.198');
  assert.equal(normalized.backendUrl, 'http://192.168.0.198:8787');
  assert.equal(normalized.backendHealthUrl, 'http://192.168.0.198:8787/api/health');
});

test('readPersistedStephanosHomeNode clears malformed stored manual host values', () => {
  const storage = {
    values: new Map([[STEPHANOS_HOME_NODE_STORAGE_KEY, JSON.stringify({ host: 1, backendPort: 8787, source: 'manual' })]]),
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, value);
    },
    removeItem(key) {
      this.values.delete(key);
    },
  };

  const restored = readPersistedStephanosHomeNode(storage);

  assert.equal(restored, null);
  assert.equal(storage.getItem(STEPHANOS_HOME_NODE_STORAGE_KEY), null);
});

test('persist/read/clear Home Bridge URL stores canonical URL and syncs global bridge truth', () => {
  const storage = {
    values: new Map(),
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, value);
    },
    removeItem(key) {
      this.values.delete(key);
    },
  };

  const persistResult = persistStephanosHomeBridgeUrl('https://bridge.example.com/path', storage);
  assert.equal(persistResult.ok, true);
  assert.equal(storage.getItem(STEPHANOS_HOME_BRIDGE_STORAGE_KEY), JSON.stringify('https://bridge.example.com'));
  assert.equal(readPersistedStephanosHomeBridgeUrl(storage), 'https://bridge.example.com');

  const globalValue = setStephanosHomeBridgeGlobal('https://bridge.example.com');
  assert.equal(globalValue, 'https://bridge.example.com');
  assert.equal(globalThis.__STEPHANOS_HOME_BRIDGE_URL, 'https://bridge.example.com');

  clearPersistedStephanosHomeBridgeUrl(storage);
  setStephanosHomeBridgeGlobal('');
  assert.equal(storage.getItem(STEPHANOS_HOME_BRIDGE_STORAGE_KEY), null);
  assert.equal(globalThis.__STEPHANOS_HOME_BRIDGE_URL, undefined);
});
