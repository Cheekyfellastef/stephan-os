import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';
import { buildListeningCardsMarkup } from '../apps/music-tile/ui/tasteCockpitView.js';

const musicCss = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const musicMain = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const musicHtml = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('the full-page cockpit and Advanced Studio keep long content usable', () => {
  assert.match(musicCss, /\.music-cockpit\s*\{/);
  assert.match(musicCss, /\.advanced-studio\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(musicCss, /\.col\s*\{[\s\S]*overflow:\s*auto;/);
});

test('former pane-era controls are preserved behind progressive disclosure', () => {
  assert.match(musicHtml, /<details class="advanced-studio" id="advanced-studio">/);
  assert.doesNotMatch(musicHtml, /<details class="advanced-studio" id="advanced-studio" open/);
  assert.match(musicMain, /function enhanceListeningDeckCards\(\)/);
  assert.match(musicMain, /details\.className = 'track-tools'/);
});

test('taste cockpit markup keeps spotify iframe, open link fallback, and missing-link state', () => {
  const markup = buildListeningCardsMarkup(SEEDED_TASTE_TRACKS);
  assert.match(markup, /<iframe[^>]+open\.spotify\.com\/embed\//);
  assert.match(markup, /allow="[^"]*encrypted-media[^"]*"/);
  assert.match(markup, /height="152"/);
  assert.match(markup, />Open in Spotify</);
  const missingMarkup = buildListeningCardsMarkup([{ id: 'x', artist: 'A', title: 'B' }]);
  assert.match(missingMarkup, /Needs Spotify link/);
});
