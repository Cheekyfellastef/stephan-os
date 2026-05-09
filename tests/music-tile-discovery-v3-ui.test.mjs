import test from 'node:test';
import assert from 'node:assert/strict';
import { runMusicDiscoveryPipeline } from '../apps/music-tile/engine/musicDiscoveryPipeline.js';

test('y do i returns search-led candidates', async () => {
  const res = await runMusicDiscoveryPipeline({ query: 'Y do I', aiHints: [{ title: 'Lead', artist: 'Y do I', aiSuggested: true }] });
  assert.ok(res.searchLeads.length >= 1);
});

test('anyma and sevdaliza differ', async () => {
  const a = await runMusicDiscoveryPipeline({ query: 'Anyma' });
  const s = await runMusicDiscoveryPipeline({ query: 'Sevdaliza' });
  assert.notEqual(a.searchQueries[0]?.query, s.searchQueries[0]?.query);
});
