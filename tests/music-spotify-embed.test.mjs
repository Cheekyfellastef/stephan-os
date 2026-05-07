import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpotifyReference, toSpotifyEmbedUrl } from '../apps/music-tile/utils/spotifyEmbed.js';

test('spotify track URI resolves embed/open URL', () => {
  const resolved = resolveSpotifyReference('spotify:track:abc123');
  assert.equal(resolved.embedUrl, 'https://open.spotify.com/embed/track/abc123');
  assert.equal(resolved.openUrl, 'https://open.spotify.com/track/abc123');
});

test('spotify track URL resolves canonical open url without embed path', () => {
  const resolved = resolveSpotifyReference('https://open.spotify.com/track/abc123?si=test');
  assert.equal(resolved.embedUrl, 'https://open.spotify.com/embed/track/abc123');
  assert.equal(resolved.openUrl, 'https://open.spotify.com/track/abc123');
  assert.equal(resolved.openUrl.includes('/embed/'), false);
});

test('rejects spotify search urls for embeds/open refs', () => {
  const resolved = resolveSpotifyReference('https://open.spotify.com/search/Anyma%20Pictures%20Of%20You');
  assert.equal(resolved.valid, false);
  assert.equal(resolved.reason, 'search-url');
  assert.equal(toSpotifyEmbedUrl('https://open.spotify.com/search/anyma'), null);
  assert.equal(resolved.openUrl, null);
});
