import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';
import { buildListeningCardsMarkup } from '../apps/music-tile/ui/tasteCockpitView.js';

const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('stable cockpit root + controls + columns present', () => {
  assert.match(html, /Music Taste Cockpit/);
  assert.match(html, /id="music-cockpit-root"/);
  assert.match(html, /id="taste-col"/);
  assert.match(html, /id="journey-col"/);
  assert.match(html, /id="deck-col"/);
  assert.equal((html.match(/data-command-deck-return-control/g) || []).length, 0);
});

test('build/start status messages and validation are explicit', () => {
  assert.match(js, /Building journey for:/);
  assert.match(js, /Starting journey for:/);
  assert.match(js, /Enter an artist to build a journey\./);
});

test('spotify iframe contract + missing link fallback', () => {
  const markup = buildListeningCardsMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /allow="[^"]*encrypted-media[^"]*"/);
  assert.match(markup, /width="100%"/);
  assert.match(markup, /height="152"/);
  assert.match(markup, /Needs verified Spotify link/);
});

test('column scroll contract exists in fixed cockpit grid', () => {
  assert.match(css, /\.dashboard-grid \{[^}]*grid-template-columns:\s*1fr 1\.45fr 1\.15fr;/);
  assert.match(css, /\.col \{[^}]*overflow:\s*auto;/);
});
