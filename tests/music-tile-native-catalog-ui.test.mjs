import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  catalogResultToMusicTileTrack,
  DEFAULT_BROWSER_TIMEOUT_MS,
  DEFAULT_PROVIDER_ATTEMPT_TIMEOUT_MS,
  findExistingCatalogTrack,
  requestNativeCatalogSearch,
} from '../apps/music-tile/engine/nativeCatalogSearch.js';

const html = await readFile(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('native search is in the primary experience and hides provider/setup choices', () => {
  assert.match(html, /id="native-music-search-form"/);
  assert.match(html, /Find a song, artist or sound/);
  const primaryExperience = html.slice(0, html.indexOf('<details class="advanced-studio"'));
  assert.doesNotMatch(primaryExperience, /SPOTIFY_CLIENT_SECRET|\.env|OAuth|provider selector/i);
});

test('catalog results become stable universal cards and deduplicate', () => {
  const result = { universalId: 'musicbrainz:recording:one', provider: 'musicbrainz', providerItemId: 'one', providerLabel: 'MusicBrainz', title: 'Track', artist: 'Artist' };
  const track = catalogResultToMusicTileTrack(result);
  assert.equal(track.id, 'musicbrainz:recording:one');
  assert.equal(track.candidateVerificationStatus, 'search-only');
  assert.equal(findExistingCatalogTrack([track], result), track);
  assert.equal(findExistingCatalogTrack([track], { universalId: 'spotify:track:different', provider: 'spotify', providerItemId: 'different', title: 'Track', artist: 'Artist' }), track);
});

test('catalogue identity never claims browser playback verification', () => {
  const track = catalogResultToMusicTileTrack({
    universalId: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    provider: 'spotify',
    providerItemId: '4uLU6hMCjMI75M1A2tKUQC',
    title: 'Enjoy the Silence',
    artist: 'Depeche Mode',
    spotifyUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    verificationStatus: 'metadata_verified',
    playbackAvailability: 'playback_unverified',
  });
  assert.equal(track.candidateVerificationStatus, 'search-only');
  assert.equal(track.verificationStatus, 'catalogue_identity_only');
  assert.equal(track.catalogVerificationStatus, 'metadata_verified');
  assert.equal(track.catalogPlaybackAvailability, 'playback_unverified');
});

test('catalogue metadata is escaped at persistent card and presence HTML sinks', () => {
  assert.match(main, /escapeHtml\(track\.artist \|\| 'Unknown Artist'\)/);
  assert.match(main, /escapeHtml\(track\.verificationNote\)/);
  assert.match(main, /escapeHtml\(item\.summary \|\| item\.kind\)/);
  assert.match(main, /escapeHtml\(item\.impact \|\| ''\)/);
});

test('browser request is bounded and uses one provider-neutral endpoint', async () => {
  let requestedUrl = '';
  const response = await requestNativeCatalogSearch('  Enjoy   the Silence  ', {
    limit: 99,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => ({ ok: true, results: [] }) };
    },
  });
  assert.equal(response.ok, true);
  assert.match(requestedUrl, /^\/api\/music\/catalog\/search\?/);
  assert.match(requestedUrl, /limit=10/);
  assert.doesNotMatch(requestedUrl, /spotify|musicbrainz/);
});

test('browser catalogue deadline bounds both transport and response body', async () => {
  const transport = await requestNativeCatalogSearch('stalled transport', {
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {}),
  });
  assert.equal(transport.ok, false);
  assert.match(transport.error, /timed out/i);
  const body = await requestNativeCatalogSearch('stalled body', {
    timeoutMs: 5,
    fetchImpl: async () => ({ ok: true, json: async () => new Promise(() => {}) }),
  });
  assert.equal(body.ok, false);
  assert.match(body.error, /timed out/i);
});

test('default browser deadline covers Spotify and fallback provider attempts', () => {
  assert.ok(DEFAULT_BROWSER_TIMEOUT_MS > DEFAULT_PROVIDER_ATTEMPT_TIMEOUT_MS * 2);
});

test('catalogue Spotify links remain reachable without claiming browser playback', () => {
  assert.match(main, /const hasValidatedCatalogLink = track\.sourceKind === 'native-catalog' && track\.catalogVerificationStatus === 'metadata_verified'/);
  assert.match(main, /const hasReachableSpotifyTrack = spotifyRef\.valid && spotifyRef\.type === 'track' && \(verifiedCandidate \|\| hasValidatedCatalogLink\)/);
  assert.match(main, /const hasPlayableSpotifyTrack = verifiedCandidate && hasReachableSpotifyTrack/);
  assert.match(main, /const spotifyOpenUrl = hasReachableSpotifyTrack \? spotifyRef\.openUrl : ''/);
});

test('card insertion preserves existing player DOM instead of rebuilding playback', () => {
  const start = main.indexOf('function addNativeCatalogResultToListeningRoom');
  const end = main.indexOf('\n\nfunction insertListeningDeckCardWithoutPlaybackReset', start);
  const implementation = main.slice(start, end);
  assert.match(implementation, /insertListeningDeckCardWithoutPlaybackReset\(track\)/);
  assert.doesNotMatch(implementation, /renderListeningDeck\(\)/);
  assert.doesNotMatch(implementation, /renderAll\(/);
  const insertionStart = main.indexOf('function insertListeningDeckCardWithoutPlaybackReset');
  const insertionEnd = main.indexOf('\n\nfunction renderNativeCatalogResults', insertionStart);
  const insertion = main.slice(insertionStart, insertionEnd);
  assert.match(insertion, /document\.createElement\('div'\)/);
  assert.match(insertion, /liveDeck\.prepend\(newCard\)/);
  assert.doesNotMatch(insertion, /liveDeck\.innerHTML|replaceWith\(/);
});
