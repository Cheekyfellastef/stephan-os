import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getMusicAiRuntimeDiagnostics, normalizeMusicAiResponse, testMusicAiRoute } from '../apps/music-tile/engine/musicAiBridge.js';
const musicTileJs = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Music AI bridge preserves canonical /api/ai/chat path', () => {
  const diag = getMusicAiRuntimeDiagnostics();
  assert.equal(diag.endpointPath, '/api/ai/chat');
  assert.match(diag.endpointUrl, /\/api\/ai\/chat$/);
});

test('AI route test handles success, 404, and fetch failure', async () => {
  const ok = await testMusicAiRoute({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"success":true,"output_text":"MUSIC_AI_ROUTE_OK","data":{"actual_provider_used":"groq","model_used":"openai/gpt-oss-20b"}}' }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.method, 'POST');
  assert.match(ok.requestUrl, /\/api\/ai\/chat$/);
  assert.equal(ok.parsedText, 'MUSIC_AI_ROUTE_OK');
  assert.equal(ok.diagnostics.actualProvider, 'groq');
  assert.equal(ok.diagnostics.actualModel, 'openai/gpt-oss-20b');
  const missing = await testMusicAiRoute({ fetchImpl: async () => ({ ok: false, status: 404, text: async () => 'missing' }) });
  assert.equal(missing.status, 404);
  assert.equal(missing.failureReason, 'endpoint returned 404');
  const invalid = await testMusicAiRoute({ fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'bad request' }) });
  assert.equal(invalid.failureReason, 'payload invalid');
  const method = await testMusicAiRoute({ fetchImpl: async () => ({ ok: false, status: 405, text: async () => 'nope' }) });
  assert.equal(method.failureReason, 'method mismatch (expected POST)');
  const backend = await testMusicAiRoute({ fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'server' }) });
  assert.equal(backend.failureReason, 'backend/provider error');
  const fail = await testMusicAiRoute({ fetchImpl: async () => { throw new Error('Failed to fetch'); } });
  assert.equal(fail.ok, false);
  assert.equal(fail.status, 0);
});

test('canonical success response preserves output and provider execution truth', () => {
  const result = normalizeMusicAiResponse({
    output_text: '{"summary":"ready"}',
    data: {
      execution_metadata: {
        requested_provider: 'ollama',
        selected_provider: 'ollama',
        actual_provider_used: 'gemini',
        model_used: 'gemini-2.5-flash',
        fallback_used: true,
        fallback_reason: 'ollama unavailable',
      },
    },
  });
  assert.equal(result.text, '{"summary":"ready"}');
  assert.equal(result.requestedProvider, 'ollama');
  assert.equal(result.selectedProvider, 'ollama');
  assert.equal(result.actualProvider, 'gemini');
  assert.equal(result.actualModel, 'gemini-2.5-flash');
  assert.equal(result.fallbackUsed, true);
});

test('standalone Music Tile restores persisted canonical routing policy', async () => {
  const originalStorage = globalThis.localStorage;
  const originalRuntimeStatus = globalThis.runtimeStatusModel;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  values.set('stephanos.session.memory.v1', JSON.stringify({
    session: {
      providerPreferences: {
        provider: 'groq',
        routeMode: 'explicit',
        fallbackEnabled: false,
        fallbackOrder: ['gemini', 'ollama'],
        providerConfigs: { groq: { model: 'openai/gpt-oss-20b', apiKey: 'must-not-cross-transport', privateDraftNote: 'secret-adjacent' } },
      },
    },
  }));
  let requestPayload;
  try {
    globalThis.runtimeStatusModel = {
      providerPreferences: {
        provider: 'groq',
        routeMode: 'explicit',
        fallbackEnabled: false,
        fallbackOrder: ['gemini', 'ollama'],
        providerConfigs: {
          groq: {
            model: 'openai/gpt-oss-20b',
            apiKey: 'must-not-cross-transport',
            privateDraftNote: 'secret-adjacent',
          },
        },
      },
    };
    await testMusicAiRoute({
      fetchImpl: async (_url, options) => {
        requestPayload = JSON.parse(options.body);
        return { ok: true, status: 200, text: async () => '{"output_text":"MUSIC_AI_ROUTE_OK"}' };
      },
    });
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalRuntimeStatus === undefined) delete globalThis.runtimeStatusModel;
    else globalThis.runtimeStatusModel = originalRuntimeStatus;
  }
  assert.equal(requestPayload.provider, 'groq');
  assert.equal(requestPayload.routeMode, 'explicit');
  assert.equal(requestPayload.fallbackEnabled, false);
  assert.deepEqual(requestPayload.fallbackOrder, ['gemini', 'ollama']);
  assert.equal(Object.hasOwn(requestPayload.providerConfig, 'apiKey'), false);
  assert.equal(Object.hasOwn(requestPayload.providerConfigs.groq, 'privateDraftNote'), false);
});

test('status messaging keeps rule fallback without declaring 200 as unavailable', () => {
  assert.match(musicTileJs, /AI ready —/);
  assert.match(musicTileJs, /Rule-based parser remains available\./);
  assert.match(musicTileJs, /OpenClaw agents are a separate route\./);
  assert.match(musicTileJs, /AI route missing\./);
  assert.match(musicTileJs, /AI backend unreachable\/network error\./);
});
