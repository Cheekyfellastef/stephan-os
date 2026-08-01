import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  catalogResultToMusicTileTrack,
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
