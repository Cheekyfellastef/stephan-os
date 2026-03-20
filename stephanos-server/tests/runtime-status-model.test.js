import test from 'node:test';
import assert from 'node:assert/strict';

import { FALLBACK_PROVIDER_KEYS } from '../../shared/ai/providerDefaults.mjs';
import { createRuntimeStatusModel, deriveProviderMode, getReadyCloudProviders } from '../../shared/runtime/runtimeStatusModel.mjs';

test('default fallback order prefers cloud providers before mock', () => {
  assert.deepEqual(FALLBACK_PROVIDER_KEYS, ['groq', 'gemini', 'mock', 'ollama']);
});

test('runtime status uses auto mode and cloud fallback when local ollama is offline', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    fallbackEnabled: true,
    providerHealth: {
      ollama: { ok: false },
      groq: { ok: true },
      gemini: { ok: false },
    },
    backendAvailable: true,
    validationState: 'healthy',
    preferAuto: true,
  });

  assert.equal(model.providerMode, 'auto');
  assert.equal(model.activeProvider, 'groq');
  assert.equal(model.cloudAvailable, true);
  assert.equal(model.localAvailable, false);
  assert.equal(model.fallbackActive, true);
  assert.equal(model.appLaunchState, 'degraded');
  assert.equal(model.dependencySummary, 'Cloud active, local offline');
});

test('runtime status keeps launcher ready while backend is offline but runtime is still launchable', () => {
  const model = createRuntimeStatusModel({
    selectedProvider: 'ollama',
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

test('deriveProviderMode stays cloud when a cloud provider is selected directly', () => {
  const providerMode = deriveProviderMode({
    selectedProvider: 'gemini',
    fallbackEnabled: true,
    providerHealth: {
      gemini: { ok: true },
      ollama: { ok: false },
    },
  });

  assert.equal(providerMode, 'cloud');
  assert.deepEqual(getReadyCloudProviders({ gemini: { ok: true }, groq: { ok: false } }), ['gemini']);
});
