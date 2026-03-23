import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRuntimeContext, resolveRoutingPlan } from '../services/llm/utils/providerUtils.js';

test('provider utils classify hosted LAN sessions as lan companions when the home node is reachable', () => {
  const runtimeContext = normalizeRuntimeContext({
    frontendOrigin: 'https://cheekyfellastef.github.io',
    apiBaseUrl: 'http://192.168.0.198:8787',
    nodeAddressSource: 'manual',
    homeNode: {
      host: '192.168.0.198',
      backendPort: 8787,
      source: 'manual',
      reachable: true,
    },
    routeDiagnostics: {
      'home-node': {
        configured: true,
        available: true,
        source: 'manual',
      },
    },
  });

  assert.equal(runtimeContext.deviceContext, 'lan-companion');
  assert.equal(runtimeContext.sessionKind, 'hosted-web');
  assert.equal(runtimeContext.nodeAddressSource, 'manual');
});

test('provider routing keeps auto mode local-first for reachable LAN home-node sessions', () => {
  const routing = resolveRoutingPlan({
    provider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    fallbackOrder: ['groq', 'mock'],
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'http://192.168.0.198:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        backendPort: 8787,
        source: 'manual',
        reachable: true,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          source: 'manual',
        },
      },
    },
  }, {
    ollama: { ok: true },
    groq: { ok: true },
    mock: { ok: true },
  });

  assert.equal(routing.effectiveRouteMode, 'local-first');
  assert.equal(routing.selectedProvider, 'ollama');
  assert.deepEqual(routing.readyLocalProviders, ['ollama']);
});

test('provider utils promote loopback backend sessions to local-desktop even from hosted origins', () => {
  const runtimeContext = normalizeRuntimeContext({
    frontendOrigin: 'https://cheekyfellastef.github.io',
    apiBaseUrl: 'http://localhost:8787',
    nodeAddressSource: 'local-backend-session',
    routeDiagnostics: {
      'local-desktop': {
        configured: true,
        available: true,
        source: 'local-backend-session',
      },
    },
  });

  assert.equal(runtimeContext.deviceContext, 'pc-local-browser');
  assert.equal(runtimeContext.sessionKind, 'local-desktop');
});
