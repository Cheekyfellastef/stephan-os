import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';
import { buildTasteCockpitMarkup } from '../apps/music-tile/ui/tasteCockpitView.js';

const musicCss = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const musicMain = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('music pane sections and long-content lists keep internal scroll contract', () => {
  assert.match(musicCss, /\.stephanos-panel-content > \.canon-tile-pane-section\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(musicCss, /#taste-cockpit-list,[\s\S]*#journey-list,[\s\S]*#debug-output\s*\{[\s\S]*overflow-y:\s*auto;/);
});

test('taste cockpit default pane dimensions and migration version are encoded', () => {
  assert.match(musicMain, /paneId:\s*'taste-cockpit-pane',\s*x:\s*760,\s*y:\s*20,\s*width:\s*480,\s*height:\s*520/);
  assert.match(musicMain, /const MUSIC_PANE_LAYOUT_VERSION = 2/);
  assert.match(musicMain, /function migrateMusicPaneLayoutIfNeeded\(/);
});

test('taste cockpit markup keeps spotify iframe, open link fallback, and missing-link state', () => {
  const markup = buildTasteCockpitMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /<iframe[^>]+open\.spotify\.com\/embed\//);
  assert.match(markup, /allow="[^"]*encrypted-media[^"]*"/);
  assert.match(markup, /height="152"/);
  assert.match(markup, />Open in Spotify</);
  const missingMarkup = buildTasteCockpitMarkup([{ id: 'x', artist: 'A', title: 'B' }]);
  assert.match(missingMarkup, /Needs Spotify link/);
});
