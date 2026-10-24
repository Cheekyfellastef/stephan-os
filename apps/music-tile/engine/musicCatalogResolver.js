import { buildSpotifySearchUrl, buildYouTubeSearchUrl, resolveSpotifyReference } from '../utils/spotifyEmbed.js';
import { canonicalYouTubeWatchUrl } from './automaticMediaOverlay.js';
import { AI_CANDIDATE_STATUSES } from './candidateVerification.js';

export async function resolveMusicCandidate(candidate = {}) {
  const title = String(candidate.title || '').trim();
  const artist = String(candidate.artist || '').trim();
  const spotifyQuery = candidate.spotifySearchQuery || `${artist} ${title}`.trim();
  const youtubeQuery = candidate.youtubeSearchQuery || `${artist} ${title}`.trim();
  const spotifyRef = resolveSpotifyReference(candidate.spotifyUrl || candidate.spotifyUri || '');
  const verifiedSpotify = spotifyRef.valid && spotifyRef.type === 'track';
  // A YouTube search/results URL is never an exact verified recording link.
  const youtubeUrl = canonicalYouTubeWatchUrl(candidate.youtubeUrl || '');
  const verifiedYouTube = Boolean(youtubeUrl);
  const explicitStatus = String(candidate.candidateVerificationStatus || '').trim();
  const notFound = explicitStatus === AI_CANDIDATE_STATUSES.notFound;
  const hallucinated = Boolean(candidate.markedHallucinated)
    || explicitStatus === AI_CANDIDATE_STATUSES.likelyHallucinated;
  let verificationStatus = 'unresolved';
  if (verifiedSpotify) verificationStatus = 'verified_spotify_track';
  else if (verifiedYouTube) verificationStatus = 'verified_youtube_url';
  else if (spotifyQuery || youtubeQuery) verificationStatus = candidate.aiSuggested ? 'search_only' : 'needs_user_confirmation';
  if (notFound) verificationStatus = 'not_found';
  if (hallucinated) verificationStatus = 'likely_hallucinated';
  return {
    id: candidate.id || `${artist}:${title}`.toLowerCase(),
    title, artist,
    sourceKind: candidate.sourceKind || (candidate.aiSuggested ? 'ai' : 'local'),
    aiSuggested: candidate.aiSuggested === true,
    markedHallucinated: hallucinated,
    candidateVerificationStatus: explicitStatus || (candidate.aiSuggested ? AI_CANDIDATE_STATUSES.unverified : ''),
    verificationStatus,
    spotifyUrl: verifiedSpotify ? spotifyRef.openUrl : '',
    spotifyUri: verifiedSpotify ? spotifyRef.uri : '',
    youtubeUrl: verifiedYouTube ? youtubeUrl : '',
    // Carry the existing exact-match catalogue evidence through the read-only
    // Discovery pipeline rather than silently discarding its provenance.
    catalogProvider: String(candidate.catalogProvider || ''),
    catalogProviderItemId: String(candidate.catalogProviderItemId || ''),
    catalogLinkSource: String(candidate.catalogLinkSource || ''),
    catalogVerificationStatus: String(candidate.catalogVerificationStatus || ''),
    artworkUrl: String(candidate.artworkUrl || ''),
    spotifySearchQuery: spotifyQuery,
    youtubeSearchQuery: youtubeQuery,
    resolverNotes: notFound || hallucinated
      ? 'Rejected candidate: not eligible for verified playback.'
      : (verifiedSpotify || verifiedYouTube ? 'Exact media URL found; browser playback unverified.' : 'No catalog API verification. Returned search leads only.'),
    confidence: notFound || hallucinated ? 0 : (verifiedSpotify || verifiedYouTube ? 0.98 : 0.45),
    needsUserConfirmation: notFound || hallucinated || !(verifiedSpotify || verifiedYouTube),
    spotifySearchUrl: buildSpotifySearchUrl({ artist, title }),
    youtubeSearchUrl: buildYouTubeSearchUrl({ artist, title }),
  };
}
