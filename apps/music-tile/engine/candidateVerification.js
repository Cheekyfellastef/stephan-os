import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

export const AI_CANDIDATE_STATUSES = Object.freeze({
  verified: 'verified',
  userConfirmed: 'user-confirmed',
  unverified: 'unverified',
  searchOnly: 'search-only',
  notFound: 'not-found',
  likelyHallucinated: 'likely-hallucinated',
});

const KNOWN_STATUSES = new Set(Object.values(AI_CANDIDATE_STATUSES));

export function getCandidateVerificationStatus(track = {}) {
  const safeTrack = track && typeof track === 'object' ? track : {};
  try {
    const status = String(safeTrack.candidateVerificationStatus || '').trim();
    if (KNOWN_STATUSES.has(status)) return status;

    const spotify = resolveSpotifyReference(safeTrack.spotifyUrl || safeTrack.spotifyUri || '');
    if (spotify.valid && spotify.type === 'track') {
      return safeTrack.aiSuggested ? AI_CANDIDATE_STATUSES.userConfirmed : AI_CANDIDATE_STATUSES.verified;
    }
    if (safeTrack.aiSuggested) return AI_CANDIDATE_STATUSES.unverified;
    return AI_CANDIDATE_STATUSES.searchOnly;
  } catch {
    return AI_CANDIDATE_STATUSES.unverified;
  }
}

export function isVerifiedCandidateTrack(track = {}) {
  const status = getCandidateVerificationStatus(track);
  return status === AI_CANDIDATE_STATUSES.verified || status === AI_CANDIDATE_STATUSES.userConfirmed;
}

/**
 * Provider-verified Spotify identity is allowed independently of where the song
 * originally entered the Listening Room. The original card remains a journey
 * candidate after native catalogue enrichment, so sourceKind alone is insufficient.
 * This proves an exact Spotify recording identity, not browser playback.
 */
export function hasVerifiedCatalogSpotifyTrack(track = {}) {
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  return Boolean(
    spotify.valid
    && spotify.type === 'track'
    && /^[A-Za-z0-9]{22}$/.test(String(spotify.id || ''))
    && String(track.catalogProvider || '').toLowerCase() === 'spotify'
    && String(track.catalogProviderItemId || '') === spotify.id
    && track.catalogVerificationStatus === 'metadata_verified'
    && track.catalogLinkSource === 'native-catalog-search'
  );
}
