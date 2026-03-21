import test from 'node:test';
import assert from 'node:assert/strict';

import { FALLBACK_PROVIDER_KEYS } from '../../shared/ai/providerDefaults.mjs';
import { createRuntimeStatusModel, getReadyCloudProviders } from '../../shared/runtime/runtimeStatusModel.mjs';

test('default fallback order prefers cloud providers before mock', () => {
  assert.deepEqual(FALLBACK_PROVIDER_KEYS, ['groq', 'gemini', 'mock', 'ollama']);
});

test('runtime status uses cloud-first in hosted auto mode when home node is unavailable and cloud is ready', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: true },
      gemini: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: { frontendOrigin: 'https://stephanos.example', apiBaseUrl: 'https://api.stephanos.example' },
  });

  assert.equal(model.effectiveRouteMode, 'cloud-first');
  assert.equal(model.activeProvider, 'groq');
  assert.equal(model.cloudAvailable, true);
  assert.equal(model.localAvailable, false);
  assert.equal(model.fallbackActive, false);
  assert.equal(model.appLaunchState, 'ready');
  assert.equal(model.routeKind, 'cloud');
  assert.equal(model.dependencySummary, 'A cloud-backed Stephanos route is ready');
});

test('runtime status surfaces pending local discovery instead of stale offline', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: false, state: 'SEARCHING' },
      groq: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
  });

  assert.equal(model.localPending, true);
  assert.equal(model.localAvailable, false);
  assert.equal(model.appLaunchState, 'degraded');
  assert.equal(model.dependencySummary, 'Checking local Ollama readiness');
});

test('runtime status reports no reachable route when local desktop backend is offline', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: false,
    validationState: 'healthy',
  });

  assert.equal(model.appLaunchState, 'degraded');
  assert.equal(model.statusTone, 'degraded');
  assert.equal(model.routeKind, 'unavailable');
  assert.equal(model.dependencySummary, 'No reachable Stephanos route');
});

test('ready cloud provider list still filters only healthy cloud providers', () => {
  assert.deepEqual(getReadyCloudProviders({ gemini: { ok: true }, groq: { ok: false } }), ['gemini']);
});

test('runtime status surfaces a reachable home PC node separately from local desktop', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787, source: 'lastKnown', reachable: true },
      preferredTarget: 'http://192.168.1.42:5173/',
      actualTargetUsed: 'http://192.168.1.42:8787',
    },
  });

  assert.equal(model.routeKind, 'home-node');
  assert.equal(model.preferredRoute, 'home-node');
  assert.equal(model.homeNodeReachable, true);
  assert.equal(model.preferredTarget, 'http://192.168.1.42:5173/');
  assert.equal(model.actualTargetUsed, 'http://192.168.1.42:8787');
  assert.equal(model.nodeAddressSource, 'lastKnown');
  assert.equal(model.dependencySummary, 'Home PC node is reachable on the LAN');
});

test('pc/local browser prefers local-desktop when backend is online even if home-node is unavailable', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
      ollama: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787, source: 'manual', reachable: false },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          reason: 'Home PC node is configured but currently unreachable',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.preferredRoute, 'local-desktop');
  assert.equal(model.routeEvaluations['local-desktop'].available, true);
  assert.equal(model.routeEvaluations['home-node'].available, false);
  assert.match(model.dependencySummary, /optional home-node is unavailable/i);
  assert.equal(model.nodeAddressSource, 'local-browser-session');
});

test('failed optional home-node does not suppress a valid local-desktop route', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'local-first',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'http://127.0.0.1:4173',
      apiBaseUrl: 'http://127.0.0.1:8787',
      homeNode: { host: '192.168.1.42', source: 'manual', reachable: false },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: false,
          source: 'manual',
          reason: 'Home PC node is configured but currently unreachable',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'local-desktop');
  assert.equal(model.headline, 'Local desktop runtime ready');
  assert.doesNotMatch(model.headline, /home pc node unreachable/i);
});

test('ipad/lan context prefers home-node when it is reachable', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.1.42:8787',
      homeNode: { host: '192.168.1.42', uiPort: 5173, backendPort: 8787, source: 'lastKnown', reachable: true },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          source: 'lastKnown',
          reason: 'Home PC node is reachable on the LAN',
        },
        cloud: {
          configured: true,
          available: true,
          source: 'hosted-dist-entry',
          reason: 'Hosted/cloud Stephanos entry is available for fallback',
        },
      },
    },
  });

  assert.equal(model.runtimeContext.deviceContext, 'lan-companion');
  assert.equal(model.preferredRoute, 'home-node');
  assert.equal(model.routeKind, 'home-node');
});

test('route model does not emit source unknown when structured route status exists', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: true },
    },
    backendAvailable: true,
    validationState: 'healthy',
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'https://api.stephanos.example',
      routeDiagnostics: {
        cloud: {
          configured: true,
          available: true,
          source: 'hosted-dist-entry',
          reason: 'Hosted/cloud Stephanos entry is available for fallback',
        },
      },
    },
  });

  assert.notEqual(model.nodeAddressSource, 'unknown');
  assert.equal(model.nodeAddressSource, 'hosted-dist-entry');
});

test('backend online with no selected route reports explicit classification failure', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'groq',
    routeMode: 'auto',
    fallbackEnabled: true,
    providerHealth: {
      groq: { ok: false },
    },
    backendAvailable: true,
    validationState: 'error',
    runtimeContext: {
      frontendOrigin: 'http://localhost:4173',
      apiBaseUrl: 'http://localhost:8787',
      routeDiagnostics: {
        'local-desktop': {
          configured: true,
          available: false,
          misconfigured: true,
          source: 'local-browser-session',
          reason: 'Backend online but no local runtime target was selected',
        },
        cloud: {
          configured: false,
          available: false,
          source: 'cloud-route-unavailable',
          reason: 'Hosted/cloud Stephanos entry is unavailable',
        },
      },
    },
  });

  assert.equal(model.routeKind, 'unavailable');
  assert.equal(model.headline, 'Backend online but route classification failed');
  assert.match(model.dependencySummary, /could not classify a valid route explicitly/i);
  assert.equal(model.classificationFailed, true);
});
