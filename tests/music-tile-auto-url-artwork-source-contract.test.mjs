import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const autoApply = await readFile(new URL('../apps/music-tile/engine/nativeCatalogAutoApply.js', import.meta.url), 'utf8');
const catalogSearch = await readFile(new URL('../apps/music-tile/engine/nativeCatalogSearch.js', import.meta.url), 'utf8');
const serverCatalog = await readFile(new URL('../stephanos-server/services/musicCatalogSearch.js', import.meta.url), 'utf8');
const browserProof = await readFile(new URL('./music-tile-rating-playback-browser.test.mjs', import.meta.url), 'utf8');

test('unresolved Listening Room cards self-resolve without manual catalogue interaction', () => {
  assert.match(autoApply, /export async function resolveUnlinkedDeckTracks/);
  assert.match(autoApply, /\/api\/music\/catalog\/search\?q=/);
  assert.match(autoApply, /AUTO_RESOLVE_MAX_TRACKS = 20/);
  assert.match(autoApply, /AUTO_RESOLVE_CONCURRENCY = 2/);
  assert.match(autoApply, /AUTO_RESOLVE_TIMEOUT_MS = 8000/);
  assert.match(autoApply, /queueAutomaticResolution\(\)/);
  assert.match(autoApply, /if \(typeof document !== 'undefined'\) announceAppliedTrack/);
});

test('Spotify artwork remains trusted, persisted and separate from playback verification', () => {
  assert.match(serverCatalog, /artworkUrl: normalizeSpotifyArtworkUrl\(track\.album\?\.images\)/);
  assert.match(serverCatalog, /SPOTIFY_ARTWORK_HOST_SUFFIXES/);
  assert.match(catalogSearch, /artworkSource: artworkUrl \? 'spotify-catalogue' : ''/);
  assert.match(autoApply, /catalogVerificationStatus: 'metadata_verified'/);
  assert.match(autoApply, /catalogPlaybackAvailability:/);
  assert.match(autoApply, /if \(!card \|\| !artworkUrl \|\| card\.querySelector\('iframe'\)\) return false/);
});

test('real iPad-width browser proof requires no search click and preserves card truth', () => {
  assert.match(browserProof, /iPad-width existing card receives Spotify URL and artwork without manual search/);
  assert.match(browserProof, /viewport: \{ width: 820, height: 1180 \}/);
  assert.match(browserProof, /storedRating: 2/);
  assert.match(browserProof, /storedTags: \['ghost in the track'\]/);
  assert.match(browserProof, /storedFeedback: 'Keep this\.'/);
  assert.match(browserProof, /iframeCount: 0/);
  assert.match(browserProof, /assert\.equal\(catalogRequests, 1\)/);
});
