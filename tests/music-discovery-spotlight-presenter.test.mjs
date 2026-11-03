import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MUSIC_DISCOVERY_SPOTLIGHT_SCHEMA_VERSION,
  buildMusicDiscoverySpotlightView,
} from '../apps/music-tile/engine/musicDiscoverySpotlightPresenter.js';

function build(overrides = {}) {
  return buildMusicDiscoverySpotlightView({
    surface: 'DISCOVERY_SPOTLIGHT',
    artistName: 'Anyma',
    maxCards: 4,
    catalogueEvidence: [],
    tasteEvidence: [],
    ...overrides,
  });
}

test('presents governed discovery connections as bounded card view-models', () => {
  const result = build();
  assert.equal(result.schemaVersion, MUSIC_DISCOVERY_SPOTLIGHT_SCHEMA_VERSION);
  assert.equal(result.surface, 'DISCOVERY_SPOTLIGHT');
  assert.equal(result.status, 'READY');
  assert.ok(result.cards.length > 0 && result.cards.length <= 4);
  assert.equal(result.cards.every((card) => card.cardType === 'MUSIC_DISCOVERY_CONNECTION'), true);
  assert.equal(result.cards.every((card) => card.action.type === 'SEARCH_EXISTING_CATALOGUE'), true);
});

test('keeps local seed relationships visibly labelled as inference', () => {
  const result = build();
  const inferred = result.cards.find((card) => card.evidenceClass === 'LOCAL_SEED_INFERENCE');
  assert.ok(inferred);
  assert.equal(inferred.externallyVerified, false);
  assert.equal(inferred.evidenceLabel, 'Local discovery inference');
  assert.match(inferred.evidenceReason, /not external verification/i);
});

test('verified catalogue evidence is surfaced without widening playback authority', () => {
  const first = build();
  const artistName = first.cards[0].artistName;
  const result = build({
    catalogueEvidence: [{
      artistName,
      verified: true,
      sourceRef: 'catalogue:test',
      reason: 'Verified catalogue relationship evidence.',
    }],
  });
  const card = result.cards.find((entry) => entry.artistName === artistName);
  assert.equal(card.evidenceClass, 'VERIFIED_CATALOGUE_EVIDENCE');
  assert.equal(card.externallyVerified, true);
  assert.equal(card.evidenceLabel, 'Verified catalogue evidence');
  assert.deepEqual(result.continuityPolicy, {
    replacesPlayerDom: false,
    changesCurrentTrack: false,
    changesRatings: false,
    changesTeachingState: false,
  });
});

test('operator taste evidence remains distinct from external verification', () => {
  const first = build();
  const artistName = first.cards[0].artistName;
  const result = build({
    tasteEvidence: [{ artistName, reason: 'Explicitly rated in the Music Tile.' }],
  });
  const card = result.cards.find((entry) => entry.artistName === artistName);
  assert.equal(card.evidenceClass, 'OPERATOR_TASTE_EVIDENCE');
  assert.equal(card.externallyVerified, false);
  assert.equal(card.evidenceLabel, 'Your Music Tile evidence');
});

test('supports the existing Listening Room as a presentation target without creating a second player', () => {
  const result = build({ surface: 'LISTENING_ROOM' });
  assert.equal(result.surface, 'LISTENING_ROOM');
  assert.equal(result.continuityPolicy.replacesPlayerDom, false);
  assert.equal(result.continuityPolicy.changesCurrentTrack, false);
});

test('unknown artists fail closed with no fabricated cards', () => {
  const result = build({ artistName: 'artist-with-no-governed-evidence-xyz' });
  assert.equal(result.status, 'EVIDENCE_UNAVAILABLE');
  assert.deepEqual(result.cards, []);
  assert.match(result.message, /No governed local discovery connections|No governed discovery connections/i);
});

test('hostile top-level accessors are rejected without invocation', () => {
  let calls = 0;
  const hostile = {
    surface: 'DISCOVERY_SPOTLIGHT',
    get artistName() {
      calls += 1;
      return 'Anyma';
    },
    maxCards: 4,
    catalogueEvidence: [],
    tasteEvidence: [],
  };
  const result = buildMusicDiscoverySpotlightView(hostile);
  assert.equal(calls, 0);
  assert.equal(result.status, 'EVIDENCE_UNAVAILABLE');
  assert.deepEqual(result.cards, []);
});

test('card count is bounded even when callers request more', () => {
  const result = build({ maxCards: 999 });
  assert.ok(result.cards.length <= 6);
});
