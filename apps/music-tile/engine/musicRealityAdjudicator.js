import { resolveSpotifyReference } from '../utils/spotifyEmbed.js';

export function adjudicateMusicReality(candidate = {}) {
  const spotify = resolveSpotifyReference(candidate.spotifyUrl || candidate.spotifyUri || '');
  const youtube = String(candidate.youtubeUrl || '');
  const isYoutubeTrack = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtube) && !youtube.includes('/results?');
  const hallucinated = candidate.verificationStatus === 'likely_hallucinated' || candidate.markedHallucinated;
  const playable = (spotify.valid && spotify.type === 'track') || isYoutubeTrack;
  const verificationStatus = hallucinated ? 'likely-hallucinated' : playable ? 'verified' : (candidate.spotifySearchQuery || candidate.youtubeSearchQuery ? 'search-only' : 'unverified');
  return { playable, canEmbedSpotify: spotify.valid && spotify.type === 'track', canOpenSpotify: spotify.valid && spotify.type === 'track', canOpenYouTube: isYoutubeTrack || Boolean(candidate.youtubeSearchQuery), verificationStatus, riskFlags: hallucinated ? ['hallucinated'] : (!playable ? ['unverified'] : []), displayWarning: !playable ? 'Needs verified Spotify/YouTube track URL.' : '' };
}
