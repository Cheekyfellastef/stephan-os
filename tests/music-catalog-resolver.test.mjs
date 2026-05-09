import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMusicCandidate } from '../apps/music-tile/engine/musicCatalogResolver.js';

test('AI candidate without URL is unverified/search-only', async () => {
  const c = await resolveMusicCandidate({ title: 'Foo', artist: 'Bar', aiSuggested: true });
  assert.equal(c.verificationStatus, 'search_only');
});

test('valid Spotify track URL resolves verified', async () => {
  const c = await resolveMusicCandidate({ title: 'x', artist: 'y', spotifyUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' });
  assert.equal(c.verificationStatus, 'verified_spotify_track');
});
