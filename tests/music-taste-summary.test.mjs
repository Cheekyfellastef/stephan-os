import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';

test('taste seed includes spotify-first canonical with youtube fallback policy room', () => {
  const spotifyTrack = SEEDED_TASTE_TRACKS.find((track) => track.canonicalSource === 'spotify');
  assert.ok(spotifyTrack);
  assert.ok(spotifyTrack.spotifyUrl || spotifyTrack.spotifyUri);
});

test('taste summary counts expected buckets', () => {
  const counts = SEEDED_TASTE_TRACKS.reduce((acc, track) => {
    acc[track.signal] = (acc[track.signal] || 0) + 1;
    return acc;
  }, {});
  assert.equal(counts.reject, 1);
  assert.ok((counts.liked || 0) + (counts.fantastic || 0) >= 2);
});
