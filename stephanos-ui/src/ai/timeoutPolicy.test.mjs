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
  assert.equal(policy.timeoutPolicySource, 'provider:groq:none');
  assert.equal(policy.timeoutOverrideApplied, false);
});

test('resolveUiRequestTimeoutPolicy expands UI timeout across the full ollama warmup retry bound for a per-model override', () => {
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

  assert.equal(policy.backendRouteTimeoutMs, 270000);
  assert.equal(policy.providerTimeoutMs, 120000);
  assert.equal(policy.modelTimeoutMs, 120000);
  assert.equal(policy.uiRequestTimeoutMs, 271500);
  assert.equal(policy.timeoutOverrideApplied, true);
  assert.match(policy.timeoutPolicySource, /provider:ollama:model-override:qwen:32b:warmup-retry-bound:ui-grace/);
});

test('resolveUiRequestTimeoutPolicy keeps an explicit per-model override authoritative while covering its retry window', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: { timeoutMs: 30000, timeoutSource: 'default:30000ms' },
    provider: 'ollama',
    requestedModel: 'qwen:14b',
    providerConfigs: {
      ollama: {
        model: 'qwen:14b',
        defaultOllamaTimeoutMs: 8000,
        perModelTimeoutOverrides: {
          'qwen:14b': 12000,
        },
      },
    },
  });

  assert.equal(policy.providerTimeoutMs, 12000);
  assert.equal(policy.modelTimeoutMs, 12000);
  assert.equal(policy.backendRouteTimeoutMs, 54000);
  assert.equal(policy.uiRequestTimeoutMs, 55500);
  assert.equal(policy.timeoutPolicySource, 'provider:ollama:model-override:qwen:14b:warmup-retry-bound:ui-grace');
});

test('resolveUiRequestTimeoutPolicy derives heavy-model timeout and full warmup retry bound when runtime timeout is missing', () => {
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
  assert.equal(policy.providerTimeoutMs, 75000);
  assert.equal(policy.modelTimeoutMs, 75000);
  assert.equal(policy.backendRouteTimeoutMs, 180000);
  assert.equal(policy.uiRequestTimeoutMs, 181500);
  assert.equal(policy.timeoutPolicySource, 'provider:ollama:model-baseline:qwen:14b:warmup-retry-bound:ui-grace');
});

test('resolveUiRequestTimeoutPolicy prefers canonical runtime timeout truth over stale 30000 baseline', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: {
      timeoutMs: 30000,
      timeoutSource: 'default:30000ms',
      timeoutPolicy: {
        uiRequestTimeoutMs: 91500,
        backendRouteTimeoutMs: 90000,
        providerTimeoutMs: 90000,
        modelTimeoutMs: 90000,
        timeoutPolicySource: 'backend:ollama:model-timeout',
        timeoutOverrideApplied: true,
        timeoutModel: 'qwen:32b',
      },
    },
    provider: 'ollama',
    requestedModel: 'qwen:32b',
    providerConfigs: {
      ollama: {
        model: 'qwen:32b',
      },
    },
  });

  assert.equal(policy.uiRequestTimeoutMs, 91500);
  assert.equal(policy.backendRouteTimeoutMs, 90000);
  assert.equal(policy.providerTimeoutMs, 90000);
  assert.equal(policy.modelTimeoutMs, 90000);
  assert.equal(policy.timeoutPolicySource, 'backend:ollama:model-timeout:ui-grace');
  assert.equal(policy.timeoutModel, 'qwen:32b');
  assert.equal(policy.timeoutOverrideApplied, true);
});

test('regression: avoid ui_request_timeout_ms at 30000ms when runtime ollama timeout truth is longer', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: {
      timeoutMs: 30000,
      timeoutSource: 'frontend:api-runtime',
      timeoutPolicy: {
        backendRouteTimeoutMs: 120000,
        providerTimeoutMs: 120000,
        modelTimeoutMs: 120000,
        timeoutPolicySource: 'backend:ollama:model-override:qwen:32b',
      },
    },
    provider: 'ollama',
    requestedModel: 'qwen:32b',
    providerConfigs: {
      ollama: {
        model: 'qwen:32b',
      },
    },
  });

  assert.notEqual(policy.uiRequestTimeoutMs, 30000);
  assert.equal(policy.uiRequestTimeoutMs, 121500);
});

test('regression: lightweight ollama covers the possible backend warmup retry instead of the stale frontend fallback', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: {
      timeoutMs: 30000,
      timeoutSource: 'frontend:api-runtime',
    },
    provider: 'ollama',
    requestedModel: 'llama3.2:3b',
    providerConfigs: {
      ollama: {
        model: 'llama3.2:3b',
        defaultOllamaTimeoutMs: 12000,
      },
    },
  });

  assert.equal(policy.providerTimeoutMs, 12000);
  assert.equal(policy.backendRouteTimeoutMs, 54000);
  assert.equal(policy.uiRequestTimeoutMs, 55500);
  assert.equal(policy.timeoutPolicySource, 'provider:ollama:default-timeout:warmup-retry-bound:ui-grace');
});

test('regression live case: local-desktop qwen execution waits through the backend cold-start retry window', () => {
  const liveCase = {
    executableProvider: 'ollama',
    requestedProviderIntent: 'gemini',
    freshnessCandidateProvider: 'gemini',
    actualProviderUsed: 'ollama',
  };
  assert.equal(liveCase.executableProvider, 'ollama');
  assert.equal(liveCase.requestedProviderIntent, 'gemini');
  assert.equal(liveCase.actualProviderUsed, 'ollama');

  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: {
      timeoutMs: 30000,
      timeoutSource: 'frontend:api-runtime',
    },
    provider: liveCase.executableProvider,
    requestedModel: 'qwen:14b',
    providerConfigs: {
      ollama: {
        model: 'qwen:14b',
        defaultOllamaTimeoutMs: 12000,
      },
      gemini: {
        model: 'gemini-2.5-flash',
      },
    },
  });

  assert.equal(policy.providerTimeoutMs, 75000);
  assert.equal(policy.modelTimeoutMs, 75000);
  assert.equal(policy.backendRouteTimeoutMs, 180000);
  assert.equal(policy.uiRequestTimeoutMs, 181500);
  assert.equal(policy.timeoutPolicySource, 'provider:ollama:model-baseline:qwen:14b:warmup-retry-bound:ui-grace');
  assert.notEqual(policy.timeoutPolicySource, 'frontend:api-runtime');
});

test('home-node canonical execution truth uses gpt-oss full warmup retry bound over gemini request intent', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: {
      timeoutMs: 30000,
      timeoutSource: 'frontend:api-runtime',
      finalRouteTruth: {
        routeKind: 'home-node',
        selectedProvider: 'ollama',
        executedProvider: 'ollama',
        routeUsable: true,
      },
      canonicalRouteRuntimeTruth: {
        selectedProvider: 'ollama',
        executedProvider: 'ollama',
      },
    },
    provider: 'ollama',
    requestedModel: 'gpt-oss:20b',
    providerConfigs: {
      ollama: {
        model: 'gpt-oss:20b',
        defaultOllamaTimeoutMs: 12000,
      },
      gemini: {
        model: 'gemini-2.5-flash',
      },
    },
  });

  assert.equal(policy.providerTimeoutMs, 75000);
  assert.equal(policy.modelTimeoutMs, 75000);
  assert.equal(policy.backendRouteTimeoutMs, 180000);
  assert.equal(policy.uiRequestTimeoutMs, 181500);
  assert.equal(policy.timeoutPolicySource, 'canonical-runtime-execution-truth:provider:ollama:model-baseline:gpt-oss:20b:warmup-retry-bound:ui-grace');
  assert.doesNotMatch(policy.timeoutPolicySource, /frontend:api-runtime/);
});

test('fallback to request-side provider policy remains when canonical execution truth is unavailable', () => {
  const policy = resolveUiRequestTimeoutPolicy({
    runtimeConfig: {
      timeoutMs: 30000,
      timeoutSource: 'frontend:api-runtime',
    },
    provider: 'gemini',
    requestedModel: 'gemini-2.5-flash',
    providerConfigs: {
      gemini: {
        model: 'gemini-2.5-flash',
      },
    },
  });

  assert.equal(policy.uiRequestTimeoutMs, 30000);
  assert.equal(policy.timeoutPolicySource, 'provider:gemini:none');
});
