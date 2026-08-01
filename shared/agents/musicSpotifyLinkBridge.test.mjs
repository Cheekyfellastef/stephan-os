import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    const queuedRecord = JSON.parse((await readFile(join(workspace, 'status', 'music-spotify-link-inbox.jsonl'), 'utf8')).trim().split(/\r?\n/)[0]);
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
        result: { finalVerdict: 'MUSIC_SPOTIFY_LINK_QUEUED', payloadSha256: queuedRecord.payloadSha256 },
      },
    }));
    const raw = { ...candidate, expectedHead, receiptRef, payloadSha256: queuedRecord.payloadSha256 };
    assert.deepEqual(await validateMusicSpotifyLinkProvenance(raw, { root: workspace, repoRoot }), { ok: true });
    const result = await readMusicSpotifyLinkCandidates({ root: workspace, repoRoot, nowMs: Date.parse(candidate.requestedAtUtc) });
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(Object.keys(result.candidates[0]).sort(), ['requestId', 'requestedAtUtc', 'schemaVersion', 'source', 'spotifyUri', 'spotifyUrl', 'targetArtist', 'targetTitle', 'targetTrackId'].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a receipt that is not bound to the exact Spotify payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-spotify-payload-'));
  const repoRoot = join(root, 'not-the-repo');
  const workspace = join(root, 'external-workspace');
  try {
    await appendMusicSpotifyLinkCandidate(candidate, { root: workspace, repoRoot, expectedHead, receiptRef });
    const inboxPath = join(workspace, 'status', 'music-spotify-link-inbox.jsonl');
    const record = JSON.parse((await readFile(inboxPath, 'utf8')).trim());
    const receiptRoot = join(workspace, 'receipts', 'github-command-mailbox');
    await mkdir(receiptRoot, { recursive: true });
    await writeFile(join(receiptRoot, createWindowsSafeMailboxReceiptFilename(candidate.requestId)), JSON.stringify({
      schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1', state: 'DONE', operation: 'APPLY_VERIFIED_SPOTIFY_LINK',
      requestId: candidate.requestId, expectedHead, proofRefs: [receiptRef],
      result: { ok: true, operation: 'APPLY_VERIFIED_SPOTIFY_LINK', requestId: candidate.requestId, result: { finalVerdict: 'MUSIC_SPOTIFY_LINK_QUEUED', payloadSha256: '0'.repeat(64) } },
    }));
    assert.equal((await validateMusicSpotifyLinkProvenance(record, { root: workspace, repoRoot })).ok, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a symlinked Spotify inbox instead of appending through it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-spotify-symlink-'));
  const repoRoot = join(root, 'not-the-repo');
  const workspace = join(root, 'external-workspace');
  try {
    await mkdir(join(workspace, 'status'), { recursive: true });
    const redirected = join(root, 'redirected.jsonl');
    await writeFile(redirected, '');
    await symlink(redirected, join(workspace, 'status', 'music-spotify-link-inbox.jsonl'));
    const result = await appendMusicSpotifyLinkCandidate(candidate, { root: workspace, repoRoot, expectedHead, receiptRef });
    assert.equal(result.blocker, 'MUSIC_SPOTIFY_INBOX_PATH_UNSAFE');
    assert.equal(await readFile(redirected, 'utf8'), '');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a hard-linked Spotify inbox without modifying the linked victim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-spotify-hardlink-'));
  const repoRoot = join(root, 'not-the-repo');
  const workspace = join(root, 'external-workspace');
  try {
    await mkdir(join(workspace, 'status'), { recursive: true });
    const victim = join(root, 'victim.jsonl');
    await writeFile(victim, 'protected\n');
    await link(victim, join(workspace, 'status', 'music-spotify-link-inbox.jsonl'));
    const result = await appendMusicSpotifyLinkCandidate(candidate, { root: workspace, repoRoot, expectedHead, receiptRef });
    assert.equal(result.blocker, 'MUSIC_SPOTIFY_INBOX_PATH_UNSAFE');
    assert.equal(await readFile(victim, 'utf8'), 'protected\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('uses validated copy-and-replace instead of mutating an existing inbox inode', async () => {
  const moduleSource = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'musicSpotifyLinkBridge.mjs'), 'utf8');
  const start = moduleSource.indexOf('async function replaceInboxAtomically');
  const end = moduleSource.indexOf('\nfunction cleanText', start);
  const replacer = moduleSource.slice(start, end);
  assert.match(moduleSource, /Number\(handleInfo\.nlink\) === 1/);
  assert.match(replacer, /O_EXCL/);
  assert.match(replacer, /replacementHandle\.writeFile\(nextText/);
  assert.match(replacer, /inboxSnapshotUnchanged\(root, target, snapshot\)/);
  assert.match(replacer, /rename\(replacementPath, target\)/);
  assert.doesNotMatch(moduleSource, /await appendFile\(resolved\.path/);
  assert.doesNotMatch(moduleSource, /\.appendFile\(/);
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
