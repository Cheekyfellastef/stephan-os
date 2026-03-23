import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverStephanosHomeNode, probeStephanosHomeNode } from './stephanosHomeNode.mjs';

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
