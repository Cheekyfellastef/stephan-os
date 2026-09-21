import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveUnlinkedDeckTracks } from '../apps/music-tile/engine/nativeCatalogAutoApply.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';
const SPOTIFY_URL = `https://open.spotify.com/track/${SPOTIFY_ID}`;
const SPOTIFY_URI = `spotify:track:${SPOTIFY_ID}`;

function createStorage(snapshot) {
  const state = new Map([[STORAGE_KEY, JSON.stringify(snapshot)]]);
  return {
    getItem(key) {
      return state.has(key) ? state.get(key) : null;
    },
    setItem(key, value) {
      state.set(key, String(value));
    },
  };
}

function successfulCatalogueResponse() {
  return {
    ok: true,
    async json() {
      return {
        ok: true,
        provider: 'spotify',
        results: [{
          provider: 'spotify',
          providerLabel: 'Spotify',
          providerItemId: SPOTIFY_ID,
          providerUrl: SPOTIFY_URL,
          title: 'Enjoy the Silence',
          artist: 'Depeche Mode',
          confidence: 'high',
          verificationStatus: 'metadata_verified',
          playbackAvailability: 'playback_unverified',
          spotifyUrl: SPOTIFY_URL,
          spotifyUri: SPOTIFY_URI,
        }],
      };
    },
  };
}

test('automatic Music links recover after a transient first catalogue failure', async () => {
  const storage = createStorage({
    candidates: [],
    listeningDeck: [{
      id: 'retry-proof-track',
      title: 'Enjoy the Silence',
      artist: 'Depeche Mode',
      candidateVerificationStatus: 'search-only',
    }],
    ratings: {},
    tags: {},
    trackFeedback: {},
    linkMessages: {},
  });

  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount === 1) throw new TypeError('simulated Battle Bridge catalogue startup race');
    return successfulCatalogueResponse();
  };

  const first = await resolveUnlinkedDeckTracks({ storage, fetchImpl, timeoutMs: 100 });
  assert.equal(first.ok, true);
  assert.equal(first.resolvedCount, 0);
  assert.equal(first.retryableCount, 1);
  assert.equal(requestCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 800));

  const second = await resolveUnlinkedDeckTracks({ storage, fetchImpl, timeoutMs: 100 });
  assert.equal(second.ok, true);
  assert.equal(second.resolvedCount, 1);
  assert.equal(requestCount, 2);

  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  const track = persisted.listeningDeck[0];
  assert.equal(track.spotifyUrl, SPOTIFY_URL);
  assert.equal(track.spotifyUri, SPOTIFY_URI);
  assert.equal(track.catalogVerificationStatus, 'metadata_verified');
  assert.equal(track.catalogLinkSource, 'native-catalog-search');
  assert.equal(second.retryableCount, 0);
});
