import test from 'node:test';
import assert from 'node:assert/strict';

import { checkGroqHealth, runGroqProvider } from '../services/llm/providers/groqProvider.js';

const ORIGINAL_FETCH = globalThis.fetch;

test('Groq health reports ready when a runtime provider api key is supplied', async () => {
  const health = await checkGroqHealth({ apiKey: 'gsk_test_session_key', model: 'openai/gpt-oss-20b' });

  assert.equal(health.ok, true);
  assert.equal(health.configuredVia, 'runtime provider config');
  assert.match(health.detail, /backend-routed provider configuration/i);
});

test('Groq runner uses the runtime provider api key through the backend provider path', async () => {
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
    assert.equal(result.diagnostics.groq.configuredVia, 'runtime provider config');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer gsk_test_session_key');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('Groq runner uses responses web-search route for high freshness when model is fresh-web capable', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        model: 'compound-beta-mini',
        output_text: 'Live web answer from Groq',
        usage: { total_tokens: 18 },
      }),
    };
  };

  try {
    const result = await runGroqProvider({
      messages: [{ role: 'user', content: 'Who is the current UK prime minister?' }],
      freshnessContext: { freshnessNeed: 'high' },
    }, {
      apiKey: 'gsk_test_session_key',
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'compound-beta-mini',
    });

    assert.equal(result.ok, true);
    assert.equal(result.outputText, 'Live web answer from Groq');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/responses');
    assert.match(String(calls[0].options.body || ''), /web_search/);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('Groq runner uses configured fresh-web candidate model for high-freshness prompts', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        model: 'compound-beta-mini',
        output_text: 'Fresh route used candidate model',
      }),
    };
  };

  try {
    const result = await runGroqProvider({
      messages: [{ role: 'user', content: 'latest CPI release today?' }],
      freshnessContext: { freshnessNeed: 'high' },
    }, {
      apiKey: 'gsk_test_session_key',
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
      freshWebModel: 'compound-beta-mini',
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.groq.freshWebActive, true);
    assert.equal(result.diagnostics.groq.selectedModel, 'compound-beta-mini');
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/responses');
    assert.match(String(calls[0].options.body || ''), /compound-beta-mini/);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('Groq runner prioritizes fresh candidate model over request model for high-freshness prompts', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        model: 'compound-beta-mini',
        output_text: 'Fresh candidate model used despite non-fresh request model',
      }),
    };
  };

  try {
    const result = await runGroqProvider({
      messages: [{ role: 'user', content: 'latest cpi now' }],
      freshnessContext: { freshnessNeed: 'high' },
      model: 'openai/gpt-oss-20b',
      routeDecision: {
        candidateFreshModel: 'compound-beta-mini',
      },
    }, {
      apiKey: 'gsk_test_session_key',
      baseURL: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-20b',
      freshWebModel: 'compound-beta-mini',
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.groq.selectedModel, 'compound-beta-mini');
    assert.equal(result.diagnostics.groq.freshWebModelCandidate, 'compound-beta-mini');
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/responses');
    assert.match(String(calls[0].options.body || ''), /compound-beta-mini/);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('Groq health remains explicit when only non-fresh model is configured', async () => {
  const health = await checkGroqHealth({
    apiKey: 'gsk_test_session_key',
    model: 'openai/gpt-oss-20b',
  });

  assert.equal(health.ok, true);
  assert.equal(health.providerCapability.supportsFreshWeb, false);
  assert.equal(health.providerCapability.configuredModelSupportsFreshWeb, false);
  assert.equal(health.providerCapability.candidateFreshRouteAvailable, false);
  assert.match(health.providerCapability.capabilityReason, /no fresh-web capable model candidate/i);
});
