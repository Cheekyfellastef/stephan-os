import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PROVIDER_KEY, PROVIDER_DEFINITIONS } from '../../shared/ai/providerDefaults.mjs';
import { resolveProviderRequest } from '../services/llm/providerRouter.js';
import { resolveOllamaConfig } from '../services/llm/providers/ollamaProvider.js';

test('default provider is ollama everywhere canonical defaults are read', () => {
  assert.equal(DEFAULT_PROVIDER_KEY, 'ollama');
  assert.equal(PROVIDER_DEFINITIONS.ollama.defaults.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(PROVIDER_DEFINITIONS.ollama.defaults.chatEndpoint, '/api/chat');
  assert.equal(PROVIDER_DEFINITIONS.ollama.defaults.model, 'llama3');
});

test('provider router falls back invalid selections to ollama', () => {
  const resolved = resolveProviderRequest('not-a-provider', {});
  assert.equal(resolved.requestedProvider, 'not-a-provider');
  assert.equal(resolved.resolvedProvider, 'ollama');
  assert.equal(resolved.fallbackApplied, true);
});

test('provider router preserves valid non-default selections', () => {
  const resolved = resolveProviderRequest('custom', {
    baseUrl: 'http://example.test:1234',
    chatEndpoint: '/v1/chat/completions',
    model: 'mixtral',
  });

  assert.equal(resolved.resolvedProvider, 'custom');
  assert.deepEqual(resolved.overrideKeys.sort(), ['baseUrl', 'chatEndpoint', 'model']);
});

test('ollama config resolves canonical endpoint and model by default', () => {
  const resolved = resolveOllamaConfig({});
  assert.equal(resolved.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(resolved.chatEndpoint, '/api/chat');
  assert.equal(resolved.endpoint, 'http://127.0.0.1:11434/api/chat');
  assert.equal(resolved.model, 'llama3');
  assert.equal(resolved.configSource.baseUrl, 'canonical-default');
});

test('ollama config respects per-request overrides without changing provider routing architecture', () => {
  const resolved = resolveOllamaConfig({
    baseUrl: 'http://localhost:11434',
    chatEndpoint: '/api/chat',
    model: 'phi3',
  });

  assert.equal(resolved.endpoint, 'http://localhost:11434/api/chat');
  assert.equal(resolved.model, 'phi3');
  assert.equal(resolved.configSource.baseUrl, 'request-override');
  assert.equal(resolved.configSource.model, 'request-override');
});
