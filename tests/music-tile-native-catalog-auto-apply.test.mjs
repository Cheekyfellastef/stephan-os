import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  findExistingCatalogTrack,
  mergeCatalogResultIntoExistingTrack,
  planCatalogResultEnrichment,
} from '../apps/music-tile/engine/nativeCatalogSearch.js';
import { mergePersistedCatalogState } from '../apps/music-tile/engine/nativeCatalogAutoApply.js';

const SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';
const SPOTIFY_URL = `https://open.spotify.com/track/${SPOTIFY_ID}`;
const SPOTIFY_URI = `spotify:track:${SPOTIFY_ID}`;
const OTHER_SPOTIFY_URI = 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b';

function verifiedResult(overrides = {}) {
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
    ...overrides,
  };
}

function existingTrack(overrides = {}) {
  return {
    id: 'journey-enjoy-the-silence',
    title: 'Enjoy the Silence',
    artist: 'Depeche Mode',
    lane: 'doorway-track',
    sourceKind: 'journey-candidate',
    candidateVerificationStatus: 'search-only',
    traits: ['dark club pressure'],
    ...overrides,
  };
}

test('metadata-verified Spotify results enrich an existing card without replacing its identity or lane', () => {
  const track = existingTrack();
  const result = mergeCatalogResultIntoExistingTrack(track, verifiedResult());
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(track.id, 'journey-enjoy-the-silence');
  assert.equal(track.lane, 'doorway-track');
  assert.equal(track.sourceKind, 'journey-candidate');
  assert.equal(track.candidateVerificationStatus, 'search-only');
  assert.deepEqual(track.traits, ['dark club pressure']);
  assert.equal(track.spotifyUrl, SPOTIFY_URL);
  assert.equal(track.spotifyUri, SPOTIFY_URI);
  assert.equal(track.catalogVerificationStatus, 'metadata_verified');
  assert.equal(track.catalogPlaybackAvailability, 'playback_unverified');
  assert.equal(track.catalogLinkSource, 'native-catalog-search');
});

test('duplicate detection enriches before the existing-card control is disabled and retries are idempotent', () => {
  const track = existingTrack();
  assert.equal(findExistingCatalogTrack([track], verifiedResult()), track);
  assert.equal(track.spotifyUri, SPOTIFY_URI);
  const retry = planCatalogResultEnrichment(track, verifiedResult());
  assert.equal(retry.ok, true);
  assert.equal(retry.changed, false);
});

test('unverified catalogue rows and mismatched identities cannot mutate an existing card', () => {
  const unverifiedTrack = existingTrack();
  const unverified = mergeCatalogResultIntoExistingTrack(unverifiedTrack, verifiedResult({ verificationStatus: 'search_only' }));
  assert.equal(unverified.ok, false);
  assert.equal(unverified.reason, 'catalogue-metadata-not-verified');
  assert.equal(unverifiedTrack.spotifyUrl, undefined);

  const wrongIdentity = existingTrack();
  const mismatch = mergeCatalogResultIntoExistingTrack(wrongIdentity, verifiedResult({ title: 'Personal Jesus' }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'catalogue-identity-mismatch');
  assert.equal(wrongIdentity.spotifyUrl, undefined);
});

test('an existing different Spotify track fails closed and is never overwritten', () => {
  const track = existingTrack({
    spotifyUrl: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    spotifyUri: OTHER_SPOTIFY_URI,
  });
  const result = mergeCatalogResultIntoExistingTrack(track, verifiedResult());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'spotify-track-conflict');
  assert.equal(track.spotifyUri, OTHER_SPOTIFY_URI);
});

test('persisted Music Tile state receives the canonical URL while ratings, tags and feedback remain unchanged', () => {
  const snapshot = {
    listeningDeck: [existingTrack()],
    ratings: { 'journey-enjoy-the-silence': 2 },
    tags: { 'journey-enjoy-the-silence': ['ghost in the track'] },
    trackFeedback: { 'journey-enjoy-the-silence': 'Keep this.' },
  };
  const planned = planCatalogResultEnrichment(snapshot.listeningDeck[0], verifiedResult());
  const result = mergePersistedCatalogState(snapshot, {
    trackId: 'journey-enjoy-the-silence',
    artist: 'Depeche Mode',
    title: 'Enjoy the Silence',
    spotifyUrl: planned.spotify.openUrl,
    spotifyUri: planned.spotify.uri,
    enrichment: planned.enrichment,
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(snapshot.listeningDeck[0].spotifyUrl, SPOTIFY_URL);
  assert.equal(snapshot.ratings['journey-enjoy-the-silence'], 2);
  assert.deepEqual(snapshot.tags['journey-enjoy-the-silence'], ['ghost in the track']);
  assert.equal(snapshot.trackFeedback['journey-enjoy-the-silence'], 'Keep this.');
});

test('the browser adapter fills and persists the card without embedding or promoting playback truth', async () => {
  const source = await readFile(new URL('../apps/music-tile/engine/nativeCatalogAutoApply.js', import.meta.url), 'utf8');
  assert.match(source, /input\.value = spotify\.openUrl/);
  assert.match(source, /globalThis\.localStorage\.setItem\(STORAGE_KEY/);
  assert.match(source, /Open in Spotify/);
  assert.match(source, /browser playback not yet verified/);
  assert.match(source, /MutationObserver/);
  assert.doesNotMatch(source, /createElement\(['"]iframe['"]\)|embedUrl|candidateVerificationStatus\s*=/);
});
