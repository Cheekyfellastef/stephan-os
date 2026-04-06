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
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: 'Gemini live reply' }] },
          groundingMetadata: {
            webSearchQueries: ['current UK prime minister'],
            groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example source' } }],
          },
        }],
        usageMetadata: { promptTokenCount: 10 },
      }),
    };
  };

  try {
    const result = await runGeminiProvider({
      messages: [{ role: 'user', content: 'Hello Gemini' }],
      model: 'gemini-2.5-flash',
    }, {
      apiKey: 'AIza-sample-key',
      model: 'gemini-2.5-flash',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
      secretAuthority: 'backend-local-secret-store',
      groundingEnabled: true,
      groundingMode: 'google_search',
    });

    assert.equal(result.ok, true);
    assert.equal(result.outputText, 'Gemini live reply');
    assert.equal(result.diagnostics.gemini.supportsFreshWeb, true);
    assert.deepEqual(result.diagnostics.gemini.groundingMetadata.searchQueries, ['current UK prime minister']);
    assert.equal(result.diagnostics.gemini.groundingMetadata.sources[0].uri, 'https://example.com');
    const requestBody = JSON.parse(String(calls[0].options.body || '{}'));
    assert.match(String(calls[0].options.body || ''), /google_search/);
    assert.equal(Array.isArray(requestBody.tools), true);
    assert.equal('config' in requestBody, false);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('Gemini runner gracefully reports unavailable grounding metadata when endpoint omits it', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: 'Gemini response without grounding metadata' }] },
      }],
      usageMetadata: { promptTokenCount: 2 },
    }),
  });

  try {
    const result = await runGeminiProvider({
      messages: [{ role: 'user', content: 'Hello Gemini' }],
      model: 'gemini-2.5-flash',
    }, {
      apiKey: 'AIza-sample-key',
      model: 'gemini-2.5-flash',
      groundingEnabled: true,
      groundingMode: 'google_search',
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.gemini.groundingMetadata.available, false);
    assert.deepEqual(result.diagnostics.gemini.groundingMetadata.searchQueries, []);
    assert.deepEqual(result.diagnostics.gemini.groundingMetadata.sources, []);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('Gemini health exposes fresh-web capability only when grounding is enabled', async () => {
  const withoutGrounding = await checkGeminiHealth({
    apiKey: 'AIza-sample-key',
    model: 'gemini-2.5-flash',
    groundingEnabled: false,
    groundingMode: 'none',
  });
  const withGrounding = await checkGeminiHealth({
    apiKey: 'AIza-sample-key',
    model: 'gemini-2.5-flash',
    groundingEnabled: true,
    groundingMode: 'google_search',
  });

  assert.equal(withoutGrounding.providerCapability.supportsFreshWeb, false);
  assert.equal(withoutGrounding.providerCapability.requiresGrounding, true);
  assert.equal(withGrounding.providerCapability.supportsFreshWeb, true);
  assert.equal(withGrounding.providerCapability.groundingEnabled, true);
});
