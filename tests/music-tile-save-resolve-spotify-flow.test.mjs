import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSpotifyReference } from '../apps/music-tile/utils/spotifyEmbed.js';

const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('save valid track URL/URI resolve to canonical track refs', () => {
  const url = resolveSpotifyReference('https://open.spotify.com/track/abc123?si=test');
  const uri = resolveSpotifyReference('spotify:track:abc123');
  assert.equal(url.valid, true);
  assert.equal(uri.valid, true);
  assert.equal(url.type, 'track');
  assert.equal(uri.type, 'track');
  assert.equal(url.openUrl, 'https://open.spotify.com/track/abc123');
  assert.equal(uri.openUrl, 'https://open.spotify.com/track/abc123');
});

test('search, artist and fake urls are rejected for playable card refs', () => {
  const search = resolveSpotifyReference('https://open.spotify.com/search/Anyma');
  const artist = resolveSpotifyReference('https://open.spotify.com/artist/abc123');
  const fake = resolveSpotifyReference('https://open.spotify.com/not-real/abc123');
  assert.equal(search.valid, false);
  assert.equal(search.reason, 'search-url');
  assert.equal(artist.valid, true);
  assert.equal(artist.type, 'artist');
  assert.equal(fake.valid, false);
});

test('embed track URLs are normalized to canonical track open URLs', () => {
  const embed = resolveSpotifyReference('https://open.spotify.com/embed/track/abc123?si=test');
  assert.equal(embed.valid, true);
  assert.equal(embed.type, 'track');
  assert.equal(embed.openUrl, 'https://open.spotify.com/track/abc123');
  assert.equal(embed.embedUrl, 'https://open.spotify.com/embed/track/abc123');
});

test('music tile copy and routing guardrails enforce strict spotify handling', () => {
  assert.match(js, /This is a Spotify search link, not a playable track link\./);
  assert.match(js, /Paste a Spotify track URL to create a playable card\./);
  assert.match(js, /Spotify track verified\. Listening Deck card updated\./);
  assert.match(js, /Spotify catalog search is not configured\. Use Spotify search and paste a confirmed track URL\./);
  assert.match(js, /<iframe src="\$\{embed\}"/);
  assert.match(js, /href="\$\{spotifyOpenUrl\}">Open in Spotify</);
  assert.doesNotMatch(js, /href="\$\{spotifyRef\.openUrl\}">Find on Spotify</);
});

test('invalid spotify refs cannot generate playable iframe/open url', () => {
  const search = resolveSpotifyReference('https://open.spotify.com/search/Anyma%20Pictures%20Of%20You');
  assert.equal(search.embedUrl, null);
  assert.equal(search.openUrl, null);
});
