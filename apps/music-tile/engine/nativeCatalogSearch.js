const MAX_QUERY_LENGTH = 160;

export function normalizeNativeCatalogQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

export async function requestNativeCatalogSearch(query, { fetchImpl = globalThis.fetch, limit = 5 } = {}) {
  const normalizedQuery = normalizeNativeCatalogQuery(query);
  if (!normalizedQuery) return { ok: false, error: 'Type a song, artist or musical direction.' };
  const response = await fetchImpl(`/api/music/catalog/search?q=${encodeURIComponent(normalizedQuery)}&limit=${Math.min(Math.max(Number(limit) || 5, 1), 10)}`);
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    return { ok: false, error: payload?.error || 'Music search is temporarily unavailable.', results: [] };
  }
  return payload;
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
    candidateVerificationStatus: provider === 'spotify' && result.spotifyUrl ? 'verified' : 'search-only',
    verificationStatus: provider === 'spotify' && result.spotifyUrl ? 'verified_spotify_track' : 'search_only',
    discoveryReason: `Found by native Music Search through ${String(result.providerLabel || provider || 'catalogue')}.`,
    traits: [],
    avoidTraits: [],
  };
}

export function findExistingCatalogTrack(list = [], result = {}) {
  const universalId = String(result.universalId || '').trim();
  const provider = String(result.provider || '').trim().toLowerCase();
  const providerItemId = String(result.providerItemId || '').trim();
  const normalizedIdentity = `${String(result.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}::${String(result.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  return (Array.isArray(list) ? list : []).find((track) => {
    if (universalId && String(track?.universalMusicId || track?.id || '') === universalId) return true;
    if (provider && providerItemId
      && String(track?.catalogProvider || '').toLowerCase() === provider
      && String(track?.catalogProviderItemId || '') === providerItemId) return true;
    const trackIdentity = `${String(track?.artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}::${String(track?.title || track?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    return normalizedIdentity !== '::' && trackIdentity === normalizedIdentity;
  }) || null;
}
