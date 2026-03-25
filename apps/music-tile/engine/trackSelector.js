function scoreTrack(track, intent) {
  let score = 0;

  if (track.eraTags.includes(intent.era)) score += 40;
  if (track.emotionTags.includes(intent.emotion)) score += 24;
  if (track.energyTags.includes(intent.energyCurve)) score += 18;
  if (track.densityTags.includes(intent.density)) score += 14;

  const [minBpm, maxBpm] = intent.bpmRange;
  const inRange = track.approximateBpm >= minBpm && track.approximateBpm <= maxBpm;
  if (inRange) {
    score += 10;
  } else {
    const midpoint = (minBpm + maxBpm) / 2;
    const distance = Math.abs(track.approximateBpm - midpoint);
    score += Math.max(0, 8 - distance);
  }

  return score;
}

function applyEnergyOrdering(tracks, intent) {
  if (intent.energyCurve === 'flat') {
    return [...tracks].sort((a, b) => a.approximateBpm - b.approximateBpm);
  }

  if (intent.energyCurve === 'rising') {
    return [...tracks].sort((a, b) => a.approximateBpm - b.approximateBpm);
  }

  const ascending = [...tracks].sort((a, b) => a.approximateBpm - b.approximateBpm);
  if (ascending.length < 4) {
    return ascending;
  }

  const peakTrack = ascending[ascending.length - 1];
  const releaseTrack = ascending[ascending.length - 2];
  const body = ascending.slice(0, -2);
  return [...body, peakTrack, releaseTrack];
}

export function rankTracksForIntent(library, intent) {
  const ranked = library
    .map((track) => ({
      track,
      score: scoreTrack(track, intent)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.track.approximateBpm !== b.track.approximateBpm) return a.track.approximateBpm - b.track.approximateBpm;
      return a.track.title.localeCompare(b.track.title);
    });

  return ranked;
}

export function selectJourneyTracks(rankedTracks, intent, targetSize = 6) {
  const selected = rankedTracks.slice(0, targetSize).map((item) => item.track);
  return applyEnergyOrdering(selected, intent);
}
