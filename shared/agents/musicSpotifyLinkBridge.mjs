import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveSharedWorkspacePath } from './sharedAgentWorkspaceStore.mjs';

export const MUSIC_SPOTIFY_LINK_OPERATION = 'APPLY_VERIFIED_SPOTIFY_LINK';
export const MUSIC_SPOTIFY_LINK_SCHEMA = 'stephanos.music.spotify-link-candidate.v1';
export const MUSIC_SPOTIFY_LINK_SOURCE = 'chatgpt-spotify-connector';
export const MUSIC_SPOTIFY_LINK_PATH = Object.freeze(['status', 'music-spotify-link-inbox.jsonl']);

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const TRACK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;
const SPOTIFY_TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CANDIDATE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

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
  const line = `${JSON.stringify(validated.candidate)}\n`;
  if (size + Buffer.byteLength(line) > MAX_FILE_BYTES) return { ok: false, blocker: 'MUSIC_SPOTIFY_INBOX_FULL' };
  await appendFile(resolved.path, line, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, finalVerdict: 'MUSIC_SPOTIFY_LINK_QUEUED', requestId: validated.candidate.requestId };
}

export async function readMusicSpotifyLinkCandidates(options = {}) {
  const resolved = resolveSharedWorkspacePath({ root: options.root, repoRoot: options.repoRoot, segments: MUSIC_SPOTIFY_LINK_PATH });
  if (!resolved.ok) return { ok: false, configured: false, blocker: resolved.reason, candidates: [] };
  let text = '';
  try {
    const info = await stat(resolved.path);
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
      const validated = validateMusicSpotifyLinkCandidate(JSON.parse(line));
      const requestedAtMs = Date.parse(validated.candidate?.requestedAtUtc || '');
      if (validated.ok && requestedAtMs >= nowMs - MAX_CANDIDATE_AGE_MS && requestedAtMs <= nowMs + MAX_FUTURE_SKEW_MS) {
        byId.set(validated.candidate.requestId, validated.candidate);
      }
    } catch { /* malformed lines are ignored, never projected */ }
  }
  return { ok: true, configured: true, candidates: [...byId.values()].slice(-100) };
}
