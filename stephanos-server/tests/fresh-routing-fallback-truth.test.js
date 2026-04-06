import test from 'node:test';
import assert from 'node:assert/strict';

import { routeLLMRequest } from '../services/llm/router/routeLLMRequest.js';

const ORIGINAL_FETCH = globalThis.fetch;

test('auto high-freshness routes to Gemini first and falls back to Groq with truthful diagnostics when Gemini request fails', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Invalid JSON payload received. Unknown name "config": Cannot find field.',
          },
        }),
      };
    }

    if (String(url).includes('api.groq.com') && String(url).includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Groq fallback answer' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
      };
    }

    throw new Error(`Unexpected URL in test fetch mock: ${url}`);
  };

  try {
    const result = await routeLLMRequest({
      messages: [{ role: 'user', content: 'Who is the current UK Prime Minister?' }],
      freshnessContext: { freshnessNeed: 'high' },
    }, {
      provider: 'ollama',
      routeMode: 'auto',
      providerConfigs: {
        gemini: {
          apiKey: 'AIza-sample-key',
          model: 'gemini-2.5-flash',
          groundingEnabled: true,
          groundingMode: 'google_search',
        },
        groq: {
          apiKey: 'gsk_sample-key',
          model: 'openai/gpt-oss-20b',
        },
      },
      runtimeContext: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.routing.requestedProviderForRequest, 'gemini');
    assert.equal(result.diagnostics.selectedProvider, 'gemini');
    assert.equal(result.actualProviderUsed, 'groq');
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.diagnostics.providerSelectionSource, 'auto:fresh-capable');
    assert.match(result.fallbackReason || '', /gemini:\s*Invalid JSON payload/i);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('auto high-freshness executes Gemini successfully when grounding is configured with valid request schema', async () => {
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: 'Gemini fresh grounded answer' }] },
            groundingMetadata: {
              webSearchQueries: ['current uk prime minister'],
              groundingChunks: [{ web: { uri: 'https://example.com/pm', title: 'PM source' } }],
            },
          }],
        }),
      };
    }
    throw new Error(`Unexpected URL in test fetch mock: ${url}`);
  };

  try {
    const result = await routeLLMRequest({
      messages: [{ role: 'user', content: 'Who is the current UK Prime Minister?' }],
      freshnessContext: { freshnessNeed: 'high' },
    }, {
      provider: 'ollama',
      routeMode: 'auto',
      providerConfigs: {
        gemini: {
          apiKey: 'AIza-sample-key',
          model: 'gemini-2.5-flash',
          groundingEnabled: true,
          groundingMode: 'google_search',
        },
        groq: {
          apiKey: 'gsk_sample-key',
          model: 'openai/gpt-oss-20b',
        },
      },
      runtimeContext: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.actualProviderUsed, 'gemini');
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.diagnostics.routing.requestedProviderForRequest, 'gemini');
    assert.equal(result.diagnostics.providerSelectionSource, 'auto:fresh-capable');
    const geminiRequest = fetchCalls.find((call) => String(call.url).includes('generativelanguage.googleapis.com'));
    const requestBody = JSON.parse(String(geminiRequest?.options?.body || '{}'));
    assert.equal(Array.isArray(requestBody.tools), true);
    assert.equal('config' in requestBody, false);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});
