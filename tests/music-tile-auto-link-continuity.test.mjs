import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runCatalogLinkContinuityPass } from '../apps/music-tile/engine/nativeCatalogLinkContinuity.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';
const SPOTIFY_URL = `https://open.spotify.com/track/${SPOTIFY_ID}`;
const SPOTIFY_URI = `spotify:track:${SPOTIFY_ID}`;

function memoryStorage(snapshot) {
  const values = new Map([[STORAGE_KEY, JSON.stringify(snapshot)]]);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function verifiedResult() {
  return {
    universalId: `spotify:track:${SPOTIFY_ID}`,
    provider: 'spotify',
    providerItemId: SPOTIFY_ID,
    providerLabel: 'Spotify',
    providerUrl: SPOTIFY_URL,
    title: 'Enjoy the Silence',
    artist: 'Depeche Mode',
    album: 'Violator',
    confidence: 'high',
    verificationStatus: 'metadata_verified',
    playbackAvailability: 'playback_unverified',
    spotifyUrl: SPOTIFY_URL,
    spotifyUri: SPOTIFY_URI,
  };
}

function persistEnrichment(storage) {
  return (detail) => {
    const snapshot = JSON.parse(storage.getItem(STORAGE_KEY));
    const track = snapshot.listeningDeck.find((item) => item.id === detail.trackId);
    if (!track) return { ok: false, changed: false, reason: 'missing-track' };
    Object.assign(track, detail.enrichment);
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return { ok: true, changed: true };
  };
}

function unavailableYouTubeResponse() {
  return {
    ok: true,
    async json() { return { ok: false, reason: 'youtube-exact-track-not-proven', result: null }; },
  };
}

test('a transient catalogue failure is retried and the missing Spotify link is populated automatically', async () => {
  const storage = memoryStorage({
    listeningDeck: [{
      id: 'auto-link-transient-proof',
      title: 'Enjoy the Silence',
      artist: 'Depeche Mode',
      candidateVerificationStatus: 'search-only',
    }],
  });

  let catalogRequests = 0;
  let youtubeRequests = 0;
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.startsWith('/api/music/catalog/search')) {
      catalogRequests += 1;
      if (catalogRequests === 1) {
        return {
          ok: false,
          async json() { return { ok: false, error: 'catalogue warming up' }; },
        };
      }
      return {
        ok: true,
        async json() { return { ok: true, results: [verifiedResult()] }; },
      };
    }
    if (requestUrl.startsWith('/api/music/youtube/resolve-track')) {
      youtubeRequests += 1;
      return unavailableYouTubeResponse();
    }
    throw new Error(`unexpected request ${requestUrl}`);
  };

  const options = {
    storage,
    fetchImpl,
    applyEnrichment: persistEnrichment(storage),
    retryDelays: [0, 0, 0],
    timeoutMs: 1000,
  };

  const first = await runCatalogLinkContinuityPass(options);
  assert.equal(first.attemptedCount, 1);
  assert.equal(first.resolvedCount, 0);
  assert.equal(first.pendingRetryCount, 1);

  const second = await runCatalogLinkContinuityPass(options);
  assert.equal(second.attemptedCount, 1);
  assert.equal(second.resolvedCount, 1);
  assert.equal(catalogRequests, 2);
  assert.equal(youtubeRequests, 1);
  assert.equal(catalogRequests + youtubeRequests, 3);

  const stored = JSON.parse(storage.getItem(STORAGE_KEY)).listeningDeck[0];
  assert.equal(stored.spotifyUrl, SPOTIFY_URL);
  assert.equal(stored.spotifyUri, SPOTIFY_URI);
  assert.equal(stored.catalogLinkSource, 'native-catalog-search');
  assert.equal(stored.catalogVerificationStatus, 'metadata_verified');
});

test('automatic link retries remain bounded when both catalogue and YouTube stay unavailable', async () => {
  const storage = memoryStorage({
    listeningDeck: [{
      id: 'auto-link-bounded-proof',
      title: 'Enjoy the Silence',
      artist: 'Depeche Mode',
    }],
  });

  let catalogRequests = 0;
  let youtubeRequests = 0;
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.startsWith('/api/music/catalog/search')) {
      catalogRequests += 1;
      return {
        ok: false,
        async json() { return { ok: false, error: 'still unavailable' }; },
      };
    }
    if (requestUrl.startsWith('/api/music/youtube/resolve-track')) {
      youtubeRequests += 1;
      return unavailableYouTubeResponse();
    }
    throw new Error(`unexpected request ${requestUrl}`);
  };

  const options = {
    storage,
    fetchImpl,
    applyEnrichment: persistEnrichment(storage),
    retryDelays: [0, 0, 0],
    timeoutMs: 1000,
  };

  await runCatalogLinkContinuityPass(options);
  await runCatalogLinkContinuityPass(options);
  await runCatalogLinkContinuityPass(options);
  const exhausted = await runCatalogLinkContinuityPass(options);

  assert.equal(catalogRequests, 3);
  assert.equal(youtubeRequests, 3);
  assert.equal(catalogRequests + youtubeRequests, 6);
  assert.equal(exhausted.attemptedCount, 0);
  assert.equal(exhausted.pendingRetryCount, 0);
});

test('the artwork continuity entry point also installs link continuity', async () => {
  const source = await readFile(new URL('../apps/music-tile/engine/catalogArtworkContinuity.js', import.meta.url), 'utf8');
  assert.match(source, /import '\.\/nativeCatalogLinkContinuity\.js';/);
});
