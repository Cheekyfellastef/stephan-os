/**
 * Music Tile Phase 1 notes:
 * - Track identity (id/title/artist/tags) is authoritative.
 * - Fixed YouTube URLs are brittle and may go stale when videos are removed or moved.
 * - Playback links are resolved dynamically from each track's youtube search metadata.
 */
export const TRACK_LIBRARY = [
  {
    id: 'oa-01',
    title: 'Southern Sun (Tiësto Remix)',
    artist: 'Paul Oakenfold',
    eraTags: ['cream-courtyard', 'uplifting-trance'],
    emotionTags: ['euphoric', 'transcendent'],
    energyTags: ['rising', 'peaks'],
    densityTags: ['layered', 'full-festival'],
    approximateBpm: 138,
    notes: 'Peak-era progressive trance lift with festival momentum.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Paul Oakenfold Southern Sun Tiesto Remix official audio',
      preferredVideoId: '',
      fallbackQuery: 'Paul Oakenfold Southern Sun Tiesto Remix'
    }
  },
  {
    id: 'bf-01',
    title: '1998',
    artist: 'Binary Finary',
    eraTags: ['cream-courtyard', 'uplifting-trance'],
    emotionTags: ['euphoric', 'transcendent'],
    energyTags: ['rising', 'peaks'],
    densityTags: ['layered', 'full-festival'],
    approximateBpm: 140,
    notes: 'Classic heritage anthem for high-energy emotional arcs.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Binary Finary 1998 original mix official audio',
      preferredVideoId: '',
      fallbackQuery: 'Binary Finary 1998'
    }
  },
  {
    id: 'ab-01',
    title: 'Sun & Moon',
    artist: 'Above & Beyond',
    eraTags: ['uplifting-trance', 'progressive-bridge'],
    emotionTags: ['reflective', 'euphoric'],
    energyTags: ['rising'],
    densityTags: ['layered'],
    approximateBpm: 128,
    notes: 'Vocal emotional bridge with clear trance lineage.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Above and Beyond Sun and Moon feat Richard Bedford official video',
      preferredVideoId: '',
      fallbackQuery: 'Above and Beyond Sun and Moon'
    }
  },
  {
    id: 'ab-02',
    title: 'Thing Called Love',
    artist: 'Above & Beyond',
    eraTags: ['uplifting-trance', 'progressive-bridge'],
    emotionTags: ['euphoric', 'reflective'],
    energyTags: ['rising'],
    densityTags: ['layered'],
    approximateBpm: 130,
    notes: 'Melodic progression that supports smooth transitions.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Above and Beyond Thing Called Love official video',
      preferredVideoId: '',
      fallbackQuery: 'Above and Beyond Thing Called Love'
    }
  },
  {
    id: 'avb-01',
    title: 'Communication',
    artist: 'Armin van Buuren',
    eraTags: ['cream-courtyard', 'uplifting-trance'],
    emotionTags: ['transcendent', 'dark'],
    energyTags: ['flat', 'rising'],
    densityTags: ['minimal', 'layered'],
    approximateBpm: 136,
    notes: 'Stripped early-trance framework for intentional build-outs.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Armin van Buuren Communication original mix official audio',
      preferredVideoId: '',
      fallbackQuery: 'Armin van Buuren Communication'
    }
  },
  {
    id: 'avb-02',
    title: 'This Is What It Feels Like',
    artist: 'Armin van Buuren',
    eraTags: ['progressive-bridge', 'afterlife-modern'],
    emotionTags: ['euphoric', 'reflective'],
    energyTags: ['rising'],
    densityTags: ['layered', 'full-festival'],
    approximateBpm: 130,
    notes: 'Modern crossover entry point with broad emotional readability.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Armin van Buuren This Is What It Feels Like official video',
      preferredVideoId: '',
      fallbackQuery: 'Armin van Buuren This Is What It Feels Like'
    }
  },
  {
    id: 'cg-01',
    title: 'Exploration of Space',
    artist: 'Cosmic Gate',
    eraTags: ['cream-courtyard', 'uplifting-trance'],
    emotionTags: ['dark', 'transcendent'],
    energyTags: ['peaks'],
    densityTags: ['full-festival'],
    approximateBpm: 140,
    notes: 'High-impact trance peak for aggressive energy curves.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Cosmic Gate Exploration of Space original mix official audio',
      preferredVideoId: '',
      fallbackQuery: 'Cosmic Gate Exploration of Space'
    }
  },
  {
    id: 'cg-02',
    title: 'Be Your Sound',
    artist: 'Cosmic Gate',
    eraTags: ['uplifting-trance', 'progressive-bridge'],
    emotionTags: ['euphoric', 'reflective'],
    energyTags: ['rising'],
    densityTags: ['layered'],
    approximateBpm: 132,
    notes: 'Melodic ramp useful for structured mid-journey movement.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Cosmic Gate Be Your Sound official video',
      preferredVideoId: '',
      fallbackQuery: 'Cosmic Gate Be Your Sound'
    }
  },
  {
    id: 'ep-01',
    title: 'Opus',
    artist: 'Eric Prydz',
    eraTags: ['progressive-bridge', 'afterlife-modern'],
    emotionTags: ['transcendent', 'reflective'],
    energyTags: ['rising', 'peaks'],
    densityTags: ['minimal', 'layered'],
    approximateBpm: 126,
    notes: 'Long progressive tension arc with cinematic release.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Eric Prydz Opus official audio',
      preferredVideoId: '',
      fallbackQuery: 'Eric Prydz Opus'
    }
  },
  {
    id: 'ep-02',
    title: 'Generate',
    artist: 'Eric Prydz',
    eraTags: ['progressive-bridge', 'afterlife-modern'],
    emotionTags: ['dark', 'transcendent'],
    energyTags: ['rising'],
    densityTags: ['layered', 'full-festival'],
    approximateBpm: 128,
    notes: 'Progressive drive with darker undertones.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Eric Prydz Generate official audio',
      preferredVideoId: '',
      fallbackQuery: 'Eric Prydz Generate'
    }
  },
  {
    id: 'to-01',
    title: 'Another Earth',
    artist: 'Tale Of Us',
    eraTags: ['afterlife-modern'],
    emotionTags: ['dark', 'reflective'],
    energyTags: ['flat', 'rising'],
    densityTags: ['minimal', 'layered'],
    approximateBpm: 124,
    notes: 'Cinematic minimal tension for modern mood reconstruction.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Tale Of Us Another Earth official audio',
      preferredVideoId: '',
      fallbackQuery: 'Tale Of Us Another Earth'
    }
  },
  {
    id: 'to-02',
    title: 'Nova',
    artist: 'Tale Of Us',
    eraTags: ['afterlife-modern', 'progressive-bridge'],
    emotionTags: ['transcendent', 'dark'],
    energyTags: ['rising'],
    densityTags: ['layered'],
    approximateBpm: 123,
    notes: 'Melodic-techno bridge with restrained drama.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Tale Of Us Nova official audio',
      preferredVideoId: '',
      fallbackQuery: 'Tale Of Us Nova'
    }
  },
  {
    id: 'artbat-01',
    title: 'Horizon',
    artist: 'ARTBAT',
    eraTags: ['afterlife-modern'],
    emotionTags: ['transcendent', 'euphoric'],
    energyTags: ['rising', 'peaks'],
    densityTags: ['layered', 'full-festival'],
    approximateBpm: 124,
    notes: 'Modern melodic-techno rise with big-room finish.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'ARTBAT Horizon official audio',
      preferredVideoId: '',
      fallbackQuery: 'ARTBAT Horizon'
    }
  },
  {
    id: 'artbat-02',
    title: 'Upperground',
    artist: 'ARTBAT',
    eraTags: ['afterlife-modern', 'progressive-bridge'],
    emotionTags: ['dark', 'transcendent'],
    energyTags: ['peaks'],
    densityTags: ['full-festival'],
    approximateBpm: 126,
    notes: 'Peak-modern pressure with dense rhythmic layering.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'ARTBAT Upperground official audio',
      preferredVideoId: '',
      fallbackQuery: 'ARTBAT Upperground'
    }
  },
  {
    id: 'cp-01',
    title: 'Cola',
    artist: 'CamelPhat & Elderbrook',
    eraTags: ['progressive-bridge', 'afterlife-modern'],
    emotionTags: ['reflective', 'dark'],
    energyTags: ['flat', 'rising'],
    densityTags: ['minimal', 'layered'],
    approximateBpm: 124,
    notes: 'Minimal vocal groove for low-density openings.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'CamelPhat Elderbrook Cola official video',
      preferredVideoId: '',
      fallbackQuery: 'CamelPhat Elderbrook Cola'
    }
  },
  {
    id: 'cp-02',
    title: 'Panic Room',
    artist: 'CamelPhat & AU/RA',
    eraTags: ['progressive-bridge', 'afterlife-modern'],
    emotionTags: ['dark', 'reflective'],
    energyTags: ['rising'],
    densityTags: ['layered'],
    approximateBpm: 124,
    notes: 'Dark progressive motif with measured emotional weight.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'CamelPhat AU RA Panic Room official video',
      preferredVideoId: '',
      fallbackQuery: 'CamelPhat AU RA Panic Room'
    }
  },
  {
    id: 'anyma-01',
    title: 'Eternity',
    artist: 'Anyma & Chris Avantgarde',
    eraTags: ['afterlife-modern'],
    emotionTags: ['transcendent', 'dark'],
    energyTags: ['rising', 'peaks'],
    densityTags: ['layered', 'full-festival'],
    approximateBpm: 125,
    notes: 'Afterlife-signature cinematic peak architecture.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Anyma Chris Avantgarde Eternity official visualizer',
      preferredVideoId: '',
      fallbackQuery: 'Anyma Chris Avantgarde Eternity'
    }
  },
  {
    id: 'anyma-02',
    title: 'Pictures Of You',
    artist: 'Anyma',
    eraTags: ['afterlife-modern'],
    emotionTags: ['reflective', 'transcendent'],
    energyTags: ['flat', 'rising'],
    densityTags: ['minimal', 'layered'],
    approximateBpm: 123,
    notes: 'Atmospheric entry for reflective modern sessions.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Anyma Pictures Of You official visualizer',
      preferredVideoId: '',
      fallbackQuery: 'Anyma Pictures Of You'
    }
  },
  {
    id: 'lb-01',
    title: 'Whispering Hearts',
    artist: 'Layla Benitez',
    eraTags: ['afterlife-modern', 'progressive-bridge'],
    emotionTags: ['reflective', 'dark'],
    energyTags: ['flat', 'rising'],
    densityTags: ['minimal', 'layered'],
    approximateBpm: 122,
    notes: 'Deep melodic journey support with restrained intensity.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Layla Benitez Whispering Hearts official audio',
      preferredVideoId: '',
      fallbackQuery: 'Layla Benitez Whispering Hearts'
    }
  },
  {
    id: 'lb-02',
    title: 'Feel Alive',
    artist: 'Layla Benitez',
    eraTags: ['afterlife-modern'],
    emotionTags: ['euphoric', 'transcendent'],
    energyTags: ['rising'],
    densityTags: ['layered'],
    approximateBpm: 123,
    notes: 'Clean modern uplift for hopeful closing segments.',
    youtube: {
      strategy: 'search-first',
      canonicalQuery: 'Layla Benitez Feel Alive official audio',
      preferredVideoId: '',
      fallbackQuery: 'Layla Benitez Feel Alive'
    }
  }
];
