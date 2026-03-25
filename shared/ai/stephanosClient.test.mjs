import test from 'node:test';
import assert from 'node:assert/strict';
import { queryStephanosAI, resolveStephanosAiBackendBaseUrl } from './stephanosClient.mjs';

test('resolveStephanosAiBackendBaseUrl reuses shared backend base URL resolver defaults', () => {
  const baseUrl = resolveStephanosAiBackendBaseUrl({
    frontendOrigin: 'http://192.168.0.55:5173',
  });

  assert.equal(baseUrl, 'http://192.168.0.55:8787');
});

test('queryStephanosAI posts messages through Stephanos /api/ai/chat route', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, output_text: 'ok', data: { actual_provider_used: 'ollama' } });
      },
    };
  };

  const result = await queryStephanosAI({
    provider: 'ollama',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello from tile' },
    ],
    context: {
      tileId: 'experimental-sandbox',
      workspace: 'experimental',
      simulationType: 'system-generation-sandbox',
    },
    runtimeContext: {
      baseUrl: 'http://127.0.0.1:8787',
      frontendOrigin: 'http://127.0.0.1:5173',
    },
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/ai/chat');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.prompt, 'hello from tile');
  assert.equal(payload.provider, 'ollama');
  assert.equal(payload.runtimeContext.tileContext.tileId, 'experimental-sandbox');
  assert.equal(result.success, true);
});

test('queryStephanosAI throws cleanly on backend failures', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 502,
    async text() {
      return JSON.stringify({ error: 'provider failed' });
    },
  });

  await assert.rejects(
    () => queryStephanosAI({
      messages: [{ role: 'user', content: 'hello' }],
      runtimeContext: { baseUrl: 'http://localhost:8787' },
      fetchImpl,
    }),
    /provider failed/,
  );
});
