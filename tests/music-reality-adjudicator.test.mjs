import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateMusicReality } from '../apps/music-tile/engine/musicRealityAdjudicator.js';

test('search URL is not playable', () => { const r = adjudicateMusicReality({ youtubeUrl: 'https://www.youtube.com/results?search_query=abc' }); assert.equal(r.playable, false); });
test('hallucinated candidate suppressed', () => { const r = adjudicateMusicReality({ markedHallucinated: true }); assert.ok(r.riskFlags.includes('hallucinated')); });
