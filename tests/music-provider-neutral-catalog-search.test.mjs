import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMusicBrainzSearchClient,
  normalizeCatalogQuery,
  normalizeMusicBrainzRecording,
  normalizeSpotifyTrack,
  searchProviderNeutralCatalog,
} from '../stephanos-server/services/musicCatalogSearch.js';
import musicRouter from '../stephanos-server/routes/music.js';

const recording = {
  id: 'f1d2d2f9-0000-4000-8000-000000000001',
  title: 'Enjoy the Silence',
  score: 97,
  length: 252000,
  'artist-credit': [{ name: 'Depeche Mode' }],
  releases: [{ title: 'Violator', date: '1990' }],
  isrcs: ['GBF089000920'],
};

test('query normalization and result count are bounded', () => {
  assert.equal(normalizeCatalogQuery(`  ${'music '.repeat(50)}  `).length, 160);
});

test('MusicBrainz records become honest metadata-only universal results', () => {
  const result = normalizeMusicBrainzRecording(recording);
  assert.equal(result.provider, 'musicbrainz');
  assert.equal(result.artist, 'Depeche Mode');
  assert.equal(result.playbackAvailability, 'search_only');
  assert.equal(result.spotifyUrl, '');
  assert.equal(result.universalId, 'isrc:GBF089000920');
  assert.match(result.spotifySearchUrl, /^https:\/\/open\.spotify\.com\/search\//);
});

test('Spotify is preferred without requesting personal account access', async () => {
  const result = await searchProviderNeutralCatalog({
    query: 'Enjoy the Silence',
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
    spotifyDiagnostics: () => ({ configured: true }),
    spotifySearch: async () => ({ tracks: { items: [{ id: '4uLU6hMCjMI75M1A2tKUQC', name: 'Enjoy the Silence', artists: [{ name: 'Depeche Mode' }], external_ids: { isrc: 'GBF089000920' }, external_urls: { spotify: 'https://attacker.invalid/not-trusted' }, uri: 'spotify:track:not-trusted' }] } }),
    musicBrainzSearch: async () => { throw new Error('fallback should not run'); },
  });
  assert.equal(result.provider, 'spotify');
  assert.equal(result.authMode, 'application');
  assert.equal(result.personalAccountAccess, false);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.results[0].universalId, 'isrc:GBF089000920');
  assert.equal(result.results[0].spotifyUrl, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(result.results[0].verificationStatus, 'metadata_verified');
  assert.equal(result.results[0].playbackAvailability, 'playback_unverified');
});

test('Spotify normalization proves catalogue identity without claiming playable browser state', () => {
  const track = normalizeSpotifyTrack({
    id: '4uLU6hMCjMI75M1A2tKUQC',
    name: 'Enjoy the Silence',
    artists: [{ name: 'Depeche Mode' }],
  });
  assert.equal(track.verificationStatus, 'metadata_verified');
  assert.equal(track.playbackAvailability, 'playback_unverified');
  assert.match(track.spotifyUrl, /^https:\/\/open\.spotify\.com\/track\//);
});

test('missing Spotify credentials falls through to zero-configuration search', async () => {
  const result = await searchProviderNeutralCatalog({
    query: 'Enjoy the Silence',
    env: {},
    spotifyDiagnostics: () => ({ configured: false }),
    musicBrainzSearch: async () => [normalizeMusicBrainzRecording(recording)],
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'musicbrainz');
  assert.equal(result.authMode, 'none');
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.attempts[0], { provider: 'spotify', status: 'not_configured' });
});

test('Spotify denial falls through without surfacing credential setup', async () => {
  const result = await searchProviderNeutralCatalog({
    query: 'Enjoy the Silence',
    spotifyDiagnostics: () => ({ configured: true }),
    spotifySearch: async () => { const error = new Error('denied'); error.code = 'spotify_denied'; throw error; },
    musicBrainzSearch: async () => [normalizeMusicBrainzRecording(recording)],
  });
  assert.equal(result.provider, 'musicbrainz');
  assert.equal(result.results[0].spotifyUrl, '');
  assert.deepEqual(result.attempts[0], { provider: 'spotify', status: 'failed', reason: 'spotify_denied' });
});

test('a stalled Spotify provider is bounded before MusicBrainz fallback', async () => {
  const result = await searchProviderNeutralCatalog({
    query: 'Enjoy the Silence',
    spotifyTimeoutMs: 5,
    spotifyDiagnostics: () => ({ configured: true }),
    spotifySearch: async () => new Promise(() => {}),
    musicBrainzSearch: async () => [normalizeMusicBrainzRecording(recording)],
  });
  assert.equal(result.provider, 'musicbrainz');
  assert.deepEqual(result.attempts[0], { provider: 'spotify', status: 'failed', reason: 'spotify_timeout' });
});

test('MusicBrainz client identifies Stephanos and serializes calls to one per second', async () => {
  const starts = [];
  let clock = 0;
  const client = createMusicBrainzSearchClient({
    fetchImpl: async (_url, options) => {
      starts.push({ at: clock, userAgent: options.headers['User-Agent'] });
      return { ok: true, json: async () => ({ recordings: [recording] }) };
    },
    now: () => clock,
    sleep: async (delay) => { clock += delay; },
    minimumIntervalMs: 1000,
  });
  const [first, second] = await Promise.all([
    client({ query: 'Depeche Mode', limit: 99 }),
    client({ query: 'Anyma', limit: 5 }),
  ]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(starts[1].at - starts[0].at, 1000);
  assert.match(starts[0].userAgent, /StephanosOS/);
});

test('MusicBrainz request deadline includes time waiting for a start slot', async () => {
  let fetchCalls = 0;
  const client = createMusicBrainzSearchClient({
    fetchImpl: async (_url, options = {}) => {
      fetchCalls += 1;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    },
    minimumIntervalMs: 1000,
    timeoutMs: 5,
    sleep: async () => new Promise(() => {}),
  });
  const first = client({ query: 'first' }).catch((error) => error);
  const secondError = await client({ query: 'second' }).catch((error) => error);
  await first;
  assert.equal(secondError.code, 'musicbrainz_timeout');
  assert.equal(fetchCalls, 1);
});

test('malformed external provider identities are rejected', async () => {
  const result = await searchProviderNeutralCatalog({
    query: 'malformed result',
    spotifyDiagnostics: () => ({ configured: true }),
    spotifySearch: async () => ({ tracks: { items: [{ id: '../../secret', name: 'Bad', artists: [{ name: 'Bad' }] }] } }),
    musicBrainzSearch: async () => [],
  });
  assert.equal(result.provider, 'musicbrainz');
  assert.deepEqual(result.results, []);
});

test('provider-neutral route rejects missing and oversized queries before provider access', async () => {
  const layer = musicRouter.stack.find((entry) => entry.route?.path === '/catalog/search');
  async function invoke(query) {
    let status = 200;
    let payload = null;
    await layer.route.stack[0].handle({ query }, {
      set() {},
      status(nextStatus) { status = nextStatus; return this; },
      json(nextPayload) { payload = nextPayload; return this; },
    });
    return { status, payload };
  }
  const missing = await invoke({});
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.payload.results, []);
  const oversized = await invoke({ q: 'x'.repeat(161) });
  assert.equal(oversized.status, 400);
  assert.match(oversized.payload.error, /160 characters/);
});


test('Spotify catalogue normalization carries only trusted CDN artwork', () => {
  const trusted = normalizeSpotifyTrack({
    id: '4uLU6hMCjMI75M1A2tKUQC',
    name: 'Enjoy the Silence',
    artists: [{ name: 'Depeche Mode' }],
    album: { images: [{ url: 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1' }] },
  });
  assert.equal(trusted.artworkUrl, 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1');
  const untrusted = normalizeSpotifyTrack({
    id: '4uLU6hMCjMI75M1A2tKUQC',
    name: 'Enjoy the Silence',
    artists: [{ name: 'Depeche Mode' }],
    album: { images: [{ url: 'https://attacker.invalid/cover.jpg' }] },
  });
  assert.equal(untrusted.artworkUrl, '');
});
