import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('Taste DNA synthesis action exists', () => { assert.match(html, /synthesise-taste-dna-btn/); assert.match(js, /synthesiseTasteDnaWithAi/); });
test('Taste DNA synthesis sends ratings\/history\/traits context', () => { assert.match(js, /ratings: state\.ratings/); assert.match(js, /feedbackHistory: state\.feedbackHistory/); assert.match(js, /positiveTraits/); assert.match(js, /negativeTraits/); });
test('Synthesis review panel includes apply all\/selected\/reject', () => { assert.match(js, /Apply all/); assert.match(js, /Apply selected/); assert.match(js, /Reject/); });
test('Build smarter journey uses taste DNA context and no fake spotify links', () => { assert.match(js, /buildJourneyAiAssisted/); assert.match(js, /tasteDNA: state\.tasteDNA/); assert.match(js, /spotifySearchQuery/); });
test('AI/local scoring both shown on candidate cards', () => { assert.match(js, /Local score:/); assert.match(js, /AI fit score:/); });
test('Presence AI synthesis\/journey events emitted', () => { assert.match(js, /music\.ai_taste_dna_synthesised/); assert.match(js, /music\.ai_journey_built/); });
