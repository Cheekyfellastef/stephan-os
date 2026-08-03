import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyAutomaticSpotifyMatchToTrack,
  installAutomaticSpotifyCardUrlBridge,
  selectAutomaticSpotifyTrackMatch,
} from '../apps/music-tile/engine/nativeCatalogSearch.js';

const source = await readFile(new URL('../apps/music-tile/engine/nativeCatalogSearch.js', import.meta.url), 'utf8');
const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const exactSpotifyResult = {
  provider: 'spotify',
  providerLabel: 'Spotify',
  providerItemId: TRACK_ID,
  providerUrl: `https://open.spotify.com/track/${TRACK_ID}`,
  spotifyUrl: `https://open.spotify.com/track/${TRACK_ID}`,
  spotifyUri: `spotify:track:${TRACK_ID}`,
  spotifySearchUrl: 'https://open.spotify.com/search/Depeche%20Mode%20Enjoy%20the%20Silence',
  title: 'Enjoy the Silence',
  artist: 'Depeche Mode',
  verificationStatus: 'metadata_verified',
  playbackAvailability: 'playback_unverified',
  confidence: 'high',
};

test('automatic card resolver selects one canonical exact Spotify title-and-artist match', () => {
  const match = selectAutomaticSpotifyTrackMatch(
    { title: 'Enjoy the Silence', artist: 'Depeche Mode' },
    [exactSpotifyResult],
  );
  assert.equal(match, exactSpotifyResult);
});

test('automatic card resolver accepts a primary artist inside featured-artist metadata', () => {
  const featured = { ...exactSpotifyResult, artist: 'Depeche Mode, Guest Artist' };
  assert.equal(
    selectAutomaticSpotifyTrackMatch({ title: 'Enjoy the Silence', artist: 'Depeche Mode' }, [featured]),
    featured,
  );
});

test('automatic card resolver rejects ambiguous exact matches rather than guessing', () => {
  const second = { ...exactSpotifyResult, providerItemId: '1A2B3C4D5E6F7G8H9I0J1K', spotifyUrl: 'https://open.spotify.com/track/1A2B3C4D5E6F7G8H9I0J1K', spotifyUri: 'spotify:track:1A2B3C4D5E6F7G8H9I0J1K' };
  assert.equal(
    selectAutomaticSpotifyTrackMatch({ title: 'Enjoy the Silence', artist: 'Depeche Mode' }, [exactSpotifyResult, second]),
    null,
  );
});

test('automatic card resolver rejects metadata-only, near-title and malformed Spotify evidence', () => {
  const track = { title: 'Enjoy the Silence', artist: 'Depeche Mode' };
  assert.equal(selectAutomaticSpotifyTrackMatch(track, [{ ...exactSpotifyResult, provider: 'musicbrainz' }]), null);
  assert.equal(selectAutomaticSpotifyTrackMatch(track, [{ ...exactSpotifyResult, title: 'Enjoy the Silence Remix' }]), null);
  assert.equal(selectAutomaticSpotifyTrackMatch(track, [{ ...exactSpotifyResult, providerItemId: 'short' }]), null);
  assert.equal(selectAutomaticSpotifyTrackMatch(track, [{ ...exactSpotifyResult, spotifyUrl: 'https://example.com/track' }]), null);
});

test('verified result is written into the existing track shape with canonical URL and URI', () => {
  const track = { id: 'existing-card', title: 'Enjoy the Silence', artist: 'Depeche Mode', aiSuggested: true };
  const result = applyAutomaticSpotifyMatchToTrack(track, exactSpotifyResult, () => '2026-08-03T14:00:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(track.spotifyUrl, `https://open.spotify.com/track/${TRACK_ID}`);
  assert.equal(track.spotifyUri, `spotify:track:${TRACK_ID}`);
  assert.equal(track.candidateVerificationStatus, 'user-confirmed');
  assert.equal(track.spotifyAutoResolutionState, 'resolved');
  assert.equal(track.spotifyAutoResolvedAt, '2026-08-03T14:00:00.000Z');
});

test('browser bridge fails closed when the Music Tile surface is unavailable', () => {
  assert.deepEqual(
    installAutomaticSpotifyCardUrlBridge({ documentRef: null, storage: null, fetchImpl: null }),
    { installed: false, blocker: 'MUSIC_TILE_BROWSER_SURFACE_UNAVAILABLE' },
  );
});

test('bridge uses the existing card save handler and suppresses only the full-deck rebuild', () => {
  assert.match(source, /invokeExistingSpotifySaveWithoutDeckRebuild/);
  assert.match(source, /\[data-action=\"save-spotify-link\"\]/);
  assert.match(source, /Object\.defineProperty\(deck, 'innerHTML'/);
  assert.match(source, /Object\.defineProperty\(deck, 'querySelectorAll'/);
  assert.match(source, /delete deck\.innerHTML/);
  assert.match(source, /delete deck\.querySelectorAll/);
  assert.match(source, /playbackDomPreserved: true/);
});

test('iPad normal path stays inside Stephanos and removes Spotify search deep-links from cards', () => {
  assert.match(source, /requestNativeCatalogSearch\(query, \{ fetchImpl, limit: 10 \}\)/);
  assert.match(source, /Get Spotify link automatically/);
  assert.match(source, /a\[href\*=\"open\.spotify\.com\/search\/\"\]/);
  assert.match(source, /Nothing was pasted or guessed/);
  assert.doesNotMatch(source, /window\.open\(/);
  assert.doesNotMatch(source, /window\.confirm\(/);
});

test('bridge auto-installs only in a browser and leaves Node imports inert', () => {
  assert.match(source, /typeof document !== 'undefined'/);
  assert.match(source, /typeof localStorage !== 'undefined'/);
  assert.match(source, /queueMicrotask\(\(\) => installAutomaticSpotifyCardUrlBridge\(\)\)/);
});
