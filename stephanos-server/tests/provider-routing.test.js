import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PROVIDER_KEY, PROVIDER_DEFINITIONS } from '../../shared/ai/providerDefaults.mjs';
import { resolveProviderRequest, routeLLMRequest } from '../services/llm/providerRouter.js';
import { checkOllamaHealth, resolveOllamaConfig } from '../services/llm/providers/ollamaProvider.js';

test('default provider is ollama for local-first load', () => {
  assert.equal(DEFAULT_PROVIDER_KEY, 'ollama');
  assert.equal(PROVIDER_DEFINITIONS.mock.defaults.mode, 'echo');
  assert.equal(PROVIDER_DEFINITIONS.openrouter.defaults.enabled, false);
});

test('provider router falls back invalid selections to the default local provider', () => {
  const resolved = resolveProviderRequest('not-a-provider', {});
  assert.equal(resolved.requestedProvider, 'not-a-provider');
  assert.equal(resolved.resolvedProvider, 'ollama');
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
  assert.equal(response.actualProviderUsed, 'mock');
  assert.equal(response.fallbackUsed, false);
  assert.match(response.outputText, /describe the current mode/i);
});

test('router falls back to mock when groq is selected without credentials and fallback enabled', async () => {
  const response = await routeLLMRequest({ messages: [{ role: 'user', content: 'test fallback' }] }, { provider: 'groq', devMode: true, fallbackEnabled: true, fallbackOrder: ['mock', 'groq', 'gemini', 'ollama'], providerConfigs: { groq: { apiKey: '' }, mock: { latencyMs: 0, mode: 'canned' } } });
  assert.equal(response.ok, true);
  assert.equal(response.provider, 'mock');
  assert.equal(response.actualProviderUsed, 'mock');
  assert.equal(response.diagnostics.selectedProvider, 'groq');
  assert.equal(response.diagnostics.fallbackUsed, true);
  assert.match(response.diagnostics.fallbackReason, /groq/i);
});

test('router executes ollama directly when ollama succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return { ok: true, status: 200, json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }) };
    }
    if (String(url).endsWith('/api/chat')) {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-oss:20b');
      return {
        ok: true,
        status: 200,
        json: async () => ({ model: 'gpt-oss:20b', message: { content: 'Ollama real response' } }),
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const response = await routeLLMRequest(
      { messages: [{ role: 'user', content: 'use ollama directly' }] },
      { provider: 'ollama', fallbackEnabled: true, fallbackOrder: ['mock', 'groq', 'gemini', 'ollama'], providerConfigs: { ollama: { baseURL: 'http://localhost:11434', model: 'gpt-oss:20b', timeoutMs: 50 }, mock: { latencyMs: 0, mode: 'echo' } } },
    );

    assert.equal(response.ok, true);
    assert.equal(response.provider, 'ollama');
    assert.equal(response.actualProviderUsed, 'ollama');
    assert.equal(response.fallbackUsed, false);
    assert.equal(response.diagnostics.selectedProvider, 'ollama');
    assert.equal(response.outputText, 'Ollama real response');
  } finally {
    global.fetch = originalFetch;
  }
});

test('router surfaces fallback reason when ollama fails and mock is used', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return { ok: true, status: 200, json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }) };
    }
    if (String(url).endsWith('/api/chat')) {
      return { ok: false, status: 500, json: async () => ({ error: 'Ollama internal error' }) };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  try {
    const response = await routeLLMRequest(
      { messages: [{ role: 'user', content: 'fallback if ollama fails' }] },
      { provider: 'ollama', fallbackEnabled: true, fallbackOrder: ['mock', 'groq', 'gemini', 'ollama'], providerConfigs: { ollama: { baseURL: 'http://localhost:11434', model: 'gpt-oss:20b', timeoutMs: 50 }, mock: { latencyMs: 0, mode: 'echo' } } },
    );

    assert.equal(response.ok, true);
    assert.equal(response.provider, 'mock');
    assert.equal(response.actualProviderUsed, 'mock');
    assert.equal(response.fallbackUsed, true);
    assert.match(response.fallbackReason, /ollama/i);
    assert.match(response.fallbackReason, /internal error/i);
    assert.equal(response.diagnostics.attemptOrder[0], 'ollama');
  } finally {
    global.fetch = originalFetch;
  }
});

test('ollama config resolves canonical endpoint and model by default', () => {
  const resolved = resolveOllamaConfig({});
  assert.equal(resolved.baseURL, 'http://localhost:11434');
  assert.equal(resolved.endpoint, 'http://localhost:11434/api/chat');
  assert.equal(resolved.model, 'gpt-oss:20b');
});


test('ollama health reports connected state when /api/tags succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200 });

  try {
    const health = await checkOllamaHealth({ baseURL: 'http://localhost:11434', timeoutMs: 50 });
    assert.equal(health.ok, true);
    assert.equal(health.state, 'CONNECTED');
    assert.equal(health.message, 'Connected to Ollama (Local Machine)');
  } finally {
    global.fetch = originalFetch;
  }
});

test('ollama health marks localhost failures as likely wrong device candidates', async () => {
  const originalFetch = global.fetch;
  const error = new TypeError('fetch failed');
  error.cause = { code: 'ECONNREFUSED' };
  global.fetch = async () => { throw error; };

  try {
    const health = await checkOllamaHealth({ baseURL: 'http://localhost:11434', timeoutMs: 50 });
    assert.equal(health.ok, false);
    assert.equal(health.state, 'OFFLINE');
    assert.equal(health.failureType, 'connection_refused');
    assert.equal(health.likelyWrongDevice, true);
    assert.equal(health.suggestedUrl, 'http://192.168.1.42:11434');
  } finally {
    global.fetch = originalFetch;
  }
});

test('ollama health reports offline state for LAN timeout', async () => {
  const originalFetch = global.fetch;
  const error = new Error('connect timeout');
  error.cause = { code: 'ETIMEDOUT' };
  global.fetch = async () => { throw error; };

  try {
    const health = await checkOllamaHealth({ baseURL: 'http://192.168.1.42:11434', timeoutMs: 50 });
    assert.equal(health.ok, false);
    assert.equal(health.state, 'OFFLINE');
    assert.equal(health.failureType, 'timeout');
    assert.equal(health.message, 'Cannot connect to Ollama');
  } finally {
    global.fetch = originalFetch;
  }
});
