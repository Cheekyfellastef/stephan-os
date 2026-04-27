import test from 'node:test';
import assert from 'node:assert/strict';

import { routeLLMRequest } from '../services/llm/router/routeLLMRequest.js';

const ORIGINAL_FETCH = globalThis.fetch;

test('auto high-freshness blocks silent non-fresh fallback when Gemini request fails and stale fallback is not permitted', async () => {
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

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.routing.requestedProviderForRequest, 'gemini');
    assert.equal(result.diagnostics.selectedProvider, 'gemini');
    assert.equal(result.actualProviderUsed, 'ollama');
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.diagnostics.providerSelectionSource, 'auto:fresh-capable');
    assert.match(result.fallbackReason || '', /gemini:\s*Invalid JSON payload/i);
    assert.equal(result.diagnostics.freshnessTruth.answerTruthMode, 'degraded-freshness-unavailable');
    assert.equal(result.diagnostics.freshnessTruth.freshnessIntegrityPreserved, true);
    assert.equal(result.diagnostics.freshnessTruth.staleFallbackAttempted, true);
    assert.equal(result.diagnostics.freshnessTruth.staleFallbackUsed, false);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('auto high-freshness allows explicit degraded stale fallback when Gemini fails and stale fallback is permitted', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            message: 'Rate limit exceeded.',
          },
        }),
      };
    }

    if (String(url).includes('api.groq.com') && String(url).includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Groq degraded stale answer' } }],
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
      staleFallbackPermitted: true,
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
      staleFallbackPermitted: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.actualProviderUsed, 'groq');
    assert.equal(result.diagnostics.freshnessTruth.answerTruthMode, 'degraded-stale-allowed');
    assert.equal(result.diagnostics.freshnessTruth.staleFallbackPermitted, true);
    assert.equal(result.diagnostics.freshnessTruth.staleFallbackUsed, true);
    assert.match(result.diagnostics.freshnessTruth.staleAnswerWarning || '', /non-fresh provider/i);
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

test('local-first falls back to Groq with explicit ollama timeout labels when Ollama health is ready but execution times out', async () => {
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }),
      };
    }
    if (target.includes('localhost:11434/api/chat')) {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    if (target.includes('api.groq.com') && target.includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Groq rescued local timeout.' } }],
          usage: { prompt_tokens: 9, completion_tokens: 5 },
        }),
      };
    }
    throw new Error(`Unexpected URL in test fetch mock: ${target}`);
  };

  try {
    const result = await routeLLMRequest({
      messages: [{ role: 'user', content: 'Do deep local reasoning now.' }],
      freshnessContext: { freshnessNeed: 'low' },
    }, {
      provider: 'ollama',
      routeMode: 'local-first',
      fallbackEnabled: true,
      fallbackOrder: ['groq', 'mock'],
      providerConfigs: {
        ollama: {
          baseURL: 'http://localhost:11434',
          model: 'gpt-oss:20b',
          defaultOllamaTimeoutMs: 60000,
        },
        groq: {
          apiKey: 'gsk_sample-key',
          model: 'openai/gpt-oss-20b',
        },
      },
      runtimeContext: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.actualProviderUsed, 'groq');
    assert.equal(result.fallbackUsed, true);
    assert.match(result.fallbackReason || '', /connect_timeout/i);
    assert.match(result.fallbackReason || '', /model-warmup-likely/i);
    const ollamaAttempt = (result.diagnostics.attempts || []).find((attempt) => attempt.provider === 'ollama');
    assert.equal(ollamaAttempt?.result?.error?.details?.failureLabel, 'connect_timeout');
    assert.equal(ollamaAttempt?.result?.error?.details?.warmupRetryEligible, true);
    assert.equal(ollamaAttempt?.result?.error?.details?.warmupRetryApplied, true);
    assert.equal(ollamaAttempt?.result?.diagnostics?.ollama?.timeoutMs, 75000);
    assert.equal(ollamaAttempt?.result?.diagnostics?.ollama?.warmupRetryTimeoutMs, 105000);
    assert.equal(ollamaAttempt?.result?.diagnostics?.ollama?.executionViability, 'degraded-timeout');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('local-first fast lane keeps llama3.2:3b as requested, selected, and executed model for short identity prompt', async () => {
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen:14b' }, { name: 'llama3.2:3b' }, { name: 'gpt-oss:20b' }] }),
      };
    }
    if (target.includes('localhost:11434/api/chat')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ model: 'llama3.2:3b', message: { content: 'You are talking to Stephanos.' } }),
      };
    }
    throw new Error(`Unexpected URL in test fetch mock: ${target}`);
  };

  try {
    const result = await routeLLMRequest({
      messages: [{
        role: 'user',
        content: 'who am i talking to\n\n[System awareness context: include only relevant truth below; do not claim unavailable sources.]\n## memory\n{"recentRecords":[]}',
      }],
      freshnessContext: { freshnessNeed: 'low' },
    }, {
      provider: 'ollama',
      routeMode: 'local-first',
      fallbackEnabled: false,
      providerConfigs: {
        ollama: { baseURL: 'http://localhost:11434', model: 'qwen:14b' },
      },
      runtimeContext: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.fastResponseLane.eligible, true);
    assert.equal(result.diagnostics.fastResponseLane.active, true);
    assert.equal(result.diagnostics.fastResponseLane.model, 'llama3.2:3b');
    assert.equal(result.diagnostics.ollama.requestedModel, 'llama3.2:3b');
    assert.equal(result.diagnostics.ollama.selectedModel, 'llama3.2:3b');
    assert.equal(result.modelUsed, 'llama3.2:3b');
    assert.equal(result.model, 'llama3.2:3b');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('local-first complex build/system prompt stays on qwen/gpt-oss path instead of fast lane', async () => {
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen:14b' }, { name: 'gpt-oss:20b' }, { name: 'llama3.2:3b' }] }),
      };
    }
    if (target.includes('localhost:11434/api/chat')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ model: 'qwen:14b', message: { content: 'Complex task handled.' } }),
      };
    }
    throw new Error(`Unexpected URL in test fetch mock: ${target}`);
  };

  try {
    const result = await routeLLMRequest({
      messages: [{ role: 'user', content: 'Generate a system architecture and build pipeline implementation plan with debugging steps and execution sequencing.' }],
      freshnessContext: { freshnessNeed: 'low' },
    }, {
      provider: 'ollama',
      routeMode: 'local-first',
      fallbackEnabled: false,
      providerConfigs: {
        ollama: { baseURL: 'http://localhost:11434', model: 'qwen:14b' },
      },
      runtimeContext: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.fastResponseLane.eligible, false);
    assert.equal(result.diagnostics.fastResponseLane.active, false);
    assert.equal(result.diagnostics.ollama.selectedModel, 'qwen:14b');
    assert.equal(result.modelUsed, 'qwen:14b');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('non-ollama provider path does not expose warmup retry metadata', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.groq.com') && String(url).includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Groq direct answer.' } }],
          usage: { prompt_tokens: 2, completion_tokens: 2 },
        }),
      };
    }
    throw new Error(`Unexpected URL in test fetch mock: ${url}`);
  };

  try {
    const result = await routeLLMRequest({
      messages: [{ role: 'user', content: 'hello' }],
    }, {
      provider: 'groq',
      routeMode: 'explicit',
      fallbackEnabled: false,
      providerConfigs: {
        groq: { apiKey: 'gsk_sample-key', model: 'openai/gpt-oss-20b' },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.actualProviderUsed, 'groq');
    const groqAttempt = (result.diagnostics.attempts || []).find((attempt) => attempt.provider === 'groq');
    assert.equal(groqAttempt?.result?.error?.details?.warmupRetryApplied, undefined);
    assert.equal(groqAttempt?.result?.diagnostics?.ollama?.warmupRetryApplied, undefined);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});
