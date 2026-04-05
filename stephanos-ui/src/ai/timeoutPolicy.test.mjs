import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveUiRequestTimeoutPolicy } from './timeoutPolicy.js';

test('resolveUiRequestTimeoutPolicy keeps frontend baseline timeout when no provider override applies', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: { timeoutMs: 30000, timeoutSource: 'env:VITE_API_TIMEOUT_MS' },
    provider: 'groq',
    providerConfigs: {
      groq: { model: 'openai/gpt-oss-20b' },
    },
  });

  assert.equal(policy.uiRequestTimeoutMs, 30000);
  assert.equal(policy.backendRouteTimeoutMs, null);
  assert.equal(policy.timeoutPolicySource, 'env:VITE_API_TIMEOUT_MS');
  assert.equal(policy.timeoutOverrideApplied, false);
});

test('resolveUiRequestTimeoutPolicy expands UI timeout when ollama per-model override exceeds baseline', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: { timeoutMs: 30000, timeoutSource: 'default:30000ms' },
    provider: 'ollama',
    requestedModel: 'qwen:32b',
    providerConfigs: {
      ollama: {
        model: 'qwen:14b',
        defaultOllamaTimeoutMs: 45000,
        perModelTimeoutOverrides: {
          'qwen:32b': 120000,
        },
      },
    },
  });

  assert.equal(policy.backendRouteTimeoutMs, 120000);
  assert.equal(policy.providerTimeoutMs, 120000);
  assert.equal(policy.modelTimeoutMs, 120000);
  assert.equal(policy.uiRequestTimeoutMs, 121500);
  assert.equal(policy.timeoutOverrideApplied, true);
  assert.match(policy.timeoutPolicySource, /provider:ollama:model-override:qwen:32b:ui-grace/);
});

test('resolveUiRequestTimeoutPolicy uses explicit fallback timeout source when runtime timeout is missing', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: {},
    provider: 'ollama',
    providerConfigs: {
      ollama: {
        model: 'qwen:14b',
      },
    },
  });

  assert.equal(policy.uiTimeoutBaselineMs, 30000);
  assert.equal(policy.providerTimeoutMs, 8000);
  assert.equal(policy.uiRequestTimeoutMs, 30000);
  assert.equal(policy.timeoutPolicySource, 'frontend:api-runtime');
});
