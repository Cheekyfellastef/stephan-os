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
