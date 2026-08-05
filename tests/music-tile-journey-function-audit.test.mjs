import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFreshJourneyState } from '../apps/music-tile/engine/freshJourneyPlanner.js';

const mainSource = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../apps/music-tile/engine/freshJourneyController.js', import.meta.url), 'utf8');

function track(id, overrides = {}) {
  return { id, artist: `Artist ${id}`, title: `Track ${id}`, ...overrides };
}

test('complete journey places every selected track in the Listening Room and preserves bounded prior cards', () => {
  const selected = Array.from({ length: 10 }, (_, index) => track(`fresh-${index + 1}`));
  const existing = Array.from({ length: 15 }, (_, index) => track(`existing-${index + 1}`));
  const plan = planFreshJourneyState({
    snapshot: { candidates: [], listeningDeck: existing, ratings: {}, tags: {}, trackFeedback: {} },
    candidates: selected,
    targetCount: 10,
    listeningRoomAdditionCount: 10,
    deckLimit: 20,
    startedAt: '2026-08-04T20:00:00.000Z',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.freshCount, 10);
  assert.equal(plan.addedCount, 10);
  assert.equal(plan.roomCount, 20);
  assert.equal(plan.preservedCount, 10);
  assert.deepEqual(plan.state.listeningDeck.slice(0, 10).map((row) => row.id), selected.map((row) => row.id));
  assert.equal(plan.state.activeJourneyTrackIds.length, 10);
  assert.ok(plan.state.activeJourneyTrackIds.every((id) => plan.state.listeningDeck.some((row) => row.id === id)));
});

test('source-limited journey exposes every available unseen track rather than collapsing to three', () => {
  const available = Array.from({ length: 5 }, (_, index) => track(`limited-${index + 1}`));
  const plan = planFreshJourneyState({
    snapshot: { candidates: [], listeningDeck: [], ratings: {}, tags: {}, trackFeedback: {} },
    candidates: available,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.freshCount, 5);
  assert.equal(plan.addedCount, 5);
  assert.equal(plan.roomCount, 5);
  assert.equal(plan.limitedByFreshness, true);
  assert.match(plan.notice, /all 5 genuinely new tracks available/);
});

test('all user journey entrances converge on one controller and legacy duplicate listeners are absent', () => {
  assert.match(controllerSource, /#start-journey-btn, #surprise-me-btn, #build-journey-btn/);
  assert.doesNotMatch(mainSource, /surpriseBtn\?\.addEventListener\('click', startSurpriseJourney\)/);
  assert.doesNotMatch(mainSource, /ui\.buildBtn\?\.addEventListener\('click', buildJourney\)/);
  assert.doesNotMatch(mainSource, /ui\.startBtn\?\.addEventListener\('click', startJourney\)/);
});

test('persisted state hydration keeps discovery and unknown forward-compatible fields', () => {
  const loadStateSource = mainSource.slice(mainSource.indexOf('function loadState()'), mainSource.indexOf('function saveState()'));
  assert.match(loadStateSource, /...saved/);
  assert.match(loadStateSource, /discoveryPipeline:/);
  assert.match(loadStateSource, /journeyHistoryKeys:/);
  assert.match(loadStateSource, /legacyTruncatedJourneyRecovered/);
  assert.match(loadStateSource, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(nextState\)\)/);
  assert.match(loadStateSource, /catch {/);
});

test('catalogue expansion is bounded, provider-neutral and never promotes playback truth', () => {
  assert.match(controllerSource, /CATALOGUE_QUERY_VARIANTS/);
  assert.match(controllerSource, /slice\(0, 2\)/);
  assert.match(controllerSource, /Promise\.all\(catalogueQueries\.map/);
  assert.match(controllerSource, /dedupeFreshJourneyCandidates/);
  assert.doesNotMatch(controllerSource, /candidateVerificationStatuss*=s*['"]verified/);
});
