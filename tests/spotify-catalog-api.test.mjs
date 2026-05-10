import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpotifyConfigDiagnostics, getSpotifyAccessToken } from '../stephanos-server/services/spotifyClient.js';
import { scoreSpotifyMatch } from '../stephanos-server/routes/music.js';

test('missing env returns configured false', () => {
  const d = getSpotifyConfigDiagnostics({});
  assert.equal(d.configured, false);
});

test('token helper uses client credentials', async () => {
  const original = global.fetch;
  let seenAuth = '';
  global.fetch = async (_url, options) => { seenAuth = String(options?.headers?.Authorization || ''); return { ok: true, json: async () => ({ access_token: 'abc', expires_in: 3600 }) }; };
  const token = await getSpotifyAccessToken({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
  assert.equal(token, 'abc');
  assert.match(seenAuth, /^Basic /);
  global.fetch = original;
});

test('confidence scoring works', () => {
  const high = scoreSpotifyMatch({ artist: 'Anyma', title: 'Pictures Of You' }, { name: 'Pictures Of You', artists: [{ name: 'Anyma' }] });
  assert.equal(high.confidence, 'high');
});
