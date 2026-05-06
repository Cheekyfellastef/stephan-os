import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';
import { buildMusicLandingSummaryLines, buildMusicTasteCockpitSummary } from '../apps/music-tile/data/musicTasteSummary.js';

test('taste seed includes spotify-first canonical with youtube fallback policy room', () => {
  const spotifyTrack = SEEDED_TASTE_TRACKS.find((track) => track.canonicalSource === 'spotify');
  assert.ok(spotifyTrack);
  assert.ok(spotifyTrack.spotifyUrl || spotifyTrack.spotifyUri);
});

test('taste summary projection includes target lane and seeded counts', () => {
  const summary = buildMusicTasteCockpitSummary(SEEDED_TASTE_TRACKS);
  assert.equal(summary.target, 'Dark Courtyard / Ghost Vocal / Serious Trance DNA');
  assert.equal(summary.counts.likedGoodFantastic, 3);
  assert.equal(summary.counts.interesting, 0);
  assert.equal(summary.counts.nearly, 0);
  assert.equal(summary.counts.rejects, 1);
});

test('landing summary lines expose spotify-first cockpit and playback stance', () => {
  const lines = buildMusicLandingSummaryLines(buildMusicTasteCockpitSummary(SEEDED_TASTE_TRACKS));
  assert.ok(lines.some((line) => /Spotify-first|Taste Cockpit/i.test(line)));
  assert.ok(lines.some((line) => /Spotify canonical/i.test(line)));
  assert.ok(lines.some((line) => /YouTube discovery\/fallback/i.test(line)));
});
