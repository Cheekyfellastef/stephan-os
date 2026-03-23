import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeStatusModel } from './runtimeStatusModel.mjs';

test('createRuntimeStatusModel treats LAN sessions with loopback backend leakage as hosted-web and prefers home-node targets', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: false },
      gemini: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'http://192.168.0.55:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
    },
  });

  assert.equal(status.runtimeModeLabel, 'hosted/web');
  assert.equal(status.runtimeContext.sessionKind, 'hosted-web');
  assert.equal(status.runtimeContext.deviceContext, 'lan-companion');
  assert.equal(status.preferredTarget, 'http://192.168.0.198:5173/');
  assert.equal(status.actualTargetUsed, 'http://192.168.0.198:8787');
  assert.equal(status.nodeAddressSource, 'manual');
  assert.notEqual(status.preferredTarget, 'http://localhost:8787');
});

test('createRuntimeStatusModel keeps localhost routing for PC-local desktop sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'http://localhost:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'local-backend-session',
    },
  });

  assert.equal(status.runtimeModeLabel, 'local desktop/dev');
  assert.equal(status.runtimeContext.sessionKind, 'local-desktop');
  assert.equal(status.preferredTarget, 'http://localhost:8787');
  assert.equal(status.actualTargetUsed, 'http://localhost:8787');
  assert.equal(status.nodeAddressSource, 'local-backend-session');
});


test('createRuntimeStatusModel preserves explicit discard reasons when loopback route state is ignored on LAN sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: false },
      gemini: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'http://192.168.0.55:5173',
      apiBaseUrl: 'http://localhost:8787',
      preferredTarget: 'http://localhost:8787',
      actualTargetUsed: 'http://localhost:8787',
      nodeAddressSource: 'manual',
      restoreDecision: 'Ignored loopback backend target for non-local session; using current home-node/network context instead.',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
    },
  });

  assert.equal(status.runtimeContext.restoreDecision, 'Ignored loopback backend target for non-local session; using current home-node/network context instead.');
  assert.equal(status.runtimeModeLabel, 'hosted/web');
  assert.equal(status.routeKind, 'unavailable');
  assert.equal(status.preferredTarget, 'http://192.168.0.198:5173/');
});


test('createRuntimeStatusModel keeps manual node source and explicit failure reason when home-node probe fails on hosted web', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: false },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: false,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: '',
      preferredTarget: 'https://cheekyfellastef.github.io',
      actualTargetUsed: 'https://cheekyfellastef.github.io',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          reason: 'Manual home-node 192.168.0.198 failed: probe timeout.',
          blockedReason: 'Manual home-node 192.168.0.198 failed: probe timeout.',
        },
      },
    },
  });

  assert.equal(status.routeKind, 'unavailable');
  assert.equal(status.nodeAddressSource, 'manual');
  assert.match(status.routeSummary, /probe timeout/i);
  assert.match(status.dependencySummary, /home pc node unavailable/i);
});

test('createRuntimeStatusModel does not let cloud selection overwrite manual node source on hosted sessions', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    providerHealth: {
      groq: { ok: true },
      gemini: { ok: false },
      ollama: { ok: false },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://cheekyfellastef.github.io',
      apiBaseUrl: 'https://api.example.com',
      preferredTarget: 'https://cheekyfellastef.github.io',
      actualTargetUsed: 'https://api.example.com',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        uiPort: 5173,
        backendPort: 8787,
        uiUrl: 'http://192.168.0.198:5173/',
        backendUrl: 'http://192.168.0.198:8787',
        source: 'manual',
        configured: true,
        reachable: false,
      },
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          source: 'backend-cloud-session',
          target: 'https://cheekyfellastef.github.io',
          actualTarget: 'https://api.example.com',
          reason: 'A cloud-backed Stephanos route is ready',
        },
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          blockedReason: 'Manual home-node 192.168.0.198 failed: unreachable host.',
        },
      },
    },
  });

  assert.equal(status.routeKind, 'cloud');
  assert.equal(status.nodeAddressSource, 'manual');
});
