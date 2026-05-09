import { buildSpotifySearchUrl, buildYouTubeSearchUrl, resolveSpotifyReference } from '../utils/spotifyEmbed.js';

export async function resolveMusicCandidate(candidate = {}) {
  const title = String(candidate.title || '').trim();
  const artist = String(candidate.artist || '').trim();
  const spotifyQuery = candidate.spotifySearchQuery || `${artist} ${title}`.trim();
  const youtubeQuery = candidate.youtubeSearchQuery || `${artist} ${title}`.trim();
  const spotifyRef = resolveSpotifyReference(candidate.spotifyUrl || candidate.spotifyUri || '');
  const verifiedSpotify = spotifyRef.valid && spotifyRef.type === 'track';
  const verifiedYouTube = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(String(candidate.youtubeUrl || ''));
  let verificationStatus = 'unresolved';
  if (verifiedSpotify) verificationStatus = 'verified_spotify_track';
  else if (verifiedYouTube) verificationStatus = 'verified_youtube_url';
  else if (spotifyQuery || youtubeQuery) verificationStatus = candidate.aiSuggested ? 'search_only' : 'needs_user_confirmation';
  if (candidate.markedHallucinated) verificationStatus = 'likely_hallucinated';
  return {
    id: candidate.id || `${artist}:${title}`.toLowerCase(), title, artist, sourceKind: candidate.sourceKind || (candidate.aiSuggested ? 'ai' : 'local'), verificationStatus,
    spotifyUrl: verifiedSpotify ? spotifyRef.openUrl : '', spotifyUri: verifiedSpotify ? spotifyRef.uri : '', youtubeUrl: verifiedYouTube ? candidate.youtubeUrl : '',
    spotifySearchQuery: spotifyQuery, youtubeSearchQuery: youtubeQuery,
    resolverNotes: verifiedSpotify || verifiedYouTube ? 'Verified by direct URL.' : 'No catalog API verification. Returned search leads only.',
    confidence: verifiedSpotify || verifiedYouTube ? 0.98 : 0.45, needsUserConfirmation: !(verifiedSpotify || verifiedYouTube),
    spotifySearchUrl: buildSpotifySearchUrl({ artist, title }), youtubeSearchUrl: buildYouTubeSearchUrl({ artist, title }),
  };
}
