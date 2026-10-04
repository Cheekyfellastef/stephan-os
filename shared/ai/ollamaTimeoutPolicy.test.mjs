import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OLLAMA_HEAVY_MODEL_TIMEOUT_BASELINES,
  resolveOllamaTimeoutPolicy,
} from './ollamaTimeoutPolicy.mjs';

test('qwen3.5 27B shares the canonical heavy timeout envelope', () => {
  assert.equal(OLLAMA_HEAVY_MODEL_TIMEOUT_BASELINES['qwen3.5:27b'], 120000);
  const policy = resolveOllamaTimeoutPolicy({
    providerConfig: { model: 'qwen3.5:27b' },
    requestedModel: 'qwen3.5:27b',
  });
  assert.equal(policy.providerTimeoutMs, 120000);
  assert.equal(policy.backendRouteTimeoutMs, 270000);
  assert.equal(policy.timeoutSource, 'model-baseline');
  assert.equal(policy.timeoutModel, 'qwen3.5:27b');
});

test('per-model overrides remain authoritative over shared baselines', () => {
  const policy = resolveOllamaTimeoutPolicy({
    providerConfig: {
      model: 'qwen3.5:27b',
      perModelTimeoutOverrides: { 'qwen3.5:27b': 180000 },
    },
  });
  assert.equal(policy.providerTimeoutMs, 180000);
  assert.equal(policy.backendRouteTimeoutMs, 390000);
  assert.equal(policy.timeoutSource, 'model-override');
  assert.equal(policy.timeoutOverrideApplied, true);
});

test('lightweight models preserve the safe fallback timeout', () => {
  const policy = resolveOllamaTimeoutPolicy({
    providerConfig: { model: 'llama3.2:3b' },
  });
  assert.equal(policy.providerTimeoutMs, 8000);
  assert.equal(policy.timeoutSource, 'safe-fallback');
});
