import { TRACK_LIBRARY } from '../data/trackLibrary.js';
import { SEEDED_TASTE_TRACKS } from '../data/musicTasteSeeds.js';

const AVOID_TAGS = ['too cheesy','too Goa / psy','too harsh','too miserable / down','boring','flat','wrong rock / industrial lane','no ghost','no lift','no complexity'];
const CAUTION_TERMS = ['emma hewitt','susana','ferry corsten','root level','vakhtang','eyes','blume','clouds','philomena','tataki','u2c','australiens'];
export const DEFAULT_DISCOVERY_RESULT_TARGET = 10;
export const MIN_DISCOVERY_RESULT_TARGET = 8;
const ALIASES = {
  anyma: ['anyma', 'afterlife', 'genesys'],
  sevdaliza: ['sevdaliza', 'save me', 'samsara'],
  'layla-benitez': ['layla', 'layla benitez'],
  'serious-trance-spine': ['push','universal nation','binary finary','1999','greece 2000','three drives','oakenfold','cream','courtyard'],
  'y-do-i': ['y do i', 'ydoi']
};

const BANKS = {
  anyma: [
    ['Anyma - Say Yes To Heaven remix','Anyma',['dark club pressure','processed vocal','slow-build payoff','club engine']],
    ['Samsara','Anyma & Sevdaliza',['Sevdaliza-coded','ghost engine','haunting female vocal','reverb vocal']],
    ['Welcome To The Opera','Anyma & Grimes',['processed vocal','club engine','slow-build payoff']],
    ['Pictures Of You','Anyma',['dark club pressure','complex riff']],
    ['Eternity','Anyma',['Universal Nation spine','serious trance DNA']],
    ['Explore Your Future','Anyma',['off-kilter rhythm','club engine']],
    ['Hypnotized','Anyma',['ghost engine','echo vocal']]
  ],
  sevdaliza: [
    ['Save Me','Sevdaliza',['haunting female vocal','processed vocal','Lana-coded']],
    ['Samsara','Sevdaliza',['Sevdaliza-coded','ghost engine','dark club pressure']],
    ['Ghost Bloom','Diana Miro',['haunting female vocal','reverb vocal']],
    ['Dark Cinema','Lana-coded branch',['Lana-coded','echo vocal','processed vocal']]
  ],
  'layla-benitez': [
    ['Whispering Hearts','Layla Benitez',['melodic/progressive club','club engine','slow-build payoff']],
    ['Feel Alive','Layla Benitez',['melodic/progressive club','complex riff']],
    ['Pressure Line','Progressive branch',['dark club pressure','club engine']]
  ],
  'serious-trance-spine': [
    ['Universal Nation','Push',['serious trance DNA','Universal Nation spine','complex riff']],
    ['1999','Binary Finary',['serious trance DNA','slow-build payoff']],
    ['Greece 2000','Three Drives',['serious trance DNA','Universal Nation spine']],
    ['What It Feels Like For A Girl','Madonna, Above & Beyond',['serious trance DNA','slow-build payoff']]
  ],
  'y-do-i': [
    ['Mirage Placeholder','Y do I',['dark club pressure','processed vocal','off-kilter rhythm','ghost in the track']],
    ['Neon Ghost Placeholder','Y do I',['ghost engine','reverb vocal','slow-build payoff']]
  ]
};

function slug(s=''){return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
export function normalizeArtistQuery(raw=''){
  const q=String(raw||'').toLowerCase().trim();
  const hit = Object.entries(ALIASES).find(([,vals])=>vals.some((v)=>q.includes(v)));
  return {raw, normalized: slug(q), lane: hit?.[0] || (q.includes('anyma')?'anyma':''), matchedAlias: hit?.[1]?.[0] || '', canonicalArtistName: hit?.[0] === 'y-do-i' ? 'Y do I' : ''};
}

function mkCandidate(title, artist, lane, sourceKind, traits=[], avoidTraits=[]){
  return { id: `${slug(artist)}-${slug(title)}`, title, artist, lane, sourceArtistMatch: lane, sourceKind, traits, avoidTraits, discoveryReason: `Matched ${lane} lane + ${traits.slice(0,2).join(' + ')}.`, spotifyUrl:'', spotifyUri:'', youtubeUrl:'', searchQueries:[`${artist} ${title}`], noveltyKey:`${lane}:${slug(artist)}:${slug(title)}` };
}

export function buildArtistAwareCandidates({artistInput='', tasteDNA={}, includeSeen=false, recentlyShownIds=[], sessionCounter=0}={}){
  const query = normalizeArtistQuery(artistInput);
  const recent = new Set(recentlyShownIds || []);
  const lane = query.lane;
  const exact = (BANKS[lane] || []).map((row)=>mkCandidate(row[0],row[1],lane,'exact-artist',row[2],[]));
  const related = [...TRACK_LIBRARY, ...SEEDED_TASTE_TRACKS]
    .filter((t)=>`${t.artist} ${t.title}`.toLowerCase().includes((lane||query.normalized).split('-')[0]||'zzz'))
    .slice(0,8)
    .map((t)=>mkCandidate(t.title,t.artist,lane||'generic-dark-melodic-techno','related-style',t.traits||['club engine'],t.rejectTags||[]));
  const dnaTraits = Object.entries(tasteDNA).filter(([,v])=>v?.polarity!=='negative').sort((a,b)=>(b[1].weight||0)-(a[1].weight||0)).slice(0,4).map(([k])=>k);
  const taste = SEEDED_TASTE_TRACKS.slice(0,8).map((t)=>mkCandidate(t.title,t.artist,lane||'generic-dark-melodic-techno','taste-dna',dnaTraits,['flat']));
  const interesting = SEEDED_TASTE_TRACKS.slice(8,12).map((t)=>mkCandidate(t.title,t.artist,lane||'generic-dark-melodic-techno','interesting-branch',['off-kilter rhythm','complex riff'],[]));
  const fallback = TRACK_LIBRARY.slice(0,10).map((t)=>mkCandidate(t.title,t.artist,'broad-fallback','fallback',['club engine'],['flat']));

  const pools = exact.length ? [exact, related, taste, interesting, fallback] : (related.length ? [related, taste, interesting, fallback] : [taste, interesting, fallback]);
  const merged=[]; const seen=new Set();
  pools.flat().forEach((c)=>{ const text=`${c.artist} ${c.title}`.toLowerCase(); if (CAUTION_TERMS.some((t)=>text.includes(t))) { c.sourceKind='caution'; c.avoidTraits=[...new Set([...c.avoidTraits,'too cheesy'])]; return; } if (!seen.has(c.id)){seen.add(c.id); merged.push(c);} });
  const rotated = merged.sort((a,b)=>{
    const ah = ((sessionCounter + a.noveltyKey.length + query.normalized.length + (recent.has(a.id)?17:0)) % 11);
    const bh = ((sessionCounter + b.noveltyKey.length + query.normalized.length + (recent.has(b.id)?17:0)) % 11);
    return ah - bh;
  });
  const filtered = rotated.filter((c)=>includeSeen || !recent.has(c.id)).filter((c)=>c.sourceKind!=='caution');
  const topUps = includeSeen ? [] : rotated.filter((c)=>!filtered.some((f)=>f.id===c.id)).filter((c)=>c.sourceKind!=='caution');
  const targetCount = Math.min(DEFAULT_DISCOVERY_RESULT_TARGET, Math.max(MIN_DISCOVERY_RESULT_TARGET, filtered.length));
  const candidates = filtered.length >= MIN_DISCOVERY_RESULT_TARGET ? filtered.slice(0, targetCount) : filtered.concat(topUps).slice(0, targetCount);
  return { query, candidates, usedFallbackOnly: !exact.length && !related.length, sourceKinds: pools.map((p)=>p[0]?.sourceKind).filter(Boolean), targetCount, minimumCount: MIN_DISCOVERY_RESULT_TARGET, limitedByFilters: candidates.length < MIN_DISCOVERY_RESULT_TARGET };
}

export { AVOID_TAGS };
