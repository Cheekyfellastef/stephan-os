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


test('provider routing leaves home-node adoption semantics untouched while shared runtime truth stays remote-safe', () => {
  const routing = resolveRoutingPlan({
    provider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    fallbackOrder: ['groq', 'mock'],
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
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
          actualTarget: 'http://192.168.0.198:8787',
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
  assert.equal(routing.runtimeContext.actualTargetUsed, 'http://192.168.0.198:8787');
  assert.equal(routing.runtimeContext.preferredTarget, 'http://192.168.0.198:5173/');
});

test('provider routing picks Gemini for auto high-freshness requests when Gemini grounding is available', () => {
  const routing = resolveRoutingPlan({
    provider: 'ollama',
    routeMode: 'auto',
    freshnessContext: { freshnessNeed: 'high' },
    runtimeContext: {},
  }, {
    ollama: { ok: true },
    gemini: {
      ok: true,
      providerCapability: {
        supportsFreshWeb: true,
      },
    },
    groq: { ok: true, providerCapability: { supportsFreshWeb: false } },
  });

  assert.equal(routing.selectedProvider, 'gemini');
  assert.equal(routing.effectiveRouteMode, 'cloud-fresh');
  assert.equal(routing.providerSelectionSource, 'auto:fresh-capable');
});

test('provider routing falls back to ollama for auto high-freshness requests when no fresh-capable provider is executable', () => {
  const routing = resolveRoutingPlan({
    provider: 'ollama',
    routeMode: 'auto',
    freshnessContext: { freshnessNeed: 'high' },
    runtimeContext: {},
  }, {
    ollama: { ok: true },
    gemini: {
      ok: true,
      providerCapability: {
        supportsFreshWeb: false,
      },
    },
    groq: { ok: true, providerCapability: { supportsFreshWeb: false } },
  });

  assert.equal(routing.selectedProvider, 'ollama');
  assert.equal(routing.effectiveRouteMode, 'local-first-fallback');
  assert.equal(routing.providerSelectionSource, 'auto:freshness-fallback');
  assert.match(routing.freshnessWarning || '', /stale/i);
});
