const POSITIVE_RATING_WEIGHT = 1.25;
const NEGATIVE_RATING_WEIGHT = 1.25;

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

export function extractTrackTraits(track = {}) {
  const traits = new Set();
  const sources = [
    ...(Array.isArray(track.positiveTags) ? track.positiveTags : []),
    ...(Array.isArray(track.negativeTags) ? track.negativeTags : []),
    track.reason,
    track.lane,
    track.title,
  ];
  for (const source of sources) {
    const token = normalizeToken(source);
    if (token) traits.add(token);
  }
  return Array.from(traits);
}

export function buildTasteWeights({ listeningDeck = [], ratings = {}, tags = {} } = {}) {
  const positiveWeights = {};
  const rejectWeights = {};

  listeningDeck.forEach((track) => {
    const id = String(track?.id || '');
    if (!id) return;
    const rating = Number(ratings[id] ?? 0);
    const traits = extractTrackTraits(track);
    if (rating > 0) {
      const delta = rating * POSITIVE_RATING_WEIGHT;
      traits.forEach((trait) => {
        positiveWeights[trait] = Number(((positiveWeights[trait] || 0) + delta).toFixed(2));
      });
    }
    if (rating < 0) {
      const delta = Math.abs(rating) * NEGATIVE_RATING_WEIGHT;
      traits.forEach((trait) => {
        rejectWeights[trait] = Number(((rejectWeights[trait] || 0) + delta).toFixed(2));
      });
    }

    (tags[id] || []).forEach((tag) => {
      const normalizedTag = normalizeToken(tag);
      if (!normalizedTag) return;
      if (normalizedTag.startsWith('too ') || ['boring', 'flat', 'too weird', 'no ghost', 'no lift', 'no complexity', 'wrong vocal', 'too harsh', 'too cheesy', 'too goa / psy'].includes(normalizedTag)) {
        rejectWeights[normalizedTag] = Number(((rejectWeights[normalizedTag] || 0) + 3).toFixed(2));
        return;
      }
      positiveWeights[normalizedTag] = Number(((positiveWeights[normalizedTag] || 0) + 3).toFixed(2));
    });
  });

  return { positiveWeights, rejectWeights };
}

export function scoreCandidateFromTaste(candidate, tasteWeights) {
  const traits = extractTrackTraits(candidate);
  let positiveScore = 0;
  let rejectScore = 0;
  const positiveHits = [];
  const rejectHits = [];
  traits.forEach((trait) => {
    const p = tasteWeights.positiveWeights[trait] || 0;
    const n = tasteWeights.rejectWeights[trait] || 0;
    if (p > 0) {
      positiveScore += p;
      positiveHits.push(`${trait} (+${p.toFixed(2)})`);
    }
    if (n > 0) {
      rejectScore += n;
      rejectHits.push(`${trait} (-${n.toFixed(2)})`);
    }
  });

  return {
    score: Number((positiveScore - rejectScore).toFixed(2)),
    positiveHits,
    rejectHits,
  };
}

export function rankCandidatesByTaste(candidates = [], tasteWeights) {
  return [...candidates]
    .map((track) => {
      const breakdown = scoreCandidateFromTaste(track, tasteWeights);
      return { ...track, tasteScore: breakdown.score, why: breakdown };
    })
    .sort((a, b) => b.tasteScore - a.tasteScore || String(a.title).localeCompare(String(b.title)));
}

export function topSignals(weights = {}, limit = 5) {
  return Object.entries(weights)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}
