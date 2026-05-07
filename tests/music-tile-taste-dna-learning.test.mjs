import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTasteWeights, rankCandidatesByTaste } from '../apps/music-tile/engine/tasteLearning.js';
import { parseFeedback } from '../apps/music-tile/engine/tasteFeedbackRules.js';

const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('user can add positive and negative trait controls exist', () => {
  assert.match(html, /Add positive trait/);
  assert.match(html, /Add negative trait/);
  assert.match(html, /save trait button/);
});

test('trait weight controls exist', () => {
  assert.match(js, /weight-inc/);
  assert.match(js, /weight-dec/);
  assert.match(js, /weight-slider/);
});

test('free-text feedback maps to traits', () => {
  const r = parseFeedback('club engine but no ghost');
  assert.ok(r.plus.includes('club engine'));
  assert.ok(r.minus.includes('no ghost'));
});

test('too goa boosts negative mapping', () => {
  const r = parseFeedback('interesting but too Goa');
  assert.ok(r.minus.includes('too Goa / psy'));
});

test('portal boosts universal nation and serious trance', () => {
  const r = parseFeedback('this is the portal');
  assert.ok(r.plus.includes('Universal Nation spine'));
  assert.ok(r.plus.includes('serious trance DNA'));
});

test('ranking changes when trait weights change', () => {
  const candidates = [
    { id: 'a', title: 'A', positiveTags: ['echo vocal'] },
    { id: 'b', title: 'B', positiveTags: ['too cheesy'] },
  ];
  const base = buildTasteWeights({ listeningDeck: [], ratings: {}, tags: {} });
  base.positiveWeights['echo vocal'] = 5;
  const ranked = rankCandidatesByTaste(candidates, base);
  assert.equal(ranked[0].id, 'a');
});

test('candidate cards show why surfaced + feedback + ai fallback and persistence key', () => {
  assert.match(js, /Why this surfaced/);
  assert.match(js, /Apply feedback to Taste DNA/);
  assert.match(js, /AI interpretation not connected yet\. Rule-based interpretation applied\./);
  assert.match(js, /tasteDNA/);
  assert.match(js, /feedbackHistory/);
});
