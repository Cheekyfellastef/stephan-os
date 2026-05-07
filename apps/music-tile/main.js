import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { SEEDED_TASTE_TRACKS } from './data/musicTasteSeeds.js';
import { buildSpotifySearchUrl, buildYouTubeSearchUrl, parseSpotifyReference, toSpotifyEmbedUrl } from './utils/spotifyEmbed.js';
import { buildTasteWeights, rankCandidatesByTaste, topSignals } from './engine/tasteLearning.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const RATING_VALUES = [-2, -1, 0, 1, 2];
const POSITIVE_REASON_TAGS = ['reverb vocal','echo vocal','haunting female vocal','processed vocal','wide club pressure','emotional lift','serious trance DNA'];
const REJECT_REASON_TAGS = ['boring','flat','too cheesy','too harsh','too Goa / psy','no ghost'];
const ANYMA_SEEDED_CANDIDATES = [
  { id:'anyma-syth', title:'Say Yes To Heaven remix', artist:'Anyma', reason:'Anyma anchor match', lane:'Ghost Vocal / Reverb Female Voice' },
  { id:'anyma-samsara', title:'Samsara', artist:'Anyma & Sevdaliza', reason:'Sevdaliza ghost vocal branch', lane:'Ghost Vocal / Reverb Female Voice' },
  { id:'anyma-welcome-opera', title:'Welcome To The Opera', artist:'Anyma & Grimes', reason:'Dark melodic club pressure', lane:'Dark Courtyard / Serious Trance DNA' },
  { id:'anyma-pictures', title:'Pictures Of You', artist:'Anyma', reason:'Late-night Courtyard architecture', lane:'Dark Courtyard / Serious Trance DNA' },
  { id:'anyma-eternity', title:'Eternity', artist:'Anyma', reason:'Echo/reverb vocal candidate', lane:'Lana Ghost / Slow-Burn Club Lift' },
  { id:'anyma-explore', title:'Explore Your Future', artist:'Anyma', reason:'Interesting branch track', lane:'Interesting Complexity' },
  { id:'anyma-hypnotized', title:'Hypnotized', artist:'Anyma', reason:'Dark melodic club pressure', lane:'Club Engine But Missing Ghost' },
  { id:'sevdaliza-save-me', title:'Save Me', artist:'Sevdaliza', spotifyUrl:'https://open.spotify.com/track/2GQfQw0f9M8e8P3G2NL8eN', reason:'Sevdaliza ghost vocal branch', lane:'Ghost Vocal / Reverb Female Voice' },
  { id:'hunger-law', title:'Hunger & Law', artist:'Hunger & Law', reason:'Interesting branch track', lane:'Interesting Complexity' },
  { id:'pico-close-eyes', title:'Close Your Eyes', artist:'Pico Boulevard', reason:'Echo/reverb vocal candidate', lane:'Lana Ghost / Slow-Burn Club Lift' },
  { id:'push-universal', title:'Universal Nation', artist:'Push', spotifyUrl:'https://open.spotify.com/track/1lXzvA8rQwRz4t5Lwz4M8W', reason:'Universal Nation serious trance spine', lane:'Dark Courtyard / Serious Trance DNA' },
  { id:'binary-1999', title:'1999', artist:'Binary Finary', spotifyUri:'spotify:track:0R2evcrs4W4lR5vbhwA2Q4', reason:'Universal Nation serious trance spine', lane:'Dark Courtyard / Serious Trance DNA' },
  { id:'three-greece', title:'Greece 2000', artist:'Three Drives', reason:'Late-night Courtyard architecture', lane:'Dark Courtyard / Serious Trance DNA' },
];

const ui = {
  artistInput: document.getElementById('artist-input'),
  buildBtn: document.getElementById('build-journey-btn'),
  startBtn: document.getElementById('start-journey-btn'),
  resetBtn: document.getElementById('reset-btn'),
  status: document.getElementById('status-text'),
  positiveAnchors: document.getElementById('positive-anchors'),
  rejectPatterns: document.getElementById('reject-patterns'),
  ratingCounts: document.getElementById('rating-counts'),
  learningSignals: document.getElementById('learning-signals'),
  candidateList: document.getElementById('candidate-list'),
  listeningDeck: document.getElementById('listening-deck'),
};

const state = loadState();
renderAll();
wireEvents();

function wireEvents() {
  ui.buildBtn?.addEventListener('click', buildJourney);
  ui.startBtn?.addEventListener('click', startJourney);
  ui.resetBtn?.addEventListener('click', resetAll);
}

function buildJourney() {
  const artists = parseArtists(ui.artistInput?.value || '');
  if (!artists.length) {
    ui.status.textContent = 'Enter an artist to build a journey.';
    return;
  }
  const term = artists[0];
  ui.status.textContent = `Building journey for: ${term}`;
  state.candidates = rankCandidatesByTaste(buildSeededCandidates(term), buildTasteWeights(state));
  if (!state.listeningDeck.length && state.candidates.length) state.listeningDeck = [state.candidates[0]];
  ui.status.textContent = `Built ${state.candidates.length} candidates for ${term}.`;
  saveState();
  renderAll();
}

function startJourney() {
  const artists = parseArtists(ui.artistInput?.value || '');
  if (!artists.length) {
    ui.status.textContent = 'Enter an artist to build a journey.';
    return;
  }
  const term = artists[0];
  if (!state.candidates.length) state.candidates = rankCandidatesByTaste(buildSeededCandidates(term), buildTasteWeights(state));
  if (!state.listeningDeck.length) state.listeningDeck = state.candidates.slice(0, 3);
  ui.status.textContent = `Starting journey for: ${term}.`;
  saveState();
  renderAll();
}

function resetAll() {
  state.candidates = [];
  state.listeningDeck = [];
  state.ratings = {};
  state.tags = {};
  ui.status.textContent = 'Reset complete.';
  localStorage.removeItem(STORAGE_KEY);
  renderAll();
}

function renderAll() {
  renderTasteDNA();
  renderCandidates();
  renderListeningDeck();
}

function renderTasteDNA() {
  const positive = SEEDED_TASTE_TRACKS.filter((t) => ['fantastic', 'liked', 'good'].includes(t.signal));
  const reject = SEEDED_TASTE_TRACKS.filter((t) => ['reject', 'nearly'].includes(t.signal));
  ui.positiveAnchors.innerHTML = `<h3>Positive anchors</h3>${positive.slice(0, 8).map((t) => `<div class="card">${t.title} · <span class="meta">${t.artist}</span></div>`).join('')}`;
  ui.rejectPatterns.innerHTML = `<h3>Reject patterns</h3>${reject.slice(0, 6).map((t) => `<div class="card">${t.title} · <span class="meta">${t.artist}</span></div>`).join('')}`;

  const counts = RATING_VALUES.reduce((acc, val) => ({ ...acc, [val]: 0 }), {});
  for (const value of Object.values(state.ratings)) counts[value] = (counts[value] || 0) + 1;
  ui.ratingCounts.innerHTML = `<h3>Rating counts</h3><div class="card">${Object.entries(counts).map(([k,v]) => `<div>${k}: ${v}</div>`).join('')}</div>`;
  const weights = buildTasteWeights(state);
  const topPositive = topSignals(weights.positiveWeights);
  const topReject = topSignals(weights.rejectWeights);
  ui.learningSignals.innerHTML = `<h3>Taste Weights</h3><div class="card"><strong>Positive</strong>${topPositive.length ? topPositive.map(([k,v]) => `<div>${k}: +${v.toFixed(2)}</div>`).join('') : '<div>None yet</div>'}<strong>Reject</strong>${topReject.length ? topReject.map(([k,v]) => `<div>${k}: -${v.toFixed(2)}</div>`).join('') : '<div>None yet</div>'}</div>`;
}

function renderCandidates() {
  ui.candidateList.innerHTML = state.candidates.length
    ? state.candidates.map((track) => `<article class="card"><strong>${track.title || track.name || 'Unknown'}</strong><div class="meta">${track.artist || 'Unknown Artist'}</div><div class="meta">${track.reason || 'Taste profile candidate'} · ${track.lane || 'Unassigned lane'}</div><div class="meta">Taste score: ${(track.tasteScore ?? 0).toFixed(2)}${track.why ? ` · Why: +[${track.why.positiveHits.join(', ') || 'none'}] -[${track.why.rejectHits.join(', ') || 'none'}]` : ''}</div><div class="actions"><button data-action="enqueue" data-id="${track.id}">Add to listening queue</button>${mediaActionLinks(track, true)}</div></article>`).join('')
    : '<div class="card">No candidates yet. Press Build Journey.</div>';

  ui.candidateList.querySelectorAll('[data-action="enqueue"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const found = state.candidates.find((t) => `${t.id}` === `${id}`);
      if (found && !state.listeningDeck.some((t) => t.id === found.id)) {
        state.listeningDeck.push(found);
        ui.status.textContent = `Added ${found?.title || 'track'} to Listening Deck.`;
      } else {
        ui.status.textContent = `${found?.title || 'Track'} is already in Listening Deck.`;
      }
      state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeights(state));
      saveState();
      renderListeningDeck();
      renderTasteDNA();
      renderCandidates();
    });
  });
}

function renderListeningDeck() {
  ui.listeningDeck.innerHTML = state.listeningDeck.length
    ? state.listeningDeck.map((track) => listeningCardMarkup(track)).join('')
    : '<div class="card">Listening Deck is empty. Press Start Journey.</div>';

  ui.listeningDeck.querySelectorAll('[data-rate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ratings[btn.dataset.id] = Number(btn.dataset.rate);
      state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeights(state));
      saveState();
      renderListeningDeck();
      renderTasteDNA();
      renderCandidates();
    });
  });

  ui.listeningDeck.querySelectorAll('[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { id, tag } = btn.dataset;
      const list = new Set(state.tags[id] || []);
      list.has(tag) ? list.delete(tag) : list.add(tag);
      state.tags[id] = Array.from(list);
      state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeights(state));
      saveState();
      renderListeningDeck();
      renderTasteDNA();
      renderCandidates();
    });
  });
}

function listeningCardMarkup(track) {
  const embed = toSpotifyEmbedUrl(track.spotifyUrl || track.spotifyUri || '');
  const rating = state.ratings[track.id];
  const tags = state.tags[track.id] || [];
  return `<article class="card"><strong>${track.title || track.name || 'Unknown'}</strong><div class="meta">${track.artist || 'Unknown Artist'} · rating ${rating ?? 'unrated'}</div>${embed ? `<iframe src="${embed}" width="100%" height="152" style="border:0" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` : '<div class="meta">Needs Spotify link</div>'}<div class="actions media-controls">${mediaActionLinks(track, false)}</div><div class="actions">${RATING_VALUES.map((value) => `<button class="rating" data-id="${track.id}" data-rate="${value}">${value}</button>`).join('')}</div><div class="tags">${POSITIVE_REASON_TAGS.concat(REJECT_REASON_TAGS).map((tag) => `<button class="tag" data-id="${track.id}" data-tag="${tag}">${tag}${tags.includes(tag) ? ' ✓' : ''}</button>`).join('')}</div></article>`;
}

function mediaActionLinks(track, compact = false) {
  const spotifyOpenUrl = parseSpotifyReference(track.spotifyUrl || track.spotifyUri || '')?.openUrl || '';
  const youtubeUrl = track.youtubeUrl || '';
  const spotifyLabel = spotifyOpenUrl ? 'Open in Spotify' : 'Find on Spotify';
  const youtubeLabel = youtubeUrl ? 'Open in YouTube' : 'Find on YouTube';
  const spotifyHref = spotifyOpenUrl || buildSpotifySearchUrl(track);
  const youtubeHref = youtubeUrl || buildYouTubeSearchUrl(track);
  return `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${spotifyHref}">${spotifyLabel}</a><a class="media-btn youtube" target="_blank" rel="noopener noreferrer" href="${youtubeHref}">${youtubeLabel}</a>${compact ? '' : ''}`;
}

function buildSeededCandidates(term) {
  const q = String(term || '').toLowerCase();
  const fromLibrary = TRACK_LIBRARY.filter((track) => `${track.artist} ${track.title}`.toLowerCase().includes(q)).map((track) => ({ ...track, reason: 'Exact artist/title match', lane: 'Library match' }));
  const seeded = ANYMA_SEEDED_CANDIDATES.filter((track) => `${track.artist} ${track.title}`.toLowerCase().includes(q) || q.includes('anyma'));
  const anchors = SEEDED_TASTE_TRACKS.map((track) => ({ ...track, reason: 'Related taste anchor', lane: track.lane || 'Taste anchor' }));
  const merged = [...seeded, ...fromLibrary, ...anchors, ...ANYMA_SEEDED_CANDIDATES];
  const unique = [];
  const ids = new Set();
  for (const track of merged) {
    if (ids.has(track.id)) continue;
    ids.add(track.id);
    unique.push(track);
    if (unique.length >= 12) break;
  }
  return unique.slice(0, Math.max(8, unique.length));
}

function parseArtists(raw) {
  return raw.split(',').map((a) => a.trim()).filter(Boolean);
}

function loadState() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  return {
    candidates: Array.isArray(saved.candidates) ? saved.candidates : [],
    listeningDeck: Array.isArray(saved.listeningDeck) ? saved.listeningDeck : [],
    ratings: saved.ratings && typeof saved.ratings === 'object' ? saved.ratings : {},
    tags: saved.tags && typeof saved.tags === 'object' ? saved.tags : {},
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
