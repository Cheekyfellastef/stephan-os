import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PROVIDER_KEY, PROVIDER_DEFINITIONS } from '../../shared/ai/providerDefaults.mjs';
import { resolveProviderRequest, routeLLMRequest } from '../services/llm/providerRouter.js';
import { resolveOllamaConfig } from '../services/llm/providers/ollamaProvider.js';

test('default provider is mock for zero-cost first load', () => {
  assert.equal(DEFAULT_PROVIDER_KEY, 'mock');
  assert.equal(PROVIDER_DEFINITIONS.mock.defaults.mode, 'echo');
  assert.equal(PROVIDER_DEFINITIONS.openrouter.defaults.enabled, false);
});

test('provider router falls back invalid selections to mock', () => {
  const resolved = resolveProviderRequest('not-a-provider', {});
  assert.equal(resolved.requestedProvider, 'not-a-provider');
  assert.equal(resolved.resolvedProvider, 'mock');
  assert.equal(resolved.fallbackApplied, true);
});

test('provider router preserves valid groq selection', () => {
  const resolved = resolveProviderRequest('groq', { model: 'openai/gpt-oss-20b', baseURL: 'https://api.groq.com/openai/v1' });
  assert.equal(resolved.resolvedProvider, 'groq');
  assert.deepEqual(resolved.overrideKeys.sort(), ['baseURL', 'model']);
});

test('mock provider answers without any API keys configured', async () => {
  const response = await routeLLMRequest({ messages: [{ role: 'user', content: 'describe the current mode' }] }, { provider: 'mock', providerConfigs: { mock: { mode: 'echo', latencyMs: 0 } } });
  assert.equal(response.ok, true);
  assert.equal(response.provider, 'mock');
  assert.match(response.outputText, /describe the current mode/i);
});

test('router falls back to mock when groq is selected without credentials and fallback enabled', async () => {
  const response = await routeLLMRequest({ messages: [{ role: 'user', content: 'test fallback' }] }, { provider: 'groq', devMode: true, fallbackEnabled: true, fallbackOrder: ['mock', 'groq', 'gemini', 'ollama'], providerConfigs: { groq: { apiKey: '' }, mock: { latencyMs: 0, mode: 'canned' } } });
  assert.equal(response.ok, true);
  assert.equal(response.provider, 'mock');
  assert.equal(response.diagnostics.fallbackUsed, true);
});

test('ollama config resolves canonical endpoint and model by default', () => {
  const resolved = resolveOllamaConfig({});
  assert.equal(resolved.baseURL, 'http://localhost:11434');
  assert.equal(resolved.endpoint, 'http://localhost:11434/api/chat');
  assert.equal(resolved.model, 'gpt-oss:20b');
});
