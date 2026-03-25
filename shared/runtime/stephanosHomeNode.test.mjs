import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_HOME_NODE_STORAGE_KEY,
  normalizeStephanosHomeNode,
  discoverStephanosHomeNode,
  probeStephanosHomeNode,
  readPersistedStephanosHomeNode,
} from './stephanosHomeNode.mjs';

test('probeStephanosHomeNode keeps reachable manual LAN backend even when health payload publishes localhost backend values', async () => {
  const probe = await probeStephanosHomeNode({
    host: '192.168.0.198',
    backendPort: 8787,
    source: 'manual',
  }, {
    fetchImpl: async () => ({
      ok: true,
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
