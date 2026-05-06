import { SEEDED_TASTE_TRACKS } from './musicTasteSeeds.js';

export const MUSIC_TASTE_TARGET = 'Dark Courtyard / Ghost Vocal / Serious Trance DNA';
export const MUSIC_TASTE_LEARNING_LINE = 'Learning: serious hypnotic trance architecture + echo-heavy ghost vocals + dark club pressure.';

export function buildMusicTasteCockpitSummary(tracks = SEEDED_TASTE_TRACKS) {
  const safeTracks = Array.isArray(tracks) ? tracks : [];
  const counts = {
    likedGoodFantastic: 0,
    interesting: 0,
    nearly: 0,
    rejects: 0,
  };

  for (const track of safeTracks) {
    const signal = String(track?.signal || '').trim().toLowerCase();
    if (signal === 'liked' || signal === 'good' || signal === 'fantastic') counts.likedGoodFantastic += 1;
    else if (signal === 'interesting') counts.interesting += 1;
    else if (signal === 'nearly' || signal === 'almost') counts.nearly += 1;
    else if (signal === 'reject' || signal === 'rejected') counts.rejects += 1;
  }

  const strongestAnchor = safeTracks.find((track) => String(track?.signal || '').trim().toLowerCase() === 'fantastic')
    || safeTracks.find((track) => String(track?.signal || '').trim().toLowerCase() === 'liked')
    || safeTracks[0]
    || null;

  const anchorLabel = strongestAnchor
    ? `${strongestAnchor.title} ${String(strongestAnchor.signal || '').trim()}`.trim()
    : 'Universal Nation spine';

  return {
    title: 'Spotify-first Taste Cockpit',
    target: MUSIC_TASTE_TARGET,
    counts,
    strongestAnchor: anchorLabel,
    strongestAnchorHint: 'Universal Nation spine',
    playbackStance: 'Spotify canonical · YouTube discovery/fallback',
    learningLine: MUSIC_TASTE_LEARNING_LINE,
  };
}

export function buildMusicLandingSummaryLines(summary = buildMusicTasteCockpitSummary()) {
  return [
    summary.title,
    `Target: ${summary.target}`,
    `Anchors L/G/F ${summary.counts.likedGoodFantastic} · Interesting ${summary.counts.interesting} · Nearly ${summary.counts.nearly} · Rejects ${summary.counts.rejects}`,
    `Anchor: ${summary.strongestAnchor} (${summary.strongestAnchorHint})`,
    summary.playbackStance,
    summary.learningLine,
  ];
}
