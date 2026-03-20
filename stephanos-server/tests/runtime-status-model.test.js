import test from 'node:test';
import assert from 'node:assert/strict';

import { FALLBACK_PROVIDER_KEYS } from '../../shared/ai/providerDefaults.mjs';
import { createRuntimeStatusModel, getReadyCloudProviders } from '../../shared/runtime/runtimeStatusModel.mjs';

test('default fallback order prefers cloud providers before mock', () => {
  assert.deepEqual(FALLBACK_PROVIDER_KEYS, ['groq', 'gemini', 'mock', 'ollama']);
});

test('runtime status uses cloud-first in hosted auto mode when local ollama is offline', () => {
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
  assert.equal(model.dependencySummary, 'Groq active for cloud routing');
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

test('runtime status keeps launcher ready while backend is offline but runtime is still launchable', () => {
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
  assert.equal(model.dependencySummary, 'Backend offline');
});

test('ready cloud provider list still filters only healthy cloud providers', () => {
  assert.deepEqual(getReadyCloudProviders({ gemini: { ok: true }, groq: { ok: false } }), ['gemini']);
});
