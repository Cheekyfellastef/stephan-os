import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTasteWeights, rankCandidatesByTaste } from '../apps/music-tile/engine/tasteLearning.js';

test('positive tags and ratings increase matching candidate rank', () => {
  const state = {
    listeningDeck: [{ id: 'a1', title: 'Anchor 1', lane: 'Ghost Vocal / Reverb Female Voice' }],
    ratings: { a1: 2 },
    tags: { a1: ['haunting female vocal', 'echo vocal', 'serious trance DNA'] },
  };

  const ranked = rankCandidatesByTaste([
    { id: 'c1', title: 'Candidate High', lane: 'serious trance DNA', reason: 'haunting female vocal' },
    { id: 'c2', title: 'Candidate Low', lane: 'flat energy', reason: 'none' },
  ], buildTasteWeights(state));

  assert.equal(ranked[0].id, 'c1');
  assert.ok(ranked[0].tasteScore > ranked[1].tasteScore);
});

test('reject tags lower matching candidate rank', () => {
  const state = {
    listeningDeck: [{ id: 'r1', title: 'Reject 1', lane: 'Club Engine But Missing Ghost' }],
    ratings: { r1: -2 },
    tags: { r1: ['too cheesy', 'too Goa / psy', 'boring'] },
  };

  const ranked = rankCandidatesByTaste([
    { id: 'c-good', title: 'Clean Candidate', lane: 'serious trance DNA', reason: 'reverb vocal' },
    { id: 'c-bad', title: 'Cheesy Candidate', lane: 'too Goa / psy', reason: 'too cheesy' },
  ], buildTasteWeights(state));

  assert.equal(ranked.at(-1).id, 'c-bad');
  assert.ok(ranked[0].tasteScore > ranked.at(-1).tasteScore);
});
