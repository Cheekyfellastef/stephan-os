import test from 'node:test';
import assert from 'node:assert/strict';

import { checkGeminiHealth, runGeminiProvider } from '../services/llm/providers/geminiProvider.js';

const ORIGINAL_FETCH = globalThis.fetch;

test('Gemini health reports Missing key state when api key is absent', async () => {
  const health = await checkGeminiHealth({ model: 'gemini-2.5-flash' });
  assert.equal(health.ok, false);
  assert.equal(health.state, 'MISSING_KEY');
  assert.equal(health.reason, 'Missing key');
});

test('Gemini runner fails clearly when api key is missing', async () => {
  const result = await runGeminiProvider({
    messages: [{ role: 'user', content: 'Hello' }],
    model: 'gemini-2.5-flash',
  }, {
    model: 'gemini-2.5-flash',
  });

  assert.equal(result.ok, false);
  assert.match(result.error?.message || '', /api key is missing/i);
});

test('Gemini runner executes when api key is configured', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Gemini live reply' }] } }],
      usageMetadata: { promptTokenCount: 10 },
    }),
  });

  try {
    const result = await runGeminiProvider({
      messages: [{ role: 'user', content: 'Hello Gemini' }],
      model: 'gemini-2.5-flash',
    }, {
      apiKey: 'AIza-sample-key',
      model: 'gemini-2.5-flash',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
      secretAuthority: 'backend-local-secret-store',
    });

    assert.equal(result.ok, true);
    assert.equal(result.outputText, 'Gemini live reply');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});
