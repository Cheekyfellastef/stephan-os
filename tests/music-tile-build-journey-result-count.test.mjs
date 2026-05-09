import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtistAwareCandidates, DEFAULT_DISCOVERY_RESULT_TARGET, MIN_DISCOVERY_RESULT_TARGET } from '../apps/music-tile/engine/musicCandidateEngine.js';

test('result targets are configured for useful discovery sessions', () => {
  assert.equal(DEFAULT_DISCOVERY_RESULT_TARGET, 10);
  assert.equal(MIN_DISCOVERY_RESULT_TARGET, 8);
});

test('Anyma and Sevdaliza return at least minimum candidates where possible', () => {
  const anyma = buildArtistAwareCandidates({ artistInput: 'Anyma', tasteDNA: {}, sessionCounter: 2 });
  const sevd = buildArtistAwareCandidates({ artistInput: 'Sevdaliza', tasteDNA: {}, sessionCounter: 2 });
  assert.ok(anyma.candidates.length >= MIN_DISCOVERY_RESULT_TARGET);
  assert.ok(sevd.candidates.length >= MIN_DISCOVERY_RESULT_TARGET);
});

test('unknown artist still gets broad fallback candidates without freezing', () => {
  const unknown = buildArtistAwareCandidates({ artistInput: 'Y do I', tasteDNA: {}, sessionCounter: 4 });
  assert.ok(Array.isArray(unknown.candidates));
  assert.ok(unknown.candidates.length >= 1);
});
