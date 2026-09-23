import { applyCatalogEnrichmentToBrowser } from './nativeCatalogAutoApply.js';
import {
  planCatalogResultEnrichment,
  requestNativeCatalogSearch,
} from './nativeCatalogSearch.js';
import {
  applyYouTubeMediaResolutionToBrowser,
  hasExactYouTubeTrack,
} from './automaticMediaOverlay.js';
import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const AUTO_LINK_MAX_TRACKS_PER_PASS = 20;
const AUTO_LINK_CONCURRENCY = 2;
const AUTO_LINK_MAX_ATTEMPTS = 3;
const AUTO_LINK_SEARCH_TIMEOUT_MS = 7000;
const AUTO_LINK_INITIAL_DELAY_MS = 1500;
const AUTO_LINK_RETRY_DELAYS_MS = Object.freeze([1500, 3000, 6000]);

const retryState = new Map();
let continuityTimer = null;
let continuityTimerDueAt = 0;
let continuityRunning = false;
let observerInstalled = false;

function normalizedIdentity(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function trackKey(track = {}) {
  return [track.id, normalizedIdentity(track.artist), normalizedIdentity(track.title || track.name)]
    .map((value) => String(value || '').trim())
    .join('::');
}

function browserStorage() {
  try {
    const storage = globalThis.localStorage;
    return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : null;
  } catch {
    return null;
  }
}

function readSnapshot(storage = browserStorage()) {
  if (!storage) return null;
  try {
    const snapshot = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

function needsAutomaticLink(track = {}) {
  if (!track?.artist || !(track?.title || track?.name)) return false;
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  const hasSpotify = spotify.valid && spotify.type === 'track';
  return !hasSpotify && !hasExactYouTubeTrack(track);
}

function retryDelayForAttempt(attempts, retryDelays = AUTO_LINK_RETRY_DELAYS_MS) {
  const index = Math.max(0, Math.min(Number(attempts || 1) - 1, retryDelays.length - 1));
  return Math.max(0, Number(retryDelays[index] ?? retryDelays.at?.(-1) ?? 0) || 0);
}

function retryRecord(track) {
  return retryState.get(trackKey(track)) || { attempts: 0, nextEligibleAt: 0 };
}

function canAttempt(track, now = Date.now(), maxAttempts = AUTO_LINK_MAX_ATTEMPTS) {
  const record = retryRecord(track);
  return record.attempts < maxAttempts && now >= record.nextEligibleAt;
}

function markFailure(track, {
  now = Date.now(),
  retryDelays = AUTO_LINK_RETRY_DELAYS_MS,
} = {}) {
  const key = trackKey(track);
  const previous = retryState.get(key) || { attempts: 0, nextEligibleAt: 0 };
  const attempts = previous.attempts + 1;
  retryState.set(key, {
    attempts,
    nextEligibleAt: now + retryDelayForAttempt(attempts, retryDelays),
  });
  return attempts;
}

function markSuccess(track) {
  retryState.delete(trackKey(track));
}

function plannedVerifiedMatch(track, payload) {
  if (!payload?.ok || !Array.isArray(payload.results)) return null;
  for (const result of payload.results) {
    const planned = planCatalogResultEnrichment(track, result);
    if (planned.ok) return { result, planned };
  }
  return null;
}

async function requestAutomaticYouTubeResolution(track, {
  fetchImpl = globalThis.fetch,
  timeoutMs = AUTO_LINK_SEARCH_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const artist = String(track?.artist || '').trim();
  const title = String(track?.title || track?.name || '').trim();
  if (!artist || !title) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs || AUTO_LINK_SEARCH_TIMEOUT_MS)) + 1000);
  try {
    const url = `/api/music/youtube/resolve-track?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`;
    const response = await fetchImpl(url, { signal: controller.signal });
    const payload = await response.json();
    const result = payload?.result;
    if (!response.ok || payload?.ok !== true || !result
      || String(result.provider || '').toLowerCase() !== 'youtube'
      || String(result.verificationStatus || '') !== 'metadata_verified') return null;
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTrackLink(track, {
  fetchImpl = globalThis.fetch,
  applyEnrichment = applyCatalogEnrichmentToBrowser,
  applyYouTubeEnrichment = applyYouTubeMediaResolutionToBrowser,
  timeoutMs = AUTO_LINK_SEARCH_TIMEOUT_MS,
  now = Date.now(),
  retryDelays = AUTO_LINK_RETRY_DELAYS_MS,
} = {}) {
  let payload = null;
  try {
    payload = await requestNativeCatalogSearch(
      `${String(track.artist || '').trim()} ${String(track.title || track.name || '').trim()}`,
      { fetchImpl, limit: 10, timeoutMs },
    );
  } catch {
    payload = null;
  }

  const match = plannedVerifiedMatch(track, payload);
  if (match) {
    const applied = applyEnrichment({
      trackId: String(track.id || ''),
      artist: String(track.artist || ''),
      title: String(track.title || track.name || ''),
      spotifyUrl: match.planned.spotify.openUrl,
      spotifyUri: match.planned.spotify.uri,
      enrichment: match.planned.enrichment,
    });
    if (applied?.ok) {
      markSuccess(track);
      return { ok: true, resolved: true, provider: 'spotify', reason: applied.changed === false ? 'already-resolved' : 'resolved' };
    }
  }

  const youtube = await requestAutomaticYouTubeResolution(track, { fetchImpl, timeoutMs });
  if (youtube) {
    const applied = applyYouTubeEnrichment({
      trackId: String(track.id || ''),
      artist: String(track.artist || ''),
      title: String(track.title || track.name || ''),
      youtubeUrl: String(youtube.youtubeUrl || youtube.providerUrl || ''),
      youtubeVideoId: String(youtube.youtubeVideoId || youtube.providerItemId || ''),
      artworkUrl: String(youtube.artworkUrl || ''),
      enrichment: youtube,
    });
    if (applied?.ok) {
      markSuccess(track);
      return { ok: true, resolved: true, provider: 'youtube', reason: applied.changed === false ? 'already-resolved' : 'resolved' };
    }
  }

  markFailure(track, { now, retryDelays });
  return {
    ok: false,
    resolved: false,
    reason: payload?.ok ? 'no-verified-playable-match' : 'catalog-and-youtube-unavailable',
  };
}

function nextRetryDelay(snapshot, {
  now = Date.now(),
  maxAttempts = AUTO_LINK_MAX_ATTEMPTS,
} = {}) {
  const deck = Array.isArray(snapshot?.listeningDeck) ? snapshot.listeningDeck : [];
  let delay = Infinity;
  let pendingCount = 0;
  for (const track of deck) {
    if (!needsAutomaticLink(track)) continue;
    const record = retryRecord(track);
    if (record.attempts >= maxAttempts) continue;
    pendingCount += 1;
    delay = Math.min(delay, Math.max(0, record.nextEligibleAt - now));
  }
  return {
    pendingCount,
    delayMs: Number.isFinite(delay) ? delay : null,
  };
}

export async function runCatalogLinkContinuityPass({
  storage = browserStorage(),
  fetchImpl = globalThis.fetch,
  applyEnrichment = applyCatalogEnrichmentToBrowser,
  applyYouTubeEnrichment = applyYouTubeMediaResolutionToBrowser,
  maxTracks = AUTO_LINK_MAX_TRACKS_PER_PASS,
  maxAttempts = AUTO_LINK_MAX_ATTEMPTS,
  timeoutMs = AUTO_LINK_SEARCH_TIMEOUT_MS,
  retryDelays = AUTO_LINK_RETRY_DELAYS_MS,
  now = Date.now(),
} = {}) {
  const snapshot = readSnapshot(storage);
  if (!snapshot || !Array.isArray(snapshot.listeningDeck)) {
    return { ok: false, reason: 'music-state-invalid', attemptedCount: 0, resolvedCount: 0, pendingRetryCount: 0, nextRetryDelayMs: null };
  }

  const pending = snapshot.listeningDeck
    .filter((track) => needsAutomaticLink(track) && canAttempt(track, now, maxAttempts))
    .slice(0, Math.max(0, Math.min(Number(maxTracks) || AUTO_LINK_MAX_TRACKS_PER_PASS, AUTO_LINK_MAX_TRACKS_PER_PASS)));

  let cursor = 0;
  let resolvedCount = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const track = pending[cursor];
      cursor += 1;
      const result = await resolveTrackLink(track, {
        fetchImpl,
        applyEnrichment,
        applyYouTubeEnrichment,
        timeoutMs,
        now,
        retryDelays,
      });
      if (result.resolved) resolvedCount += 1;
    }
  };

  await Promise.all(Array.from({ length: Math.min(AUTO_LINK_CONCURRENCY, pending.length) }, () => worker()));

  const refreshed = readSnapshot(storage) || snapshot;
  const retry = nextRetryDelay(refreshed, { now: Date.now(), maxAttempts });
  return {
    ok: true,
    reason: resolvedCount ? 'resolved' : (pending.length ? 'retry-bounded' : 'nothing-eligible'),
    attemptedCount: pending.length,
    resolvedCount,
    pendingRetryCount: retry.pendingCount,
    nextRetryDelayMs: retry.delayMs,
  };
}

function queueContinuity(delayMs = 0) {
  if (continuityRunning || typeof setTimeout !== 'function') return;
  const delay = Math.max(0, Number(delayMs) || 0);
  const dueAt = Date.now() + delay;
  if (continuityTimer !== null) {
    if (dueAt >= continuityTimerDueAt) return;
    clearTimeout(continuityTimer);
    continuityTimer = null;
  }
  continuityTimerDueAt = dueAt;
  continuityTimer = setTimeout(async () => {
    continuityTimer = null;
    continuityTimerDueAt = 0;
    if (continuityRunning) return;
    continuityRunning = true;
    let result;
    try {
      result = await runCatalogLinkContinuityPass();
    } finally {
      continuityRunning = false;
    }
    if (result?.pendingRetryCount > 0 && result.nextRetryDelayMs !== null) {
      queueContinuity(result.nextRetryDelayMs);
    }
  }, delay);
}

export function installCatalogLinkContinuity() {
  if (observerInstalled || typeof document === 'undefined') return null;
  const start = () => {
    if (observerInstalled) return null;
    const deck = document.getElementById('listening-deck');
    if (!deck) return null;
    observerInstalled = true;
    queueContinuity(AUTO_LINK_INITIAL_DELAY_MS);

    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
          const cardStructureChanged = records.some((record) => Array.from(record.addedNodes || []).some((node) => (
            node?.nodeType === 1
            && (node.matches?.('.player-deck-card') || node.querySelector?.('.player-deck-card'))
          )));
          if (cardStructureChanged) queueContinuity(250);
        })
      : null;
    observer?.observe(deck, { childList: true, subtree: false });

    globalThis.addEventListener?.('online', () => queueContinuity(0));
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') queueContinuity(0);
    });
    return observer;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return null;
  }
  return start();
}

installCatalogLinkContinuity();
