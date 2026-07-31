import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendMusicSpotifyLinkCandidate,
  MUSIC_SPOTIFY_LINK_SOURCE,
  readMusicSpotifyLinkCandidates,
  validateMusicSpotifyLinkProvenance,
  validateMusicSpotifyLinkCandidate,
} from './musicSpotifyLinkBridge.mjs';
import { createWindowsSafeMailboxReceiptFilename } from './windowsSafeMailboxReceiptFilename.mjs';

const expectedHead = '1234567890abcdef1234567890abcdef12345678';
const receiptRef = `receipts/github-command-mailbox/${createWindowsSafeMailboxReceiptFilename('spotify-link-test-001')}`;

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
    const provenance = { root: workspace, repoRoot, expectedHead, receiptRef };
    assert.equal((await appendMusicSpotifyLinkCandidate(candidate, provenance)).ok, true);
    assert.equal((await appendMusicSpotifyLinkCandidate(candidate, provenance)).ok, true);
    const receiptRoot = join(workspace, 'receipts', 'github-command-mailbox');
    await mkdir(receiptRoot, { recursive: true });
    await writeFile(join(receiptRoot, createWindowsSafeMailboxReceiptFilename(candidate.requestId)), JSON.stringify({
      schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
      state: 'DONE',
      operation: 'APPLY_VERIFIED_SPOTIFY_LINK',
      requestId: candidate.requestId,
      expectedHead,
      proofRefs: [receiptRef],
      result: {
        ok: true,
        operation: 'APPLY_VERIFIED_SPOTIFY_LINK',
        requestId: candidate.requestId,
        result: { finalVerdict: 'MUSIC_SPOTIFY_LINK_QUEUED' },
      },
    }));
    const raw = { ...candidate, expectedHead, receiptRef };
    assert.deepEqual(await validateMusicSpotifyLinkProvenance(raw, { root: workspace, repoRoot }), { ok: true });
    const result = await readMusicSpotifyLinkCandidates({ root: workspace, repoRoot, nowMs: Date.parse(candidate.requestedAtUtc) });
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(Object.keys(result.candidates[0]).sort(), ['requestId', 'requestedAtUtc', 'schemaVersion', 'source', 'spotifyUri', 'spotifyUrl', 'targetArtist', 'targetTitle', 'targetTrackId'].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed when a shape-valid workspace record lacks its trusted mailbox receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-spotify-forgery-'));
  const repoRoot = join(root, 'not-the-repo');
  const workspace = join(root, 'external-workspace');
  try {
    assert.equal((await appendMusicSpotifyLinkCandidate(candidate, { root: workspace, repoRoot, expectedHead, receiptRef })).ok, true);
    const result = await readMusicSpotifyLinkCandidates({ root: workspace, repoRoot, nowMs: Date.parse(candidate.requestedAtUtc) });
    assert.deepEqual(result.candidates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
