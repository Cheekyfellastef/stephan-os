import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  findExistingCatalogTrack,
  mergeCatalogResultIntoExistingTrack,
  planCatalogResultEnrichment,
} from '../apps/music-tile/engine/nativeCatalogSearch.js';
import { mergePersistedCatalogState } from '../apps/music-tile/engine/nativeCatalogAutoApply.js';
import { buildArtistAwareCandidates } from '../apps/music-tile/engine/musicCandidateEngine.js';
import { planFreshJourneyState } from '../apps/music-tile/engine/freshJourneyPlanner.js';

const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/music-tile/style.css', import.meta.url), 'utf8');
const nativeAutoApplySource = readFileSync(new URL('../apps/music-tile/engine/nativeCatalogAutoApply.js', import.meta.url), 'utf8');
const freshJourneyControllerSource = readFileSync(new URL('../apps/music-tile/engine/freshJourneyController.js', import.meta.url), 'utf8');
const AUTO_SPOTIFY_ID = '4uLU6hMCjMI75M1A2tKUQC';
const AUTO_SPOTIFY_URL = `https://open.spotify.com/track/${AUTO_SPOTIFY_ID}`;
const AUTO_SPOTIFY_URI = `spotify:track:${AUTO_SPOTIFY_ID}`;
const OTHER_SPOTIFY_URI = 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b';

function verifiedCatalogResult(overrides = {}) {
  return {
    universalId: `spotify:track:${AUTO_SPOTIFY_ID}`,
    provider: 'spotify',
    providerItemId: AUTO_SPOTIFY_ID,
    providerLabel: 'Spotify',
    providerUrl: AUTO_SPOTIFY_URL,
    title: 'Enjoy the Silence',
    artist: 'Depeche Mode',
    album: 'Violator',
    confidence: 'high',
    verificationStatus: 'metadata_verified',
    playbackAvailability: 'playback_unverified',
    spotifyUrl: AUTO_SPOTIFY_URL,
    spotifyUri: AUTO_SPOTIFY_URI,
    ...overrides,
  };
}

function existingCatalogTrack(overrides = {}) {
  return {
    id: 'journey-enjoy-the-silence',
    title: 'Enjoy the Silence',
    artist: 'Depeche Mode',
    lane: 'doorway-track',
    sourceKind: 'journey-candidate',
    candidateVerificationStatus: 'search-only',
    traits: ['dark club pressure'],
    ...overrides,
  };
}

test('daily briefing leads with one dominant journey action and the three-question contract', () => {
  assert.match(html, /data-experience="daily-briefing"/);
  assert.match(html, /id="surprise-me-btn" class="journey-button"/);
  assert.match(html, /id="briefing-listen-now"/);
  assert.match(html, /id="briefing-why"/);
  assert.match(html, /id="briefing-novelty"/);
  assert.match(html, /LISTEN NOW/);
  assert.match(html, /WHY IT FITS/);
  assert.match(html, /WHAT’S NEW/);
});

test('setup, diagnostics, Taste DNA editing and legacy controls remain available behind Advanced Studio', () => {
  assert.match(html, /<details class="advanced-studio" id="advanced-studio">/);
  assert.doesNotMatch(html, /<details class="advanced-studio" id="advanced-studio" open/);
  [
    'artist-input',
    'build-journey-btn',
    'start-journey-btn',
    'taste-dna-editor',
    'ai-status-card',
    'assisted-setup-panel',
    'discovery-results-list',
  ].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
});

test('all journey entrances use the complete fresh controller while playback truth remains guarded', () => {
  assert.doesNotMatch(js, /surpriseBtn\?\.addEventListener\('click', startSurpriseJourney\)/);
  assert.doesNotMatch(js, /ui\.buildBtn\?\.addEventListener\('click', buildJourney\)/);
  assert.doesNotMatch(js, /ui\.startBtn\?\.addEventListener\('click', startJourney\)/);
  assert.match(freshJourneyControllerSource, /#start-journey-btn, #surprise-me-btn, #build-journey-btn/);
  assert.match(freshJourneyControllerSource, /listeningRoomAdditionCount: 10/);
  assert.match(js, /isVerifiedCandidateTrack\(track\) && spotify\.valid && spotify\.type === 'track'/);
  assert.match(js, /AI lead · unverified/);
  assert.match(js, /Local candidate · verify/);
});

test('listening tools are progressively disclosed without removing their existing controls', () => {
  assert.match(js, /function enhanceListeningDeckCards\(\)/);
  assert.match(js, /function renderListeningDeck\(\)[\s\S]*enhanceListeningDeckCards\(\); \}/);
  assert.match(js, /details\.className = 'track-tools'/);
  assert.match(js, /Tune, verify & teach Stephanos/);
  assert.match(js, /data-action="apply-feedback"/);
  assert.match(js, /data-action="save-spotify-link"/);
  assert.match(js, /data-action="ai-why-failed"/);
});

test('live compass derives relative strength from stored Taste DNA instead of static decoration', () => {
  assert.match(html, /id="taste-compass-meter"/);
  assert.doesNotMatch(html, /--strength:\s*(?:88|72|61)%/);
  assert.match(js, /const strongestWeight = Number\(positiveSignalEntries\[0\]/);
  assert.match(js, /Math\.round\(\(weight \/ strongestWeight\) \* 100\)/);
  assert.match(js, /stored weight \$\{weight\.toFixed\(2\)\}/);
});

test('journey build returns an explicit outcome so persistence failures cannot become false success', () => {
  assert.match(js, /const buildSucceeded = !resolverFailed && state\.candidates\.length > 0/);
  assert.match(js, /return Object\.freeze\(\{ ok: true, message: finalStatus/);
  assert.match(js, /return Object\.freeze\(\{ ok: false, message, candidateCount:/);
  assert.match(js, /Journey not ready:/);
});

test('journey-built presence evidence is emitted only after persistence and rendering succeed', () => {
  const buildSource = js.slice(js.indexOf('async function buildJourney()'), js.indexOf('function startJourney()'));
  const saveIndex = buildSource.indexOf('saveState();');
  const renderIndex = buildSource.indexOf("safeRenderAll('buildJourney')");
  const successIndex = buildSource.indexOf('emitJourneyBuildSuccess(term, state.candidates.length)');
  assert.ok(saveIndex >= 0 && renderIndex > saveIndex && successIndex > renderIndex);
  assert.match(js, /function emitJourneyBuildFailure\(message, artist = ''\)/);
  assert.match(js, /kind: 'journey_build_failed'/);
  assert.match(js, /severity: 'warning'/);
});

test('optional presence adapters cannot reverse a persisted and rendered journey', () => {
  const successHelper = js.slice(js.indexOf('function emitJourneyBuildSuccess'), js.indexOf('function normalizeCandidate'));
  assert.match(successHelper, /try \{/);
  assert.match(successHelper, /kind: 'journey_built'/);
  assert.match(successHelper, /catch \(eventError\)/);
  assert.match(successHelper, /journey build success event unavailable/);
  assert.doesNotMatch(successHelper, /emitJourneyBuildFailure/);
});

test('artist-prefixed seed titles are de-duplicated in the daily experience', () => {
  assert.match(js, /function getDisplayTrackTitle\(track = \{\}\)/);
  assert.match(js, /rawTitle\.toLowerCase\(\)\.startsWith\(artistPrefix\.toLowerCase\(\)/);
  assert.match(js, /const title = getDisplayTrackTitle\(track\)/);
  assert.match(js, /music-card-title"\>\$\{escapeHtml\(getDisplayTrackTitle\(track\)\)\}/);
});

test('cinematic layout has iPad, phone and reduced-motion safeguards', () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 580px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.daily-briefing \{/);
  assert.match(css, /\.signal-orbit \{/);
  assert.match(css, /\.discovery-spotlight/);
});

test('rating a deck track preserves the live player node and refreshes only dependent UI', () => {
  const deckSource = js.slice(js.indexOf('function renderListeningDeck()'), js.indexOf('function listeningCardMarkup'));
  const ratingHandler = deckSource.slice(deckSource.indexOf("querySelectorAll('[data-rate]')"), deckSource.indexOf("querySelectorAll('[data-tag]')"));
  const presentationHelper = js.slice(js.indexOf('function updateRatingPresentation'), js.indexOf('function renderListeningDeck()'));
  assert.match(ratingHandler, /saveState\(\); updateRatingPresentation\(btn, Number\(btn\.dataset\.rate\)\)/);
  assert.doesNotMatch(ratingHandler, /renderAll\(|renderListeningDeck\(/);
  assert.match(presentationHelper, /button\?\.closest\?\.\('\.player-deck-card'\)/);
  assert.match(presentationHelper, /aria-pressed/);
  assert.match(presentationHelper, /classList\.toggle\('is-active'/);
  assert.match(js, /rating\$\{Number\(rating\) === value \? ' is-active'/);
  assert.doesNotMatch(js, /is-selected/);
  assert.match(presentationHelper, /renderTasteDNA\(\)/);
  assert.match(presentationHelper, /refreshDiscoveryRankingPresentation\(\)/);
  assert.match(presentationHelper, /renderMusicIntelligenceCentre\(\)/);
  assert.doesNotMatch(presentationHelper, /innerHTML|renderDiscoveryResults\(|renderListeningDeck\(|renderAll\(/);
  const discoveryRefreshHelper = js.slice(js.indexOf('function refreshDiscoveryRankingPresentation'), js.indexOf('function renderDiscoveryResults'));
  assert.match(discoveryRefreshHelper, /querySelectorAll\('section'\)/);
  assert.doesNotMatch(discoveryRefreshHelper, /iframe|ui\.discoveryResults\.innerHTML/);
});

test('metadata-verified Spotify results enrich an existing card without replacing its identity or lane', () => {
  const track = existingCatalogTrack();
  const result = mergeCatalogResultIntoExistingTrack(track, verifiedCatalogResult());
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(track.id, 'journey-enjoy-the-silence');
  assert.equal(track.lane, 'doorway-track');
  assert.equal(track.sourceKind, 'journey-candidate');
  assert.equal(track.candidateVerificationStatus, 'search-only');
  assert.deepEqual(track.traits, ['dark club pressure']);
  assert.equal(track.spotifyUrl, AUTO_SPOTIFY_URL);
  assert.equal(track.spotifyUri, AUTO_SPOTIFY_URI);
  assert.equal(track.catalogVerificationStatus, 'metadata_verified');
  assert.equal(track.catalogPlaybackAvailability, 'playback_unverified');
  assert.equal(track.catalogLinkSource, 'native-catalog-search');
});

test('duplicate detection enriches before the existing-card control is disabled and retries are idempotent', () => {
  const track = existingCatalogTrack();
  assert.equal(findExistingCatalogTrack([track], verifiedCatalogResult()), track);
  assert.equal(track.spotifyUri, AUTO_SPOTIFY_URI);
  const retry = planCatalogResultEnrichment(track, verifiedCatalogResult());
  assert.equal(retry.ok, true);
  assert.equal(retry.changed, false);
});

test('unverified catalogue rows and mismatched identities cannot mutate an existing card', () => {
  const unverifiedTrack = existingCatalogTrack();
  const unverified = mergeCatalogResultIntoExistingTrack(unverifiedTrack, verifiedCatalogResult({ verificationStatus: 'search_only' }));
  assert.equal(unverified.ok, false);
  assert.equal(unverified.reason, 'catalogue-metadata-not-verified');
  assert.equal(unverifiedTrack.spotifyUrl, undefined);

  const wrongIdentity = existingCatalogTrack();
  const mismatch = mergeCatalogResultIntoExistingTrack(wrongIdentity, verifiedCatalogResult({ title: 'Personal Jesus' }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'catalogue-identity-mismatch');
  assert.equal(wrongIdentity.spotifyUrl, undefined);
});

test('an existing different Spotify track fails closed and is never overwritten', () => {
  const track = existingCatalogTrack({
    spotifyUrl: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b',
    spotifyUri: OTHER_SPOTIFY_URI,
  });
  const result = mergeCatalogResultIntoExistingTrack(track, verifiedCatalogResult());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'spotify-track-conflict');
  assert.equal(track.spotifyUri, OTHER_SPOTIFY_URI);
});

test('persisted Music Tile state receives the canonical URL while ratings, tags and feedback remain unchanged', () => {
  const snapshot = {
    listeningDeck: [existingCatalogTrack()],
    ratings: { 'journey-enjoy-the-silence': 2 },
    tags: { 'journey-enjoy-the-silence': ['ghost in the track'] },
    trackFeedback: { 'journey-enjoy-the-silence': 'Keep this.' },
  };
  const planned = planCatalogResultEnrichment(snapshot.listeningDeck[0], verifiedCatalogResult());
  const result = mergePersistedCatalogState(snapshot, {
    trackId: 'journey-enjoy-the-silence',
    artist: 'Depeche Mode',
    title: 'Enjoy the Silence',
    spotifyUrl: planned.spotify.openUrl,
    spotifyUri: planned.spotify.uri,
    enrichment: planned.enrichment,
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(snapshot.listeningDeck[0].spotifyUrl, AUTO_SPOTIFY_URL);
  assert.equal(snapshot.ratings['journey-enjoy-the-silence'], 2);
  assert.deepEqual(snapshot.tags['journey-enjoy-the-silence'], ['ghost in the track']);
  assert.equal(snapshot.trackFeedback['journey-enjoy-the-silence'], 'Keep this.');
});

test('the browser adapter fills and persists the card without embedding or promoting playback truth', () => {
  assert.match(nativeAutoApplySource, /input\.value = spotify\.openUrl/);
  assert.match(nativeAutoApplySource, /storage\.setItem\(STORAGE_KEY, JSON\.stringify\(snapshot\)\)/);
  assert.match(nativeAutoApplySource, /Open in Spotify/);
  assert.match(nativeAutoApplySource, /browser playback not yet verified/);
  assert.match(nativeAutoApplySource, /MutationObserver/);
  assert.doesNotMatch(nativeAutoApplySource, /createElement\(['"]iframe['"]\)|embedUrl|candidateVerificationStatus\s*=/);
});

test('fresh journey candidate generation never silently recycles already shown tracks', () => {
  const shown = [];
  let exhausted = false;
  for (let cycle = 1; cycle <= 12; cycle += 1) {
    const result = buildArtistAwareCandidates({
      artistInput: 'Anyma',
      tasteDNA: {},
      recentlyShownIds: shown,
      sessionCounter: cycle,
      recycleSeen: false,
    });
    assert.equal(result.recycledCount, 0);
    assert.ok(result.candidates.every((candidate) => !shown.includes(candidate.id)));
    if (result.noveltyExhausted) {
      assert.equal(result.candidates.length, 0);
      exhausted = true;
      break;
    }
    shown.push(...result.candidates.map((candidate) => candidate.id));
  }
  assert.equal(exhausted, true);
});

test('fresh journey planning preserves existing truth and adds only unseen tracks', () => {
  const snapshot = {
    candidates: [{ id: 'old-candidate', artist: 'Old Artist', title: 'Old Candidate' }],
    listeningDeck: [{ id: 'playing-track', artist: 'Current Artist', title: 'Current Track' }],
    ratings: { 'playing-track': 2, 'old-candidate': -1 },
    tags: { 'playing-track': ['ghost in the track'] },
    trackFeedback: { 'playing-track': 'Keep this.' },
    journeyHistoryKeys: ['id:older-history'],
    recentlyShownCandidateIds: ['older-history'],
  };
  const incoming = [
    { id: 'old-candidate', artist: 'Old Artist', title: 'Old Candidate' },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `fresh-${index + 1}`,
      artist: `Fresh Artist ${index + 1}`,
      title: `Fresh Track ${index + 1}`,
      sourceKind: index < 3 ? 'native-catalog' : 'taste-dna',
      catalogVerificationStatus: index < 3 ? 'metadata_verified' : undefined,
    })),
  ];
  const plan = planFreshJourneyState({ snapshot, candidates: incoming, startedAt: '2026-08-04T03:00:00.000Z' });
  assert.equal(plan.ok, true);
  assert.equal(plan.freshCount, 7);
  assert.equal(plan.addedCount, 7);
  assert.equal(plan.catalogueCount, 3);
  assert.equal(plan.recycledCount, 0);
  assert.ok(plan.selected.every((track) => track.id.startsWith('fresh-')));
  assert.deepEqual(plan.state.listeningDeck.slice(0, 7).map((track) => track.id), ['fresh-1', 'fresh-2', 'fresh-3', 'fresh-4', 'fresh-5', 'fresh-6', 'fresh-7']);
  assert.equal(plan.state.lastFreshJourneySummary.activeJourneyCount, 7);
  assert.equal(plan.state.lastFreshJourneySummary.roomCount, 8);
  assert.equal(plan.state.listeningDeck.at(-1).id, 'playing-track');
  assert.equal(plan.state.ratings['playing-track'], 2);
  assert.deepEqual(plan.state.tags['playing-track'], ['ghost in the track']);
  assert.equal(plan.state.trackFeedback['playing-track'], 'Keep this.');
  assert.equal(plan.state.lastFreshJourneySummary.recycledCount, 0);
});

test('Start Journey is split into fresh-start and non-mutating continue actions', () => {
  assert.match(freshJourneyControllerSource, /startButton\.textContent = 'Start New Journey'/);
  assert.match(freshJourneyControllerSource, /continueButton\.textContent = 'Continue Current Journey'/);
  assert.match(freshJourneyControllerSource, /requestNativeCatalogSearch\(query/);
  assert.match(freshJourneyControllerSource, /CATALOGUE_QUERY_VARIANTS/);
  assert.match(freshJourneyControllerSource, /#build-journey-btn/);
  assert.match(freshJourneyControllerSource, /planFreshJourneyState\(/);
  assert.match(freshJourneyControllerSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(freshJourneyControllerSource, /document\.addEventListener\('click',[\s\S]*true\)/);
  assert.match(freshJourneyControllerSource, /recycledCount: 0/);
  assert.match(freshJourneyControllerSource, /reload\(\)/);
  assert.match(freshJourneyControllerSource, /No songs were replaced or added/);
});
