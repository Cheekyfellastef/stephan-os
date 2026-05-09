import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMusicSearchQueries } from '../apps/music-tile/engine/musicSearchQueryGenerator.js';

test('generator creates spotify/youtube queries', () => {
  const res = generateMusicSearchQueries({ artist: 'Y do I', tasteDNA: { 'dark melodic techno': { polarity: 'positive' } } });
  assert.ok(res.some((q) => q.target === 'spotify'));
  assert.ok(res.some((q) => q.target === 'youtube'));
});
