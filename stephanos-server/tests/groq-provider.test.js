import test from 'node:test';
import assert from 'node:assert/strict';

import { checkGroqHealth, runGroqProvider } from '../services/llm/providers/groqProvider.js';

const ORIGINAL_FETCH = globalThis.fetch;

test('Groq health reports ready when a UI session api key is supplied', async () => {
  const health = await checkGroqHealth({ apiKey: 'gsk_test_session_key', model: 'openai/gpt-oss-20b' });

  assert.equal(health.ok, true);
  assert.equal(health.configuredVia, 'ui session API key');
  assert.match(health.detail, /current UI session key/i);
});

test('Groq runner uses the UI session api key through the backend provider path', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        model: 'openai/gpt-oss-20b',
        choices: [{ message: { content: 'Groq backend reply' } }],
        usage: { total_tokens: 10 },
      }),
    };
  };

  try {
    const result = await runGroqProvider({
      messages: [{ role: 'user', content: 'Hello Groq' }],
      model: 'openai/gpt-oss-20b',
    }, {
      apiKey: 'gsk_test_session_key',
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
    });

    assert.equal(result.ok, true);
    assert.equal(result.outputText, 'Groq backend reply');
    assert.equal(result.diagnostics.groq.configuredVia, 'ui session API key');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer gsk_test_session_key');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});
