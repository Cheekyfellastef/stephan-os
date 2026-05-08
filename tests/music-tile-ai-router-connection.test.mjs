import test from 'node:test';
import assert from 'node:assert/strict';
import { getMusicAiRuntimeDiagnostics, testMusicAiRoute } from '../apps/music-tile/engine/musicAiBridge.js';

test('Music AI bridge preserves canonical /api/ai/chat path', () => {
  const diag = getMusicAiRuntimeDiagnostics();
  assert.equal(diag.endpointPath, '/api/ai/chat');
  assert.match(diag.endpointUrl, /\/api\/ai\/chat$/);
});

test('AI route test handles success, 404, and fetch failure', async () => {
  const ok = await testMusicAiRoute({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }) });
  assert.equal(ok.ok, true);
  const missing = await testMusicAiRoute({ fetchImpl: async () => ({ ok: false, status: 404, text: async () => 'missing' }) });
  assert.equal(missing.status, 404);
  const fail = await testMusicAiRoute({ fetchImpl: async () => { throw new Error('Failed to fetch'); } });
  assert.equal(fail.ok, false);
  assert.equal(fail.status, 0);
});
