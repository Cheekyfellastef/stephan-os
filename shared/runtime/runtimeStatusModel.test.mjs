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
