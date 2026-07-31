import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendMusicSpotifyLinkCandidate,
  MUSIC_SPOTIFY_LINK_SOURCE,
  readMusicSpotifyLinkCandidates,
  validateMusicSpotifyLinkCandidate,
} from './musicSpotifyLinkBridge.mjs';

const candidate = {
  requestId: 'spotify-link-test-001',
  source: MUSIC_SPOTIFY_LINK_SOURCE,
  spotifyUri: 'spotify:track:1234567890123456789012',
  targetTrackId: 'deck-track-1',
  targetArtist: 'Test Artist',
  targetTitle: 'Test Track',
  requestedAtUtc: '2026-07-31T12:00:00.000Z',
};

test('accepts only a bounded Spotify track URI and builds the canonical URL', () => {
  const result = validateMusicSpotifyLinkCandidate(candidate);
  assert.equal(result.ok, true);
  assert.equal(result.candidate.spotifyUrl, 'https://open.spotify.com/track/1234567890123456789012');
  assert.equal(validateMusicSpotifyLinkCandidate({ ...candidate, spotifyUri: 'https://open.spotify.com/track/1234567890123456789012' }).blocker, 'MUSIC_SPOTIFY_TRACK_URI_INVALID');
  assert.equal(validateMusicSpotifyLinkCandidate({ ...candidate, spotifyUri: 'spotify:playlist:1234567890123456789012' }).blocker, 'MUSIC_SPOTIFY_TRACK_URI_INVALID');
  assert.equal(validateMusicSpotifyLinkCandidate({ ...candidate, source: 'browser-token' }).blocker, 'MUSIC_SPOTIFY_SOURCE_NOT_ALLOWED');
});

test('appends externally and reads a sanitized, deduplicated projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-spotify-link-'));
  const repoRoot = join(root, 'not-the-repo');
  const workspace = join(root, 'external-workspace');
  try {
    assert.equal((await appendMusicSpotifyLinkCandidate(candidate, { root: workspace, repoRoot })).ok, true);
    assert.equal((await appendMusicSpotifyLinkCandidate(candidate, { root: workspace, repoRoot })).ok, true);
    const result = await readMusicSpotifyLinkCandidates({ root: workspace, repoRoot, nowMs: Date.parse(candidate.requestedAtUtc) });
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(Object.keys(result.candidates[0]).sort(), ['requestId', 'requestedAtUtc', 'schemaVersion', 'source', 'spotifyUri', 'spotifyUrl', 'targetArtist', 'targetTitle', 'targetTrackId'].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
