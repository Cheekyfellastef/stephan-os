import test from 'node:test';
import assert from 'node:assert/strict';

import { getProviderHealthSnapshot } from '../services/llm/router/routeLLMRequest.js';
import { checkOllamaHealth, resolveOllamaConfig } from '../services/llm/providers/ollamaProvider.js';

const ORIGINAL_FETCH = globalThis.fetch;

test('resolveOllamaConfig ignores blank URL values and keeps localhost default', () => {
  const empty = resolveOllamaConfig({ baseURL: '' });
  const nil = resolveOllamaConfig({ baseURL: null });
  const missing = resolveOllamaConfig({});
  const undefinedValue = resolveOllamaConfig({ baseURL: undefined });

  assert.equal(empty.baseURL, 'http://localhost:11434');
  assert.equal(nil.baseURL, 'http://localhost:11434');
  assert.equal(missing.baseURL, 'http://localhost:11434');
  assert.equal(undefinedValue.baseURL, 'http://localhost:11434');
});

test('checkOllamaHealth returns misconfigured result for malformed URL', async () => {
  const health = await checkOllamaHealth({ baseURL: 'not-a-url' });

  assert.equal(health.ok, false);
  assert.equal(health.state, 'MISCONFIGURED');
  assert.equal(health.failureType, 'misconfigured');
  assert.equal(health.reason, 'Ollama base URL is missing or invalid');
  assert.deepEqual(health.models, []);
});

test('checkOllamaHealth does not crash on bad config', async () => {
  await assert.doesNotReject(async () => checkOllamaHealth({ baseURL: '://bad-url' }));
});

test('checkOllamaHealth falls back to localhost default for empty/undefined/null URL values', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }),
    };
  };

  try {
    const empty = await checkOllamaHealth({ baseURL: '' });
    const undefinedValue = await checkOllamaHealth({ baseURL: undefined });
    const nil = await checkOllamaHealth({ baseURL: null });

    for (const health of [empty, undefinedValue, nil]) {
      assert.equal(health.ok, true);
      assert.equal(health.state, 'CONNECTED');
      assert.equal(health.baseURL, 'http://localhost:11434');
      assert.equal(health.endpoint, 'http://localhost:11434/api/tags');
      assert.deepEqual(health.models, ['gpt-oss:20b']);
    }
    assert.deepEqual(calls, [
      'http://localhost:11434/api/tags',
      'http://localhost:11434/api/tags',
      'http://localhost:11434/api/tags',
    ]);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('checkOllamaHealth preserves normal healthy behavior for valid localhost URL', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }),
    };
  };

  try {
    const health = await checkOllamaHealth({ baseURL: 'http://localhost:11434', model: 'gpt-oss:20b' });
    assert.equal(health.ok, true);
    assert.equal(health.state, 'CONNECTED');
    assert.equal(health.baseURL, 'http://localhost:11434');
    assert.equal(health.endpoint, 'http://localhost:11434/api/tags');
    assert.deepEqual(health.models, ['gpt-oss:20b']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'http://localhost:11434/api/tags');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('getProviderHealthSnapshot does not crash when ollama URL is malformed', async () => {
  const snapshot = await getProviderHealthSnapshot({
    provider: 'ollama',
    providerConfigs: {
      ollama: { baseURL: '://bad-url' },
    },
  });

  assert.equal(snapshot.ollama.ok, false);
  assert.equal(snapshot.ollama.state, 'MISCONFIGURED');
  assert.equal(snapshot.ollama.reason, 'Ollama base URL is missing or invalid');
  assert.equal(snapshot.ollama.config.baseURL, '://bad-url');
});
