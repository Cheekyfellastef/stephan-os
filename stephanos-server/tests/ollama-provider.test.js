import test from 'node:test';
import assert from 'node:assert/strict';

import { getProviderHealthSnapshot } from '../services/llm/router/routeLLMRequest.js';
import { checkOllamaHealth, resolveOllamaConfig, runOllamaProvider } from '../services/llm/providers/ollamaProvider.js';

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
  assert.equal(missing.model, 'qwen:14b');
});

test('resolveOllamaConfig migrates legacy timeoutMs into default Ollama timeout policy', () => {
  const resolved = resolveOllamaConfig({ timeoutMs: 15500 });

  assert.equal(resolved.defaultOllamaTimeoutMs, 15500);
  assert.equal(resolved.timeoutMs, 15500);
  assert.deepEqual(resolved.perModelTimeoutOverrides, {});
});

test('runOllamaProvider defaults to qwen:14b for normal local reasoning when available', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen:14b' }, { name: 'qwen:32b' }, { name: 'gpt-oss:20b' }] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'qwen:14b', message: { content: 'ok' } }),
    };
  };

  try {
    const result = await runOllamaProvider({ messages: [{ role: 'user', content: 'Summarize this local module.' }] }, { baseURL: 'http://localhost:11434', model: 'qwen:14b' });
    assert.equal(result.ok, true);
    assert.equal(result.model, 'qwen:14b');
    assert.equal(result.diagnostics.ollama.selectedModel, 'qwen:14b');
    assert.equal(result.diagnostics.ollama.defaultModel, 'qwen:14b');
    assert.equal(result.diagnostics.ollama.fallbackModelUsed, false);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('runOllamaProvider escalates to qwen:32b for deep reasoning prompts', async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen:14b' }, { name: 'qwen:32b' }, { name: 'gpt-oss:20b' }] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'qwen:32b', message: { content: 'deep ok' } }),
    };
  };

  try {
    const result = await runOllamaProvider({
      messages: [{ role: 'user', content: 'Please do a deep architecture root cause analysis and multi-step debug plan.' }],
    }, { baseURL: 'http://localhost:11434', model: 'qwen:14b' });
    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.ollama.selectedModel, 'qwen:32b');
    assert.equal(result.diagnostics.ollama.escalationActive, true);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('runOllamaProvider falls back to gpt-oss:20b when qwen:14b is unavailable', async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'gpt-oss:20b' }, { name: 'llama3.2:3b' }] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'gpt-oss:20b', message: { content: 'fallback ok' } }),
    };
  };

  try {
    const result = await runOllamaProvider({ messages: [{ role: 'user', content: 'Explain this local bug.' }] }, { baseURL: 'http://localhost:11434', model: 'qwen:14b' });
    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.ollama.selectedModel, 'gpt-oss:20b');
    assert.equal(result.diagnostics.ollama.fallbackModelUsed, true);
    assert.match(result.diagnostics.ollama.fallbackReason, /unavailable/i);
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('runOllamaProvider uses per-model timeout override for qwen:32b', async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen:14b' }, { name: 'qwen:32b' }, { name: 'gpt-oss:20b' }] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'qwen:32b', message: { content: 'deep timeout policy ok' } }),
    };
  };

  try {
    const result = await runOllamaProvider({
      messages: [{ role: 'user', content: 'Do deep root cause reasoning and multi-step architecture analysis.' }],
    }, {
      baseURL: 'http://localhost:11434',
      model: 'qwen:14b',
      defaultOllamaTimeoutMs: 8000,
      perModelTimeoutOverrides: { 'qwen:32b': 22000 },
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.ollama.selectedModel, 'qwen:32b');
    assert.equal(result.diagnostics.ollama.timeoutMs, 22000);
    assert.equal(result.diagnostics.ollama.timeoutSource, 'model-override');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('runOllamaProvider uses default timeout when selected model has no override', async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen:14b' }, { name: 'qwen:32b' }, { name: 'gpt-oss:20b' }] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'qwen:14b', message: { content: 'default timeout policy ok' } }),
    };
  };

  try {
    const result = await runOllamaProvider({
      messages: [{ role: 'user', content: 'Summarize this local module quickly.' }],
    }, {
      baseURL: 'http://localhost:11434',
      model: 'qwen:14b',
      defaultOllamaTimeoutMs: 9000,
      perModelTimeoutOverrides: { 'qwen:32b': 22000 },
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.ollama.selectedModel, 'qwen:14b');
    assert.equal(result.diagnostics.ollama.timeoutMs, 9000);
    assert.equal(result.diagnostics.ollama.timeoutSource, 'default');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
});

test('runOllamaProvider reports execution timeout viability diagnostics when health is ready but generation times out', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'gpt-oss:20b' }] }),
      };
    }
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    throw abortError;
  };

  try {
    const health = await checkOllamaHealth({ baseURL: 'http://localhost:11434', model: 'gpt-oss:20b', defaultOllamaTimeoutMs: 60000 });
    assert.equal(health.ok, true);
    assert.equal(health.state, 'CONNECTED');

    const result = await runOllamaProvider(
      { messages: [{ role: 'user', content: 'Analyze this in depth.' }] },
      { baseURL: 'http://localhost:11434', model: 'gpt-oss:20b', defaultOllamaTimeoutMs: 60000 },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'LLM_OLLAMA_UNREACHABLE');
    assert.equal(result.error.details.failureLabel, 'connect_timeout');
    assert.equal(result.error.details.failureLayer, 'provider');
    assert.equal(result.error.details.modelWarmupLikely, true);
    assert.equal(result.error.details.warmupRetryApplied, true);
    assert.equal(result.error.details.timeoutMs, 120000);
    assert.equal(result.diagnostics.ollama.executionViability, 'degraded-timeout');
    assert.equal(result.diagnostics.ollama.executionFailureLabel, 'connect_timeout');
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
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

test('checkOllamaHealth rejects localhost endpoint for non-local session when no LAN candidate exists', async () => {
  const health = await checkOllamaHealth({
    baseURL: 'http://localhost:11434',
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'lan-companion',
      frontendOrigin: 'http://192.168.0.25:5173',
    },
  });

  assert.equal(health.ok, false);
  assert.equal(health.state, 'LOCALHOST_MISMATCH');
  assert.equal(health.routeUsable, false);
  assert.equal(health.routeClass, 'unusable-nonlocal-loopback');
  assert.match(health.reason, /unusable from current surface/i);
  assert.ok(Array.isArray(health.routeNotes));
  assert.ok(health.routeNotes.some((note) => /localhost endpoint rejected/i.test(note)));
});

test('checkOllamaHealth remaps localhost endpoint to home-node LAN host for non-local session', async () => {
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
    const health = await checkOllamaHealth({
      baseURL: 'http://localhost:11434',
      runtimeContext: {
        sessionKind: 'hosted-web',
        deviceContext: 'lan-companion',
        homeNode: { host: '192.168.0.198' },
        frontendOrigin: 'http://192.168.0.50:5173',
      },
    });
    assert.equal(health.ok, true);
    assert.equal(health.routeUsable, true);
    assert.equal(health.routeClass, 'lan-home-node');
    assert.equal(health.baseURL, 'http://192.168.0.198:11434');
    assert.equal(calls[0], 'http://192.168.0.198:11434/api/tags');
    assert.ok(health.routeNotes.some((note) => /LAN\/home-node endpoint selected/i.test(note)));
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

test('getProviderHealthSnapshot marks Ollama unusable for non-local localhost-only routing truth', async () => {
  const snapshot = await getProviderHealthSnapshot({
    provider: 'ollama',
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      frontendOrigin: 'https://stephanos.example',
    },
    providerConfigs: {
      ollama: { baseURL: 'http://localhost:11434' },
    },
  });

  assert.equal(snapshot.ollama.ok, false);
  assert.equal(snapshot.ollama.state, 'LOCALHOST_MISMATCH');
  assert.equal(snapshot.ollama.routeUsable, false);
  assert.equal(snapshot.routing.runtimeContext.sessionKind, 'hosted-web');
});
