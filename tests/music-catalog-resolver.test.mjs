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


test('rejected Music candidates never regain verified identity from a retained Spotify URL', async () => {
  const spotifyUrl = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
  for (const status of ['not-found', 'likely-hallucinated']) {
    const candidate = await resolveMusicCandidate({
      artist: 'Depeche Mode', title: 'Enjoy the Silence',
      aiSuggested: true, candidateVerificationStatus: status, spotifyUrl,
    });
    assert.equal(candidate.candidateVerificationStatus, status);
    assert.equal(candidate.verificationStatus.includes('verified'), false);
    assert.equal(candidate.spotifyUrl, spotifyUrl, 'source URL is retained for audit, not promoted to verified truth');
    assert.equal(candidate.needsUserConfirmation, true);
  }
});

test('Music resolver allows only exact YouTube watch IDs, never search pages or loose URL prefixes', async () => {
  const base = { artist: 'Anyma', title: 'Pictures Of You' };
  for (const link of [
    'https://www.youtube.com/results?search_query=Anyma',
    'https://www.youtube.com.evil.test/watch?v=abc12345678',
    'https://youtube.com/playlist?list=abc12345678',
  ]) {
    const result = await resolveMusicCandidate({ ...base, youtubeUrl: link });
    assert.equal(result.youtubeUrl, '');
    assert.notEqual(result.verificationStatus, 'verified_youtube_url');
  }
  const valid = await resolveMusicCandidate({ ...base,
    youtubeUrl: 'https://youtu.be/abc12345678' });
  assert.equal(valid.youtubeUrl, 'https://www.youtube.com/watch?v=abc12345678');
  assert.equal(valid.verificationStatus, 'verified_youtube_url');
});

test('verified catalogue source metadata survives Discovery classification', async () => {
  const candidate = await resolveMusicCandidate({
    id: 'catalogue-known',
    title: 'Enjoy the Silence',
    artist: 'Depeche Mode',
    spotifyUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    catalogProvider: 'spotify',
    catalogProviderItemId: '4uLU6hMCjMI75M1A2tKUQC',
    catalogLinkSource: 'native-catalog-search',
    catalogVerificationStatus: 'metadata_verified',
    candidateVerificationStatus: 'search-only',
    artworkUrl: 'https://i.scdn.co/image/example',
  });
  assert.equal(candidate.catalogProvider, 'spotify');
  assert.equal(candidate.catalogProviderItemId, '4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(candidate.catalogVerificationStatus, 'metadata_verified');
  assert.equal(candidate.artworkUrl, 'https://i.scdn.co/image/example');
  assert.equal(candidate.candidateVerificationStatus, 'search-only');
});
