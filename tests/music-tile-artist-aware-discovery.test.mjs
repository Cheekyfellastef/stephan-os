import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtistAwareCandidates, normalizeArtistQuery } from '../apps/music-tile/engine/musicCandidateEngine.js';

test('Anyma lane includes Anyma/Afterlife style and not identical to Sevdaliza', () => {
  const anyma = buildArtistAwareCandidates({ artistInput: 'Anyma', tasteDNA: {}, sessionCounter: 1 });
  const sevd = buildArtistAwareCandidates({ artistInput: 'Sevdaliza', tasteDNA: {}, sessionCounter: 1 });
  assert.ok(anyma.candidates.some((c) => /anyma|sevdaliza/i.test(`${c.artist} ${c.title}`)));
  assert.notDeepEqual(anyma.candidates.map((c) => c.id), sevd.candidates.map((c) => c.id));
});

test('Push/universal nation maps to serious trance spine', () => {
  const push = buildArtistAwareCandidates({ artistInput: 'Universal Nation', tasteDNA: {}, sessionCounter: 1 });
  assert.equal(push.query.lane, 'serious-trance-spine');
  assert.ok(push.candidates.some((c) => c.traits.includes('serious trance DNA')));
});

test('unknown artist falls back with note flag and min 8 when possible', () => {
  const unknown = buildArtistAwareCandidates({ artistInput: 'zzzz artist', tasteDNA: {}, sessionCounter: 1 });
  assert.ok(unknown.usedFallbackOnly || unknown.candidates.length >= 8);
});

test('unseen filter + deterministic rotation', () => {
  const one = buildArtistAwareCandidates({ artistInput: 'Anyma', tasteDNA: {}, sessionCounter: 1 });
  const two = buildArtistAwareCandidates({ artistInput: 'Anyma', tasteDNA: {}, sessionCounter: 2, recentlyShownIds: one.candidates.slice(0, 3).map((c) => c.id) });
  assert.notDeepEqual(one.candidates.map((c) => c.id), two.candidates.map((c) => c.id));
  assert.ok(two.candidates.every((c) => !one.candidates.slice(0, 3).some((x) => x.id === c.id)));
});

test('query aliases normalize', () => {
  assert.equal(normalizeArtistQuery('cream courtyard').lane, 'serious-trance-spine');
  assert.equal(normalizeArtistQuery('layla benitez').lane, 'layla-benitez');
});


test('y do i normalizes to known artist alias', () => {
  const normalized = normalizeArtistQuery('y do i');
  assert.equal(normalized.lane, 'y-do-i');
  assert.equal(normalized.canonicalArtistName, 'Y do I');
});

test('y do i builds without weird-input fallback and has candidates', () => {
  const result = buildArtistAwareCandidates({ artistInput: 'y do i', tasteDNA: {}, sessionCounter: 1 });
  assert.equal(result.query.lane, 'y-do-i');
  assert.ok(result.candidates.length > 0);
  assert.equal(result.usedFallbackOnly, false);
});
