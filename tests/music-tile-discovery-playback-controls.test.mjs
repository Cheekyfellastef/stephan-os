import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSpotifySearchUrl, buildYouTubeSearchUrl, toSpotifyEmbedUrl } from '../apps/music-tile/utils/spotifyEmbed.js';

const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');

test('Anyma seeded journey returns at least 8 candidates path', () => {
  assert.match(js, /Math\.max\(8, unique.length\)/);
  assert.match(js, /ANYMA_SEEDED_CANDIDATES/);
});

test('discovery cards include queue + spotify/youtube actions', () => {
  assert.match(js, /Add to listening queue/);
  assert.match(js, /Open in Spotify/);
  assert.match(js, /Find on Spotify/);
  assert.match(js, /Open in YouTube/);
  assert.match(js, /Find on YouTube/);
});

test('listening deck keeps ratings/tags and spotify iframe contract', () => {
  assert.match(js, /loading="lazy"/);
  assert.match(js, /encrypted-media/);
  assert.match(js, /Needs Spotify link/);
  assert.match(js, /data-rate/);
  assert.match(js, /data-tag/);
});

test('search URLs are encoded', () => {
  assert.equal(buildSpotifySearchUrl({ artist: 'Anyma', title: 'Pictures Of You' }), 'https://open.spotify.com/search/Anyma%20Pictures%20Of%20You');
  assert.equal(buildYouTubeSearchUrl({ artist: 'Anyma', title: 'Pictures Of You' }), 'https://www.youtube.com/results?search_query=Anyma%20Pictures%20Of%20You');
});

test('spotify embed still parses valid refs', () => {
  assert.equal(toSpotifyEmbedUrl('spotify:track:abc123'), 'https://open.spotify.com/embed/track/abc123');
});

test('start journey and duplicate-avoid status strings present', () => {
  assert.match(js, /Starting journey for:/);
  assert.match(js, /already in Listening Deck/);
});

test('media button styling exists', () => {
  assert.match(css, /\.media-btn\.spotify/);
  assert.match(css, /\.media-btn\.youtube/);
});
