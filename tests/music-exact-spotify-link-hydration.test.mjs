import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExactSpotifyLinkCards } from '../apps/music-tile/engine/exactSpotifyLinkHydration.js';
import { getSpotifyTrackById } from '../stephanos-server/services/spotifyClient.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const TRACK_URL = `https://open.spotify.com/track/${TRACK_ID}`;
const ARTWORK_URL = 'https://i.scdn.co/image/ab67616d00001e02f7f1f53af3505f5638d7d8b1';

function exactPayload(overrides = {}) {
  return {
    ok: true,
    configured: true,
    provider: 'spotify',
    providerLabel: 'Spotify',
    exactLookup: true,
    result: {
      universalId: `spotify:track:${TRACK_ID}`,
      provider: 'spotify',
      providerItemId: TRACK_ID,
      providerLabel: 'Spotify',
      providerUrl: TRACK_URL,
      title: 'Enjoy the Silence',
      artist: 'Depeche Mode',
      album: 'Violator',
      releaseDate: '1990-03-19',
      isrc: 'GBS849000190',
      durationMs: 248000,
      artworkUrl: ARTWORK_URL,
      confidence: 'high',
      confidenceScore: 100,
      verificationStatus: 'metadata_verified',
      playbackAvailability: 'playback_unverified',
      spotifyUrl: TRACK_URL,
      spotifyUri: `spotify:track:${TRACK_ID}`,
      spotifySearchUrl: 'https://open.spotify.com/search/Depeche%20Mode%20Enjoy%20the%20Silence',
      ...overrides,
    },
  };
}

function storageWith(snapshot) {
  const data = new Map([[STORAGE_KEY, JSON.stringify(snapshot)]]);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('exact Spotify client lookup binds one track id instead of fuzzy search', async () => {
  const requests = [];
  const result = await getSpotifyTrackById({
    trackId: TRACK_ID,
    env: { SPOTIFY_CLIENT_ID: 'client', SPOTIFY_CLIENT_SECRET: 'secret' },
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).includes('/api/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'token', expires_in: 3600 }),
        };
      }
      assert.equal(String(url), `https://api.spotify.com/v1/tracks/${TRACK_ID}`);
      return {
        ok: true,
        json: async () => ({ id: TRACK_ID, name: 'Enjoy the Silence' }),
      };
    },
  });
  assert.equal(result.id, TRACK_ID);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/tracks\/4uLU6hMCjMI75M1A2tKUQC$/);
});

test('pasted Spotify link hydrates canonical card metadata and artwork without touching ratings or feedback', async () => {
  const storage = storageWith({
    listeningDeck: [{
      id: 'manual-spotify-link',
      title: 'Spotify track',
      artist: 'Unknown',
      spotifyUrl: TRACK_URL,
      spotifyUri: `spotify:track:${TRACK_ID}`,
      candidateVerificationStatus: 'verified',
      lane: 'Manual URL import',
    }],
    ratings: { 'manual-spotify-link': 2 },
    tags: { 'manual-spotify-link': ['ghost in the track'] },
    trackFeedback: { 'manual-spotify-link': 'Keep this.' },
  });
  let requestedUrl = '';
  const result = await resolveExactSpotifyLinkCards({
    storage,
    now: () => 1000,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return { ok: true, json: async () => exactPayload() };
    },
  });
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  const track = stored.listeningDeck[0];
  assert.equal(result.ok, true);
  assert.equal(result.attemptedCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.equal(requestedUrl, `/api/music/catalog/track?id=${TRACK_ID}`);
  assert.equal(track.title, 'Enjoy the Silence');
  assert.equal(track.artist, 'Depeche Mode');
  assert.equal(track.album, 'Violator');
  assert.equal(track.artworkUrl, ARTWORK_URL);
  assert.equal(track.artworkSource, 'spotify-catalogue');
  assert.equal(track.catalogProviderItemId, TRACK_ID);
  assert.equal(track.exactSpotifyLinkHydrated, true);
  assert.equal(track.candidateVerificationStatus, 'verified');
  assert.equal(stored.ratings['manual-spotify-link'], 2);
  assert.deepEqual(stored.tags['manual-spotify-link'], ['ghost in the track']);
  assert.equal(stored.trackFeedback['manual-spotify-link'], 'Keep this.');
});

test('exact link hydration fails closed when provider metadata belongs to another Spotify id', async () => {
  const storage = storageWith({
    listeningDeck: [{
      id: 'manual-wrong-id',
      title: 'Spotify track',
      artist: 'Unknown',
      spotifyUrl: TRACK_URL,
      spotifyUri: `spotify:track:${TRACK_ID}`,
      candidateVerificationStatus: 'verified',
    }],
    ratings: {},
    tags: {},
    trackFeedback: {},
  });
  const result = await resolveExactSpotifyLinkCards({
    storage,
    now: () => 2000,
    fetchImpl: async () => ({
      ok: true,
      json: async () => exactPayload({
        providerItemId: '0VjIjW4GlUZAMYd2vXMi3b',
        spotifyUrl: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
        spotifyUri: 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b',
      }),
    }),
  });
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(result.resolvedCount, 0);
  assert.equal(stored.listeningDeck[0].title, 'Spotify track');
  assert.equal(stored.listeningDeck[0].artworkUrl, undefined);
});

test('transient exact-link failure becomes retryable instead of blacklisting the card for the page session', async () => {
  const retryId = '6rqhFgbbKwnb9MLmUQDhG6';
  const retryUrl = `https://open.spotify.com/track/${retryId}`;
  const storage = storageWith({
    listeningDeck: [{
      id: 'manual-retry',
      title: 'Spotify track',
      artist: 'Unknown',
      spotifyUrl: retryUrl,
      spotifyUri: `spotify:track:${retryId}`,
      candidateVerificationStatus: 'verified',
    }],
    ratings: {}, tags: {}, trackFeedback: {},
  });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, json: async () => ({ ok: false }) };
    return {
      ok: true,
      json: async () => ({
        ...exactPayload(),
        result: {
          ...exactPayload().result,
          universalId: `spotify:track:${retryId}`,
          providerItemId: retryId,
          providerUrl: retryUrl,
          spotifyUrl: retryUrl,
          spotifyUri: `spotify:track:${retryId}`,
        },
      }),
    };
  };
  const first = await resolveExactSpotifyLinkCards({ storage, fetchImpl, now: () => 0 });
  const held = await resolveExactSpotifyLinkCards({ storage, fetchImpl, now: () => 1000 });
  const retried = await resolveExactSpotifyLinkCards({ storage, fetchImpl, now: () => 6000 });
  assert.equal(first.resolvedCount, 0);
  assert.equal(held.attemptedCount, 0);
  assert.equal(retried.resolvedCount, 1);
  assert.equal(calls, 2);
});
