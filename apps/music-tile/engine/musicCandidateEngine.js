import { TRACK_LIBRARY } from '../data/trackLibrary.js';
import { SEEDED_TASTE_TRACKS } from '../data/musicTasteSeeds.js';
import { installFreshJourneyController } from './freshJourneyController.js';

const AVOID_TAGS = [
  'too cheesy',
  'too Goa / psy',
  'too harsh',
  'too miserable / down',
  'boring',
  'flat',
  'wrong rock / industrial lane',
  'no ghost',
  'no lift',
  'no complexity',
];
const CAUTION_TERMS = [
  'emma hewitt',
  'susana',
  'ferry corsten',
  'root level',
  'vakhtang',
  'eyes',
  'blume',
  'clouds',
  'philomena',
  'tataki',
  'u2c',
  'australiens',
];
export const DEFAULT_DISCOVERY_RESULT_TARGET = 10;
export const MIN_DISCOVERY_RESULT_TARGET = 8;
const ALIASES = {
  anyma: ['anyma', 'afterlife', 'genesys'],
  sevdaliza: ['sevdaliza', 'save me', 'samsara'],
  'layla-benitez': ['layla', 'layla benitez'],
  'serious-trance-spine': [
    'push',
    'universal nation',
    'binary finary',
    '1999',
    'greece 2000',
    'three drives',
    'oakenfold',
    'cream',
    'courtyard',
  ],
  'y-do-i': ['y do i', 'ydoi'],
};

const BANKS = {
  anyma: [
    ['Anyma - Say Yes To Heaven remix', 'Anyma', ['dark club pressure', 'processed vocal', 'slow-build payoff', 'club engine']],
    ['Samsara', 'Anyma & Sevdaliza', ['Sevdaliza-coded', 'ghost engine', 'haunting female vocal', 'reverb vocal']],
    ['Welcome To The Opera', 'Anyma & Grimes', ['processed vocal', 'club engine', 'slow-build payoff']],
    ['Pictures Of You', 'Anyma', ['dark club pressure', 'complex riff']],
    ['Eternity', 'Anyma', ['Universal Nation spine', 'serious trance DNA']],
    ['Explore Your Future', 'Anyma', ['off-kilter rhythm', 'club engine']],
    ['Hypnotized', 'Anyma', ['ghost engine', 'echo vocal']],
  ],
  sevdaliza: [
    ['Save Me', 'Sevdaliza', ['haunting female vocal', 'processed vocal', 'Lana-coded']],
    ['Samsara', 'Sevdaliza', ['Sevdaliza-coded', 'ghost engine', 'dark club pressure']],
    ['Ghost Bloom', 'Diana Miro', ['haunting female vocal', 'reverb vocal']],
    ['Dark Cinema', 'Lana-coded branch', ['Lana-coded', 'echo vocal', 'processed vocal']],
  ],
  'layla-benitez': [
    ['Whispering Hearts', 'Layla Benitez', ['melodic/progressive club', 'club engine', 'slow-build payoff']],
    ['Feel Alive', 'Layla Benitez', ['melodic/progressive club', 'complex riff']],
    ['Pressure Line', 'Progressive branch', ['dark club pressure', 'club engine']],
  ],
  'serious-trance-spine': [
    ['Universal Nation', 'Push', ['serious trance DNA', 'Universal Nation spine', 'complex riff']],
    ['1999', 'Binary Finary', ['serious trance DNA', 'slow-build payoff']],
    ['Greece 2000', 'Three Drives', ['serious trance DNA', 'Universal Nation spine']],
    ['What It Feels Like For A Girl', 'Madonna, Above & Beyond', ['serious trance DNA', 'slow-build payoff']],
  ],
  'y-do-i': [
    ['Mirage Placeholder', 'Y do I', ['dark club pressure', 'processed vocal', 'off-kilter rhythm', 'ghost in the track']],
    ['Neon Ghost Placeholder', 'Y do I', ['ghost engine', 'reverb vocal', 'slow-build payoff']],
  ],
};

function slug(value = '') {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeArtistQuery(raw = '') {
  const query = String(raw || '').toLowerCase().trim();
  const hit = Object.entries(ALIASES).find(([, values]) => values.some((value) => query.includes(value)));
  return {
    raw,
    normalized: slug(query),
    lane: hit?.[0] || (query.includes('anyma') ? 'anyma' : ''),
    matchedAlias: hit?.[1]?.[0] || '',
    canonicalArtistName: hit?.[0] === 'y-do-i' ? 'Y do I' : '',
  };
}

function makeCandidate(title, artist, lane, sourceKind, traits = [], avoidTraits = []) {
  return {
    id: `${slug(artist)}-${slug(title)}`,
    title,
    artist,
    lane,
    sourceArtistMatch: lane,
    sourceKind,
    traits,
    avoidTraits,
    discoveryReason: `Matched ${lane} lane + ${traits.slice(0, 2).join(' + ')}.`,
    spotifyUrl: '',
    spotifyUri: '',
    youtubeUrl: '',
    searchQueries: [`${artist} ${title}`],
    noveltyKey: `${lane}:${slug(artist)}:${slug(title)}`,
  };
}

export function buildArtistAwareCandidates({
  artistInput = '',
  tasteDNA = {},
  includeSeen = false,
  recycleSeen = false,
  recentlyShownIds = [],
  sessionCounter = 0,
} = {}) {
  const query = normalizeArtistQuery(artistInput);
  const recent = new Set(recentlyShownIds || []);
  const lane = query.lane;
  const exact = (BANKS[lane] || []).map((row) => (
    makeCandidate(row[0], row[1], lane, 'exact-artist', row[2], [])
  ));
  const related = [...TRACK_LIBRARY, ...SEEDED_TASTE_TRACKS]
    .filter((track) => `${track.artist} ${track.title}`.toLowerCase().includes(
      (lane || query.normalized).split('-')[0] || 'zzz',
    ))
    .slice(0, 8)
    .map((track) => makeCandidate(
      track.title,
      track.artist,
      lane || 'generic-dark-melodic-techno',
      'related-style',
      track.traits || ['club engine'],
      track.rejectTags || [],
    ));
  const dnaTraits = Object.entries(tasteDNA)
    .filter(([, value]) => value?.polarity !== 'negative')
    .sort((left, right) => (right[1].weight || 0) - (left[1].weight || 0))
    .slice(0, 4)
    .map(([key]) => key);
  const taste = SEEDED_TASTE_TRACKS.slice(0, 8).map((track) => makeCandidate(
    track.title,
    track.artist,
    lane || 'generic-dark-melodic-techno',
    'taste-dna',
    dnaTraits,
    ['flat'],
  ));
  const interesting = SEEDED_TASTE_TRACKS.slice(8, 12).map((track) => makeCandidate(
    track.title,
    track.artist,
    lane || 'generic-dark-melodic-techno',
    'interesting-branch',
    ['off-kilter rhythm', 'complex riff'],
    [],
  ));
  const fallback = TRACK_LIBRARY.slice(0, 10).map((track) => makeCandidate(
    track.title,
    track.artist,
    'broad-fallback',
    'fallback',
    ['club engine'],
    ['flat'],
  ));

  const pools = exact.length
    ? [exact, related, taste, interesting, fallback]
    : (related.length ? [related, taste, interesting, fallback] : [taste, interesting, fallback]);
  const merged = [];
  const seen = new Set();
  for (const candidate of pools.flat()) {
    const text = `${candidate.artist} ${candidate.title}`.toLowerCase();
    if (CAUTION_TERMS.some((term) => text.includes(term))) {
      candidate.sourceKind = 'caution';
      candidate.avoidTraits = [...new Set([...candidate.avoidTraits, 'too cheesy'])];
      continue;
    }
    if (!seen.has(candidate.id)) {
      seen.add(candidate.id);
      merged.push(candidate);
    }
  }

  const rotated = merged.sort((left, right) => {
    const leftOrder = (
      sessionCounter + left.noveltyKey.length + query.normalized.length + (recent.has(left.id) ? 17 : 0)
    ) % 11;
    const rightOrder = (
      sessionCounter + right.noveltyKey.length + query.normalized.length + (recent.has(right.id) ? 17 : 0)
    ) % 11;
    return leftOrder - rightOrder;
  });
  const eligible = rotated.filter((candidate) => candidate.sourceKind !== 'caution');
  const unseen = eligible.filter((candidate) => includeSeen || !recent.has(candidate.id));
  const previouslyShown = includeSeen
    ? []
    : eligible.filter((candidate) => recent.has(candidate.id));
  const targetCount = Math.min(
    DEFAULT_DISCOVERY_RESULT_TARGET,
    Math.max(MIN_DISCOVERY_RESULT_TARGET, unseen.length),
  );
  let candidates = unseen.slice(0, targetCount);
  if (recycleSeen && candidates.length < MIN_DISCOVERY_RESULT_TARGET) {
    candidates = candidates
      .concat(previouslyShown.filter((candidate) => !candidates.some((row) => row.id === candidate.id)))
      .slice(0, targetCount);
  }
  const recycledCount = candidates.filter((candidate) => recent.has(candidate.id)).length;

  return {
    query,
    candidates,
    usedFallbackOnly: !exact.length && !related.length,
    sourceKinds: pools.map((pool) => pool[0]?.sourceKind).filter(Boolean),
    targetCount,
    minimumCount: MIN_DISCOVERY_RESULT_TARGET,
    unseenCandidateCount: unseen.length,
    previouslyShownCandidateCount: previouslyShown.length,
    recycledCount,
    noveltyExhausted: unseen.length === 0 && previouslyShown.length > 0,
    limitedByFilters: candidates.length < MIN_DISCOVERY_RESULT_TARGET,
  };
}

if (typeof globalThis.document !== 'undefined') {
  const schedule = typeof globalThis.queueMicrotask === 'function'
    ? globalThis.queueMicrotask.bind(globalThis)
    : (callback) => Promise.resolve().then(callback);
  schedule(() => installFreshJourneyController({ buildCandidates: buildArtistAwareCandidates }));
}

export { AVOID_TAGS };
