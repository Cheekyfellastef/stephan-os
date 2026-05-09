const ARTIST_SEEDS = [
  {
    canonicalName: 'Anyma',
    aliases: ['anyma'],
    lanes: ['Afterlife', 'melodic techno', 'dark club pressure'],
    knownTracks: ['Samsara', 'Welcome To The Opera', 'Pictures Of You', 'Eternity', 'Hypnotized', 'Say Yes To Heaven remix'],
    relatedArtists: ['Sevdaliza', 'Grimes', 'Argy', 'Tale Of Us', 'MRAK', 'Anyma-style'],
    tasteRole: 'anchor',
    cautionNotes: [],
    defaultSearchQueries: ['Anyma Sevdaliza Samsara', 'Anyma melodic techno haunting female vocal', 'Afterlife melodic techno echo vocal'],
  },
  {
    canonicalName: 'Sevdaliza',
    aliases: ['sevdaliza'],
    lanes: ['ghost vocal', 'processed vocal', 'dark electronic', 'haunting female vocal'],
    knownTracks: ['Save Me'],
    relatedArtists: ['Anyma', 'Diana Miro-style vocal mystery', 'Lana-coded dark vocal'],
    tasteRole: 'anchor',
    cautionNotes: [],
    defaultSearchQueries: ['Sevdaliza Save Me', 'Sevdaliza ghost vocal dark electronic'],
  },
  {
    canonicalName: 'Layla Benitez', aliases: ['layla benitez'], lanes: ['melodic/progressive club pressure', 'DJ discovery lane'], knownTracks: [], relatedArtists: ['Anyma'], tasteRole: 'branch', cautionNotes: [], defaultSearchQueries: ['Layla Benitez melodic progressive set']
  },
  {
    canonicalName: 'Y do I', aliases: ['y do i', 'ydoi'], lanes: ['melodic techno', 'search-led discovery'], knownTracks: [], relatedArtists: [], tasteRole: 'known-limited', cautionNotes: ['Known artist with limited local bank'], defaultSearchQueries: ['Y do I melodic techno', 'Y do I Spotify', 'Y do I live set', 'Y do I track']
  },
];

const SERIOUS_TRANCE = {
  canonicalName: 'Serious trance spine', aliases: ['push', 'universal nation', 'binary finary', 'greece 2000', 'three drives', 'oakenfold', 'cream', 'courtyard'], lanes: ['serious trance architecture', 'old Courtyard lift', 'Universal Nation spine'], knownTracks: ['Universal Nation', '1999', 'Greece 2000'], relatedArtists: [], tasteRole: 'spine', cautionNotes: [], defaultSearchQueries: ['progressive trance Universal Nation dark club pressure']
};

const normalize = (v = '') => String(v).trim().toLowerCase();

export function resolveArtistIntelligence(input = '') {
  const artist = normalize(input);
  if (!artist) return { status: 'unresolved', artist: null };
  const seed = [...ARTIST_SEEDS, SERIOUS_TRANCE].find((p) => normalize(p.canonicalName) === artist || (p.aliases || []).some((a) => normalize(a) === artist));
  if (!seed) {
    return { status: 'unresolved', artist: { canonicalName: String(input).trim(), aliases: [artist], lanes: [], knownTracks: [], relatedArtists: [], tasteRole: 'unknown', cautionNotes: ['Unknown artist'], defaultSearchQueries: [`${String(input).trim()} Spotify`, `${String(input).trim()} YouTube`] } };
  }
  return { status: 'resolved', artist: seed };
}
