import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MUSIC_DISCOVERY_CONNECTIONS_SCHEMA_VERSION,
  buildMusicDiscoveryConnections,
} from '../apps/music-tile/engine/musicDiscoveryConnections.js';

test('seeded related artists are surfaced only as labelled inference', () => {
  const result = buildMusicDiscoveryConnections({ artistName: 'Anyma' });
  assert.equal(result.schemaVersion, MUSIC_DISCOVERY_CONNECTIONS_SCHEMA_VERSION);
  assert.equal(result.status, 'READY');
  assert.equal(result.anchorArtist, 'Anyma');
  assert.ok(result.connections.length > 0);
  assert.ok(result.connections.every((item) => item.evidenceClass === 'LOCAL_SEED_INFERENCE'));
  assert.ok(result.connections.every((item) => item.externallyVerified === false));
  assert.ok(result.connections.every((item) => /inference|explore/i.test(item.whyInteresting)));
});

test('only explicit verified catalogue evidence upgrades a matching connection', () => {
  const result = buildMusicDiscoveryConnections({
    artistName: 'Anyma',
    catalogueEvidence: [
      { artistName: 'Sevdaliza', verified: true, sourceRef: 'catalogue:sevdaliza', reason: 'Canonical provider result matched the artist.' },
      { artistName: 'Grimes', verified: false, sourceRef: 'catalogue:grimes', reason: 'Candidate only.' },
    ],
  });
  const sevdaliza = result.connections.find((item) => item.artistName === 'Sevdaliza');
  const grimes = result.connections.find((item) => item.artistName === 'Grimes');
  assert.equal(sevdaliza.evidenceClass, 'VERIFIED_CATALOGUE_EVIDENCE');
  assert.equal(sevdaliza.externallyVerified, true);
  assert.equal(grimes.evidenceClass, 'LOCAL_SEED_INFERENCE');
  assert.equal(grimes.externallyVerified, false);
});

test('operator-owned taste evidence remains distinct from external verification', () => {
  const result = buildMusicDiscoveryConnections({
    artistName: 'Anyma',
    tasteEvidence: [
      { artistName: 'Argy', sourceRef: 'taste:rating-ledger', reason: 'Rated positively inside the Music Tile.' },
    ],
  });
  const argy = result.connections.find((item) => item.artistName === 'Argy');
  assert.equal(argy.evidenceClass, 'OPERATOR_TASTE_EVIDENCE');
  assert.equal(argy.externallyVerified, false);
  assert.match(argy.evidenceReason, /Music Tile|Rated/i);
});

test('provider failure or unverified catalogue candidates cannot fabricate verified facts', () => {
  const result = buildMusicDiscoveryConnections({
    artistName: 'Sevdaliza',
    catalogueEvidence: [
      { artistName: 'Anyma', verified: false, reason: 'Provider unavailable; cached candidate only.' },
    ],
  });
  const anyma = result.connections.find((item) => item.artistName === 'Anyma');
  assert.equal(anyma.evidenceClass, 'LOCAL_SEED_INFERENCE');
  assert.equal(anyma.externallyVerified, false);
  assert.equal(result.claims.collaborationClaimsAllowed, false);
  assert.equal(result.claims.labelClaimsAllowed, false);
  assert.equal(result.claims.listeningHistoryClaimsAllowed, false);
  assert.equal(result.claims.spotifyPlaybackClaimsAllowed, false);
});

test('unknown artists fail gently instead of inventing connections', () => {
  const result = buildMusicDiscoveryConnections({ artistName: 'Completely Unknown Artist' });
  assert.equal(result.status, 'EVIDENCE_UNAVAILABLE');
  assert.deepEqual(result.connections, []);
  assert.match(result.message, /No governed local discovery connections/i);
});

test('discovery connection generation has zero playback, rating or teaching mutation authority', () => {
  const result = buildMusicDiscoveryConnections({ artistName: 'Anyma', maxConnections: 3 });
  assert.equal(result.connections.length, 3);
  assert.deepEqual(result.continuityPolicy, {
    replacesPlayerDom: false,
    changesCurrentTrack: false,
    changesRatings: false,
    changesTeachingState: false,
  });
});

test('hostile evidence records are ignored rather than executed or trusted', () => {
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'artistName', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  const result = buildMusicDiscoveryConnections({
    artistName: 'Anyma',
    catalogueEvidence: [hostile],
  });
  assert.equal(getterCalls, 0);
  assert.ok(result.connections.every((item) => item.externallyVerified === false));
});
