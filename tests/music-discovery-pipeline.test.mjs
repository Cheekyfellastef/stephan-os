import test from 'node:test';
import assert from 'node:assert/strict';
import { runMusicDiscoveryPipeline } from '../apps/music-tile/engine/musicDiscoveryPipeline.js';

test('pipeline returns split sections', async () => {
  const res = await runMusicDiscoveryPipeline({ query: 'Anyma', aiHints: [{ title: 'Unknown Lead', artist: 'Anyma', aiSuggested: true }] });
  assert.ok(Array.isArray(res.verifiedCandidates));
  assert.ok(Array.isArray(res.searchLeads));
});

test('unknown artist still returns fallback', async () => {
  const res = await runMusicDiscoveryPipeline({ query: 'NoArtist', localCandidates: [] });
  assert.ok(res.fallbackCandidates.length > 0);
});


test('verified Discovery list excludes rejected candidates and unconfirmed AI Spotify URLs', async () => {
  const exact = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
  const res = await runMusicDiscoveryPipeline({
    query: 'Depeche Mode',
    localCandidates: [
      { id: 'known', title: 'Enjoy the Silence', artist: 'Depeche Mode', spotifyUrl: exact,
        catalogProvider: 'spotify', catalogProviderItemId: '4uLU6hMCjMI75M1A2tKUQC',
        catalogLinkSource: 'native-catalog-search', catalogVerificationStatus: 'metadata_verified',
        candidateVerificationStatus: 'search-only' },
      { id: 'not-found', title: 'Rejected', artist: 'Depeche Mode',
        spotifyUrl: exact, candidateVerificationStatus: 'not-found' },
      { id: 'hallucinated', title: 'Fabricated', artist: 'Depeche Mode',
        spotifyUrl: exact, candidateVerificationStatus: 'likely-hallucinated' },
      { id: 'unconfirmed-ai', title: 'AI suggestion', artist: 'Depeche Mode',
        spotifyUrl: exact, aiSuggested: true, candidateVerificationStatus: 'unverified' },
    ],
  });
  assert.deepEqual(res.verifiedCandidates.map((c) => c.id), ['known']);
  assert.equal(res.verifiedCandidates[0].catalogProviderItemId, '4uLU6hMCjMI75M1A2tKUQC');
});
