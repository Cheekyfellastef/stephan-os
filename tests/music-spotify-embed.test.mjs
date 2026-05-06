import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpotifyReference, toSpotifyEmbedUrl } from '../apps/music-tile/utils/spotifyEmbed.js';

test('normalizes spotify url and uri into embed URL', () => {
  assert.equal(toSpotifyEmbedUrl('https://open.spotify.com/track/abc123?si=1'), 'https://open.spotify.com/embed/track/abc123');
  assert.equal(toSpotifyEmbedUrl('spotify:album:xyz987'), 'https://open.spotify.com/embed/album/xyz987');
});

test('spotify parser returns open URL fallback', () => {
  const parsed = parseSpotifyReference('spotify:playlist:pl123');
  assert.equal(parsed.openUrl, 'https://open.spotify.com/playlist/pl123');
});
