import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { SEEDED_TASTE_TRACKS } from './data/musicTasteSeeds.js';
import { toSpotifyEmbedUrl } from './utils/spotifyEmbed.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const RATING_VALUES = [-2, -1, 0, 1, 2];
const REASON_TAGS = ['serious trance DNA', 'ghost vocal fit', 'dark courtyard energy', 'too commercial', 'flat energy'];

const ui = {
  artistInput: document.getElementById('artist-input'),
  buildBtn: document.getElementById('build-journey-btn'),
  startBtn: document.getElementById('start-journey-btn'),
  resetBtn: document.getElementById('reset-btn'),
  status: document.getElementById('status-text'),
  positiveAnchors: document.getElementById('positive-anchors'),
  rejectPatterns: document.getElementById('reject-patterns'),
  ratingCounts: document.getElementById('rating-counts'),
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
  const fallbackArtists = SEEDED_TASTE_TRACKS.map((t) => t.artist);
  const pool = artists.length ? artists : fallbackArtists;
  state.candidates = TRACK_LIBRARY.filter((track) => pool.some((artist) => `${track.artist}`.toLowerCase().includes(artist.toLowerCase()))).slice(0, 18);
  if (!state.candidates.length) state.candidates = TRACK_LIBRARY.slice(0, 12);
  ui.status.textContent = `Journey built for ${artists.length ? artists.join(', ') : 'seed taste DNA'} · ${state.candidates.length} candidates ready.`;
  saveState();
  renderAll();
}

function startJourney() {
  if (!state.candidates.length) buildJourney();
  state.listeningDeck = state.candidates.slice(0, 5);
  ui.status.textContent = `Journey started · ${state.listeningDeck.length} tracks loaded into Listening Deck.`;
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
}

function renderCandidates() {
  ui.candidateList.innerHTML = state.candidates.length
    ? state.candidates.map((track) => `<article class="card"><strong>${track.title || track.name || 'Unknown'}</strong><div class="meta">${track.artist || 'Unknown Artist'}</div><div class="actions"><button data-action="enqueue" data-id="${track.id}">Add to listening queue</button></div></article>`).join('')
    : '<div class="card">No candidates yet. Press Build Journey.</div>';

  ui.candidateList.querySelectorAll('[data-action="enqueue"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const found = state.candidates.find((t) => `${t.id}` === `${id}`);
      if (found && !state.listeningDeck.some((t) => t.id === found.id)) state.listeningDeck.push(found);
      ui.status.textContent = `Queued ${found?.title || 'track'} in Listening Deck.`;
      saveState();
      renderListeningDeck();
      renderTasteDNA();
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
      saveState();
      renderListeningDeck();
      renderTasteDNA();
    });
  });

  ui.listeningDeck.querySelectorAll('[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { id, tag } = btn.dataset;
      const list = new Set(state.tags[id] || []);
      list.has(tag) ? list.delete(tag) : list.add(tag);
      state.tags[id] = Array.from(list);
      saveState();
      renderListeningDeck();
    });
  });
}

function listeningCardMarkup(track) {
  const embed = toSpotifyEmbedUrl(track.spotifyUrl || track.spotifyUri || '');
  const rating = state.ratings[track.id];
  const tags = state.tags[track.id] || [];
  return `<article class="card"><strong>${track.title || track.name || 'Unknown'}</strong><div class="meta">${track.artist || 'Unknown Artist'} · rating ${rating ?? 'unrated'}</div>${embed ? `<iframe src="${embed}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` : '<div class="meta">No Spotify URI/URL yet</div>'}<div class="actions">${RATING_VALUES.map((value) => `<button class="rating" data-id="${track.id}" data-rate="${value}">${value}</button>`).join('')}</div><div class="tags">${REASON_TAGS.map((tag) => `<button class="tag" data-id="${track.id}" data-tag="${tag}">${tag}${tags.includes(tag) ? ' ✓' : ''}</button>`).join('')}</div></article>`;
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
