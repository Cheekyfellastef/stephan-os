import { applyCatalogEnrichmentToBrowser } from './nativeCatalogAutoApply.js';
import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

const MAX_QUERY_LENGTH = 160;
export const DEFAULT_PROVIDER_ATTEMPT_TIMEOUT_MS = 8000;
export const DEFAULT_BROWSER_TIMEOUT_MS = (DEFAULT_PROVIDER_ATTEMPT_TIMEOUT_MS * 2) + 2000;

function normalizedIdentity(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function catalogIdentityMatches(existing = {}, result = {}) {
  const universalId = String(result.universalId || '').trim();
  if (universalId && String(existing.universalMusicId || existing.id || '') === universalId) return true;

  const provider = String(result.provider || '').trim().toLowerCase();
  const providerItemId = String(result.providerItemId || '').trim();
  if (provider && providerItemId
    && String(existing.catalogProvider || '').toLowerCase() === provider
    && String(existing.catalogProviderItemId || '') === providerItemId) return true;

  const resultIdentity = `${normalizedIdentity(result.artist)}::${normalizedIdentity(result.title)}`;
  const existingIdentity = `${normalizedIdentity(existing.artist)}::${normalizedIdentity(existing.title || existing.name)}`;
  return resultIdentity !== '::' && existingIdentity === resultIdentity;
}

export function normalizeNativeCatalogQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

export function catalogResultActionKey(result = {}) {
  const provider = String(result.provider || 'unknown').trim().toLowerCase();
  const providerItemId = String(result.providerItemId || result.universalId || '').trim();
  return `${provider}:${providerItemId}`;
}

export async function requestNativeCatalogSearch(query, { fetchImpl = globalThis.fetch, limit = 5, timeoutMs = DEFAULT_BROWSER_TIMEOUT_MS, signal } = {}) {
  const normalizedQuery = normalizeNativeCatalogQuery(query);
  if (!normalizedQuery) return { ok: false, error: 'Type a song, artist or musical direction.' };
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('Music search timed out'), { code: 'catalog_search_timeout' }));
    }, Math.max(1, Number(timeoutMs || DEFAULT_BROWSER_TIMEOUT_MS)));
  });
  try {
    const url = `/api/music/catalog/search?q=${encodeURIComponent(normalizedQuery)}&limit=${Math.min(Math.max(Number(limit) || 5, 1), 10)}`;
    const response = await Promise.race([fetchImpl(url, { signal: controller.signal }), deadline]);
    const payload = await Promise.race([response.json(), deadline]);
    if (!response.ok || !payload?.ok) {
      return { ok: false, error: payload?.error || 'Music search is temporarily unavailable.', results: [] };
    }
    return payload;
  } catch (error) {
    if (error?.code === 'catalog_search_timeout' || error?.name === 'AbortError') {
      return { ok: false, error: 'Music search timed out. Please try again.', results: [] };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abortFromCaller);
  }
}

export function catalogResultToMusicTileTrack(result = {}) {
  const provider = String(result.provider || 'unknown').trim().toLowerCase();
  const providerItemId = String(result.providerItemId || '').trim();
  const title = String(result.title || '').trim();
  const artist = String(result.artist || 'Unknown Artist').trim() || 'Unknown Artist';
  const universalId = String(result.universalId || `${provider}:track:${providerItemId}`).trim();
  return {
    id: universalId,
    universalMusicId: universalId,
    title,
    artist,
    album: String(result.album || ''),
    lane: 'native-catalog-search',
    sourceKind: 'native-catalog',
    catalogProvider: provider,
    catalogProviderLabel: String(result.providerLabel || provider || 'Unknown'),
    catalogProviderItemId: providerItemId,
    catalogProviderUrl: String(result.providerUrl || ''),
    catalogConfidence: String(result.confidence || 'unknown'),
    catalogVerificationStatus: String(result.verificationStatus || 'unknown'),
    catalogPlaybackAvailability: String(result.playbackAvailability || 'unavailable'),
    spotifyUrl: String(result.spotifyUrl || ''),
    spotifyUri: String(result.spotifyUri || ''),
    spotifySearchUrl: String(result.spotifySearchUrl || ''),
    candidateVerificationStatus: 'search-only',
    verificationStatus: 'catalogue_identity_only',
    discoveryReason: `Found by native Music Search through ${String(result.providerLabel || provider || 'catalogue')}.`,
    traits: [],
    avoidTraits: [],
  };
}

export function planCatalogResultEnrichment(existing, result = {}) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return { ok: false, changed: false, reason: 'existing-track-required' };
  }
  if (!catalogIdentityMatches(existing, result)) {
    return { ok: false, changed: false, reason: 'catalogue-identity-mismatch' };
  }

  const catalogTrack = catalogResultToMusicTileTrack(result);
  if (catalogTrack.catalogVerificationStatus !== 'metadata_verified') {
    return { ok: false, changed: false, reason: 'catalogue-metadata-not-verified' };
  }

  const incomingSpotify = resolveSpotifyReference(catalogTrack.spotifyUrl || catalogTrack.spotifyUri || '');
  if (!incomingSpotify.valid || incomingSpotify.type !== 'track') {
    return { ok: false, changed: false, reason: 'spotify-track-unavailable' };
  }

  const currentSpotify = resolveSpotifyReference(existing.spotifyUrl || existing.spotifyUri || '');
  if (currentSpotify.valid && currentSpotify.type === 'track' && currentSpotify.uri !== incomingSpotify.uri) {
    return { ok: false, changed: false, reason: 'spotify-track-conflict' };
  }

  const enrichment = Object.freeze({
    spotifyUrl: incomingSpotify.openUrl,
    spotifyUri: incomingSpotify.uri,
    catalogProvider: catalogTrack.catalogProvider,
    catalogProviderLabel: catalogTrack.catalogProviderLabel,
    catalogProviderItemId: catalogTrack.catalogProviderItemId,
    catalogProviderUrl: catalogTrack.catalogProviderUrl,
    catalogConfidence: catalogTrack.catalogConfidence,
    catalogVerificationStatus: catalogTrack.catalogVerificationStatus,
    catalogPlaybackAvailability: catalogTrack.catalogPlaybackAvailability,
    catalogLinkSource: 'native-catalog-search',
  });
  const changed = Object.entries(enrichment)
    .some(([key, value]) => String(existing[key] ?? '') !== String(value ?? ''));
  return { ok: true, changed, spotify: incomingSpotify, enrichment };
}

export function mergeCatalogResultIntoExistingTrack(existing, result = {}) {
  const planned = planCatalogResultEnrichment(existing, result);
  if (!planned.ok || !planned.changed) return { ...planned, track: existing || null };
  Object.assign(existing, planned.enrichment);
  return { ...planned, track: existing };
}

export function findExistingCatalogTrack(list = [], result = {}) {
  const existing = (Array.isArray(list) ? list : []).find((track) => catalogIdentityMatches(track, result)) || null;
  if (!existing) return null;

  const planned = planCatalogResultEnrichment(existing, result);
  if (planned.ok && planned.changed) {
    const browserResult = applyCatalogEnrichmentToBrowser({
      trackId: String(existing.id || ''),
      artist: String(existing.artist || ''),
      title: String(existing.title || existing.name || ''),
      spotifyUrl: planned.spotify.openUrl,
      spotifyUri: planned.spotify.uri,
      enrichment: planned.enrichment,
    });
    if (browserResult.ok) Object.assign(existing, planned.enrichment);
  }
  return existing;
}
