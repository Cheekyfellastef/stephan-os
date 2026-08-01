import { appendFile, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { resolveSharedWorkspacePath } from './sharedAgentWorkspaceStore.mjs';
import { createWindowsSafeMailboxReceiptFilename } from './windowsSafeMailboxReceiptFilename.mjs';

export const MUSIC_SPOTIFY_LINK_OPERATION = 'APPLY_VERIFIED_SPOTIFY_LINK';
export const MUSIC_SPOTIFY_LINK_SCHEMA = 'stephanos.music.spotify-link-candidate.v1';
export const MUSIC_SPOTIFY_LINK_SOURCE = 'chatgpt-spotify-connector';
export const MUSIC_SPOTIFY_LINK_PATH = Object.freeze(['status', 'music-spotify-link-inbox.jsonl']);
export const MUSIC_SPOTIFY_RECEIPT_PATH = Object.freeze(['receipts', 'github-command-mailbox']);

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const TRACK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;
const SPOTIFY_TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;
const SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CANDIDATE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function spotifyPayloadSha256(candidate) {
  const payload = [
    candidate.schemaVersion,
    candidate.requestId,
    candidate.source,
    candidate.spotifyUri,
    candidate.spotifyUrl,
    candidate.targetTrackId,
    candidate.targetArtist,
    candidate.targetTitle,
    candidate.requestedAtUtc,
  ];
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

async function verifySafeInboxPath(root, target) {
  try {
    const resolvedRoot = resolve(root);
    const resolvedParent = dirname(target);
    const [rootInfo, parentInfo, actualRoot, actualParent] = await Promise.all([
      lstat(resolvedRoot),
      lstat(resolvedParent),
      realpath(resolvedRoot),
      realpath(resolvedParent),
    ]);
    const parentRelative = relative(actualRoot, actualParent);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()
      || parentInfo.isSymbolicLink() || !parentInfo.isDirectory()
      || parentRelative.startsWith('..')) return false;
    try {
      const targetInfo = await lstat(target);
      return targetInfo.isFile() && !targetInfo.isSymbolicLink();
    } catch (error) {
      return error?.code === 'ENOENT';
    }
  } catch {
    return false;
  }
}

function cleanText(value, max) {
  const text = String(value || '').trim();
  return text && text.length <= max && !CONTROL.test(text) ? text : '';
}

export function validateMusicSpotifyLinkCandidate(input = {}) {
  const requestId = String(input.requestId || '');
  const spotifyUri = String(input.spotifyUri || '');
  const match = spotifyUri.match(SPOTIFY_TRACK_URI);
  const targetTrackId = input.targetTrackId ? String(input.targetTrackId) : '';
  const targetArtist = cleanText(input.targetArtist, 160);
  const targetTitle = cleanText(input.targetTitle, 200);
  const requestedAtUtc = String(input.requestedAtUtc || '');
  if (!REQUEST_ID.test(requestId)) return { ok: false, blocker: 'MUSIC_SPOTIFY_REQUEST_ID_INVALID' };
  if (input.source !== MUSIC_SPOTIFY_LINK_SOURCE) return { ok: false, blocker: 'MUSIC_SPOTIFY_SOURCE_NOT_ALLOWED' };
  if (!match) return { ok: false, blocker: 'MUSIC_SPOTIFY_TRACK_URI_INVALID' };
  if (targetTrackId && !TRACK_ID.test(targetTrackId)) return { ok: false, blocker: 'MUSIC_SPOTIFY_TARGET_TRACK_ID_INVALID' };
  if (!targetArtist || !targetTitle) return { ok: false, blocker: 'MUSIC_SPOTIFY_TARGET_IDENTITY_REQUIRED' };
  if (!Number.isFinite(Date.parse(requestedAtUtc))) return { ok: false, blocker: 'MUSIC_SPOTIFY_REQUEST_TIME_INVALID' };
  return {
    ok: true,
    candidate: Object.freeze({
      schemaVersion: MUSIC_SPOTIFY_LINK_SCHEMA,
      requestId,
      source: MUSIC_SPOTIFY_LINK_SOURCE,
      spotifyUri,
      spotifyUrl: `https://open.spotify.com/track/${match[1]}`,
      targetTrackId,
      targetArtist,
      targetTitle,
      requestedAtUtc: new Date(requestedAtUtc).toISOString(),
    }),
  };
}

export async function appendMusicSpotifyLinkCandidate(input = {}, options = {}) {
  const validated = validateMusicSpotifyLinkCandidate(input);
  if (!validated.ok) return validated;
  const resolved = resolveSharedWorkspacePath({ root: options.root, repoRoot: options.repoRoot, segments: MUSIC_SPOTIFY_LINK_PATH });
  if (!resolved.ok) return { ok: false, blocker: resolved.reason };
  await mkdir(dirname(resolved.path), { recursive: true, mode: 0o700 });
  let size = 0;
  try { size = (await stat(resolved.path)).size; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const expectedHead = String(options.expectedHead || input.expectedHead || '').toLowerCase();
  const receiptRef = String(options.receiptRef || '');
  if (!SHA.test(expectedHead)) return { ok: false, blocker: 'MUSIC_SPOTIFY_PROVENANCE_HEAD_REQUIRED' };
  if (receiptRef !== `receipts/github-command-mailbox/${createWindowsSafeMailboxReceiptFilename(validated.candidate.requestId)}`) {
    return { ok: false, blocker: 'MUSIC_SPOTIFY_PROVENANCE_RECEIPT_INVALID' };
  }
  if (!(await verifySafeInboxPath(resolved.root, resolved.path))) {
    return { ok: false, blocker: 'MUSIC_SPOTIFY_INBOX_PATH_UNSAFE' };
  }
  const payloadSha256 = spotifyPayloadSha256(validated.candidate);
  const line = `${JSON.stringify({ ...validated.candidate, expectedHead, receiptRef, payloadSha256 })}\n`;
  if (size + Buffer.byteLength(line) > MAX_FILE_BYTES) return { ok: false, blocker: 'MUSIC_SPOTIFY_INBOX_FULL' };
  await appendFile(resolved.path, line, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, finalVerdict: 'MUSIC_SPOTIFY_LINK_QUEUED', requestId: validated.candidate.requestId, payloadSha256 };
}

export async function validateMusicSpotifyLinkProvenance(record, options = {}) {
  if (!SHA.test(String(record.expectedHead || ''))) return { ok: false, blocker: 'MUSIC_SPOTIFY_PROVENANCE_HEAD_INVALID' };
  const filename = createWindowsSafeMailboxReceiptFilename(record.requestId);
  if (record.receiptRef !== `receipts/github-command-mailbox/${filename}`) return { ok: false, blocker: 'MUSIC_SPOTIFY_PROVENANCE_REF_INVALID' };
  const resolved = resolveSharedWorkspacePath({
    root: options.root,
    repoRoot: options.repoRoot,
    segments: [...MUSIC_SPOTIFY_RECEIPT_PATH, filename],
  });
  if (!resolved.ok) return { ok: false, blocker: resolved.reason };
  try {
    const info = await lstat(resolved.path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 256 * 1024) return { ok: false, blocker: 'MUSIC_SPOTIFY_PROVENANCE_RECEIPT_UNSAFE' };
    const receipt = JSON.parse(await readFile(resolved.path, 'utf8'));
    const payloadSha256 = spotifyPayloadSha256(validateMusicSpotifyLinkCandidate(record).candidate || {});
    const trusted = SHA256.test(String(record.payloadSha256 || ''))
      && record.payloadSha256 === payloadSha256
      && receipt?.schemaVersion === 'stephanos.battle-bridge-github-command-receipt.v1'
      && receipt?.state === 'DONE'
      && receipt?.operation === MUSIC_SPOTIFY_LINK_OPERATION
      && receipt?.requestId === record.requestId
      && String(receipt?.expectedHead || '').toLowerCase() === record.expectedHead
      && Array.isArray(receipt?.proofRefs) && receipt.proofRefs.includes(record.receiptRef)
      && receipt?.result?.ok === true
      && receipt?.result?.operation === MUSIC_SPOTIFY_LINK_OPERATION
      && receipt?.result?.requestId === record.requestId
      && receipt?.result?.result?.finalVerdict === 'MUSIC_SPOTIFY_LINK_QUEUED'
      && receipt?.result?.result?.payloadSha256 === payloadSha256;
    return trusted ? { ok: true } : { ok: false, blocker: 'MUSIC_SPOTIFY_PROVENANCE_RECEIPT_MISMATCH' };
  } catch { return { ok: false, blocker: 'MUSIC_SPOTIFY_PROVENANCE_RECEIPT_UNAVAILABLE' }; }
}

export async function readMusicSpotifyLinkCandidates(options = {}) {
  const resolved = resolveSharedWorkspacePath({ root: options.root, repoRoot: options.repoRoot, segments: MUSIC_SPOTIFY_LINK_PATH });
  if (!resolved.ok) return { ok: false, configured: false, blocker: resolved.reason, candidates: [] };
  let text = '';
  try {
    const info = await lstat(resolved.path);
    if (info.isSymbolicLink() || !info.isFile()) return { ok: false, configured: true, blocker: 'MUSIC_SPOTIFY_INBOX_PATH_UNSAFE', candidates: [] };
    if (info.size > MAX_FILE_BYTES) return { ok: false, configured: true, blocker: 'MUSIC_SPOTIFY_INBOX_TOO_LARGE', candidates: [] };
    text = await readFile(resolved.path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, configured: true, candidates: [] };
    throw error;
  }
  const byId = new Map();
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  for (const line of text.split(/\r?\n/).filter(Boolean).slice(-500)) {
    try {
      const parsed = JSON.parse(line);
      const validated = validateMusicSpotifyLinkCandidate(parsed);
      const requestedAtMs = Date.parse(validated.candidate?.requestedAtUtc || '');
      if (validated.ok
        && (await validateMusicSpotifyLinkProvenance(parsed, options)).ok
        && requestedAtMs >= nowMs - MAX_CANDIDATE_AGE_MS
        && requestedAtMs <= nowMs + MAX_FUTURE_SKEW_MS) {
        byId.set(validated.candidate.requestId, validated.candidate);
      }
    } catch { /* malformed lines are ignored, never projected */ }
  }
  return { ok: true, configured: true, candidates: [...byId.values()].slice(-100) };
}
