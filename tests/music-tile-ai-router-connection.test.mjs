import test from 'node:test';
import assert from 'node:assert/strict';
import { getMusicAiRuntimeDiagnostics, testMusicAiRoute } from '../apps/music-tile/engine/musicAiBridge.js';

test('Music AI bridge preserves canonical /api/ai/chat path', () => {
  const diag = getMusicAiRuntimeDiagnostics();
  assert.equal(diag.endpointPath, '/api/ai/chat');
  assert.match(diag.endpointUrl, /\/api\/ai\/chat$/);
});

test('AI route test handles success, 404, and fetch failure', async () => {
  const ok = await testMusicAiRoute({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"reply":"MUSIC_AI_ROUTE_OK"}' }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.method, 'POST');
  assert.match(ok.requestUrl, /\/api\/ai\/chat$/);
  assert.equal(ok.parsedText, 'MUSIC_AI_ROUTE_OK');
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
