import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpotifyConfigDiagnostics, getSpotifyAccessToken, searchSpotifyCatalog } from '../stephanos-server/services/spotifyClient.js';
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

test('Spotify HTTP calls abort instead of hanging indefinitely', async () => {
  let receivedSignal = false;
  const fetchImpl = async (_url, options = {}) => new Promise((resolve, reject) => {
    receivedSignal = options.signal instanceof AbortSignal;
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  await assert.rejects(
    searchSpotifyCatalog({
      query: 'timeout',
      env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
      fetchImpl,
      timeoutMs: 5,
    }),
    (error) => error?.code === 'spotify_timeout',
  );
  assert.equal(receivedSignal, true);
});

test('Spotify timeout remains active while the response body is parsed', async () => {
  let requestSignal;
  const fetchImpl = async (url, options = {}) => {
    requestSignal = options.signal;
    if (String(url).includes('/api/token')) {
      return { ok: true, json: async () => ({ access_token: 'body-timeout-token', expires_in: 3600 }) };
    }
    return {
      ok: true,
      json: async () => new Promise((resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      }),
    };
  };
  await assert.rejects(
    searchSpotifyCatalog({
      query: 'body timeout',
      env: { SPOTIFY_CLIENT_ID: 'body-timeout-id', SPOTIFY_CLIENT_SECRET: 'body-timeout-secret' },
      fetchImpl,
      timeoutMs: 5,
    }),
    (error) => error?.code === 'spotify_timeout',
  );
  assert.equal(requestSignal.aborted, true);
});

test('confidence scoring works', () => {
  const high = scoreSpotifyMatch({ artist: 'Anyma', title: 'Pictures Of You' }, { name: 'Pictures Of You', artists: [{ name: 'Anyma' }] });
  assert.equal(high.confidence, 'high');
});
