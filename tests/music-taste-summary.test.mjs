import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEDED_TASTE_TRACKS } from '../apps/music-tile/data/musicTasteSeeds.js';
import { buildMusicLandingSummaryLines, buildMusicWorkspaceSummary } from '../apps/music-tile/data/musicTasteSummary.js';

test('taste seed includes spotify-first canonical with youtube fallback policy room', () => {
  const spotifyTrack = SEEDED_TASTE_TRACKS.find((track) => track.canonicalSource === 'spotify');
  assert.ok(spotifyTrack);
  assert.ok(spotifyTrack.spotifyUrl || spotifyTrack.spotifyUri);
});

test('taste summary projection includes target lane and seeded counts', () => {
  const summary = buildMusicWorkspaceSummary(SEEDED_TASTE_TRACKS);
  assert.equal(summary.target, 'Dark Courtyard / Ghost Vocal / Serious Trance DNA');
  assert.equal(summary.counts.likedGoodFantastic, 3);
  assert.equal(summary.counts.interesting, 0);
  assert.equal(summary.counts.nearly, 0);
  assert.equal(summary.counts.rejects, 1);
});

test('landing summary lines stay compact while preserving spotify-first beacon', () => {
  const lines = buildMusicLandingSummaryLines();
  assert.ok(lines.some((line) => /Spotify-first|Taste Cockpit/i.test(line)));
  assert.ok(lines.some((line) => /Dark Courtyard \/ Ghost Vocal/i.test(line)));
  assert.ok(lines.some((line) => /Spotify canonical · YouTube fallback/i.test(line)));
  assert.ok(lines.some((line) => /Taste map active/i.test(line)));
  assert.ok(lines.some((line) => /Anchors 8 · Interesting 6 · Rejects tracked/i.test(line)));
  assert.equal(lines.some((line) => /Learning: serious hypnotic trance architecture/i.test(line)), false);
});
