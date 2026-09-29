import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildMusicDiscoverySpotlightView } from '../apps/music-tile/engine/musicDiscoverySpotlightPresenter.js';

const source = await readFile(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');

test('wires the merged Discovery Spotlight presenter into the existing Music Intelligence surface', () => {
  assert.match(source, /import \{ buildMusicDiscoverySpotlightView \} from '\.\/engine\/musicDiscoverySpotlightPresenter\.js';/);
  assert.match(source, /buildMusicDiscoverySpotlightView\(\{[\s\S]*surface: 'DISCOVERY_SPOTLIGHT'/);
  assert.match(source, /intelligenceUi\.spotlight\.innerHTML =/);
  assert.match(source, /data-music-discovery-status=/);
  assert.match(source, /data-evidence-class=/);
  assert.match(source, /escapeHtml\(card\.evidenceLabel/);
  assert.match(source, /escapeHtml\(card\.whyInteresting/);
  assert.match(source, /escapeHtml\(card\.evidenceReason/);
});

test('discovery connection actions delegate to the existing native catalogue path only', () => {
  const start = source.indexOf('const searchButton = event.target.closest');
  const end = source.indexOf('const addButton = event.target.closest', start);
  assert.ok(start > 0 && end > start);
  const actionBlock = source.slice(start, end);
  assert.match(actionBlock, /data-action="spotlight-search-catalogue"/);
  assert.match(actionBlock, /performNativeCatalogSearch\(query, \{ operationGeneration: musicOperationGeneration \}\)/);
  assert.doesNotMatch(actionBlock, /requestNativeCatalogSearch|fetch\(|askMusicAi|state\.listeningDeck|saveState\(/);
  assert.match(source, /findExistingCatalogTrack\(state\.listeningDeck, result\)/);
  assert.match(source, /insertListeningDeckCardWithoutPlaybackReset\(track\)/);
});

test('presenter continuity remains non-mutating and unavailable evidence stays explicit', () => {
  const ready = buildMusicDiscoverySpotlightView({
    surface: 'DISCOVERY_SPOTLIGHT',
    artistName: 'Anyma',
    maxCards: 4,
    catalogueEvidence: [],
    tasteEvidence: [],
  });
  assert.equal(ready.status, 'READY');
  assert.ok(ready.cards.length > 0 && ready.cards.length <= 4);
  assert.equal(ready.cards.every((card) => card.action.type === 'SEARCH_EXISTING_CATALOGUE'), true);
  assert.deepEqual(ready.continuityPolicy, {
    replacesPlayerDom: false,
    changesCurrentTrack: false,
    changesRatings: false,
    changesTeachingState: false,
  });

  const unavailable = buildMusicDiscoverySpotlightView({
    surface: 'DISCOVERY_SPOTLIGHT',
    artistName: 'Definitely Unknown Artist 271828',
    maxCards: 4,
    catalogueEvidence: [],
    tasteEvidence: [],
  });
  assert.equal(unavailable.status, 'EVIDENCE_UNAVAILABLE');
  assert.deepEqual(unavailable.cards, []);
});

test('repeated renders replace the same spotlight connection section rather than append duplicate owners', () => {
  const renderStart = source.indexOf('function renderMusicIntelligenceCentre()');
  const renderEnd = source.indexOf('function enhanceListeningDeckCards()', renderStart);
  const renderBlock = source.slice(renderStart, renderEnd);
  assert.equal((renderBlock.match(/intelligenceUi\.spotlight\.innerHTML =/g) || []).length, 1);
  assert.equal((renderBlock.match(/buildMusicDiscoverySpotlightPresentation\(artist\)/g) || []).length, 1);
  assert.match(source, /findExistingCatalogTrack\(state\.listeningDeck, result\)/);
});
