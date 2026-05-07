import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { SEEDED_TASTE_TRACKS } from './data/musicTasteSeeds.js';
import { buildSpotifySearchUrl, buildYouTubeSearchUrl, parseSpotifyReference, toSpotifyEmbedUrl } from './utils/spotifyEmbed.js';
import { buildTasteWeights, rankCandidatesByTaste, topSignals } from './engine/tasteLearning.js';
import { parseFeedback } from './engine/tasteFeedbackRules.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const RATING_VALUES = [-2, -1, 0, 1, 2];
const DEFAULT_POSITIVE_TRAITS = ['haunting female vocal','echo vocal','reverb vocal','processed vocal','dark club pressure','wide club sound','emotional lift','serious trance DNA','Universal Nation spine','slow-build payoff','complex riff','off-kilter rhythm','Lana-coded','Sevdaliza-coded','Courtyard architecture','ghost in the track','club engine'];
const DEFAULT_NEGATIVE_TRAITS = ['too cheesy','too Goa / psy','too harsh','too miserable / down','too weird','boring','flat','wrong vocal','wrong rock / industrial lane','no ghost','no complexity','no lift','no club pressure','too average','too bright'];
const ANYMA_SEEDED_CANDIDATES = [];

const ui = {
  artistInput: document.getElementById('artist-input'), buildBtn: document.getElementById('build-journey-btn'), startBtn: document.getElementById('start-journey-btn'), resetBtn: document.getElementById('reset-btn'), status: document.getElementById('status-text'),
  positiveAnchors: document.getElementById('positive-anchors'), rejectPatterns: document.getElementById('reject-patterns'), ratingCounts: document.getElementById('rating-counts'), learningSignals: document.getElementById('learning-signals'), candidateList: document.getElementById('candidate-list'), listeningDeck: document.getElementById('listening-deck'),
  traitRows: document.getElementById('taste-dna-traits'), addTraitBtn: document.getElementById('save-trait-btn'), addTraitName: document.getElementById('trait-name-input'), addTraitWeight: document.getElementById('trait-weight-input'), addTraitType: document.getElementById('trait-polarity-input'), aiBtn: document.getElementById('ask-ai-feedback-btn'),
};

const state = loadState();
renderAll();
wireEvents();

function wireEvents() {
  ui.buildBtn?.addEventListener('click', buildJourney); ui.startBtn?.addEventListener('click', startJourney); ui.resetBtn?.addEventListener('click', resetAll);
  ui.addTraitBtn?.addEventListener('click', addCustomTrait);
  ui.aiBtn?.addEventListener('click', () => { ui.status.textContent = 'AI interpretation not connected yet. Rule-based interpretation applied.'; });
}
function ensureTrait(trait, polarity = 'positive', weight = 1, category = 'experimental') {
  const normalized = String(trait || '').trim(); if (!normalized) return;
  if (!state.tasteDNA[normalized]) state.tasteDNA[normalized] = { weight: Number(weight) || 1, polarity, category, contributions: 0, custom: true, updatedAt: new Date().toISOString() };
}
function addCustomTrait() {
  const name = ui.addTraitName?.value?.trim(); if (!name) return;
  const polarity = ui.addTraitType?.value === 'negative' ? 'negative' : 'positive';
  ensureTrait(name, polarity, Number(ui.addTraitWeight?.value || 1), 'experimental');
  ui.addTraitName.value = '';
  saveState(); renderAll();
}
function applyFeedback(id, text) {
  const result = parseFeedback(text); state.feedbackHistory.push({ id, ...result, at: new Date().toISOString() });
  const bump = (trait, polarity, delta) => { ensureTrait(trait, polarity, delta, polarity === 'negative' ? 'avoid' : 'core'); const rec = state.tasteDNA[trait]; rec.weight = Number((rec.weight + delta).toFixed(2)); rec.contributions += 1; rec.updatedAt = new Date().toISOString(); };
  result.plus.forEach((trait) => bump(trait, 'positive', 0.6)); result.minus.forEach((trait) => bump(trait, 'negative', 0.8));
  state.lastFeedbackInterpreted = result; state.candidates = rankCandidatesByTaste(buildSeededCandidates(parseArtists(ui.artistInput?.value || '')[0] || 'anyma'), buildTasteWeightsForState());
  saveState(); renderAll();
}
function buildTasteWeightsForState() {
  const learned = buildTasteWeights(state);
  for (const [trait, meta] of Object.entries(state.tasteDNA || {})) {
    if (meta.polarity === 'negative') learned.rejectWeights[trait.toLowerCase()] = Number(((learned.rejectWeights[trait.toLowerCase()] || 0) + Number(meta.weight || 0)).toFixed(2));
    else learned.positiveWeights[trait.toLowerCase()] = Number(((learned.positiveWeights[trait.toLowerCase()] || 0) + Number(meta.weight || 0)).toFixed(2));
  }
  return learned;
}
function buildJourney() { const artists = parseArtists(ui.artistInput?.value || ''); if (!artists.length) { ui.status.textContent = 'Enter an artist to build a journey.'; return; } const term = artists[0]; ui.status.textContent = `Building journey for: ${term}`; state.candidates = rankCandidatesByTaste(buildSeededCandidates(term), buildTasteWeightsForState()); if (!state.listeningDeck.length && state.candidates.length) state.listeningDeck = [state.candidates[0]]; ui.status.textContent = `Built ${state.candidates.length} candidates for ${term}.`; saveState(); renderAll(); }
function startJourney() { const artists = parseArtists(ui.artistInput?.value || ''); if (!artists.length) { ui.status.textContent = 'Enter an artist to build a journey.'; return; } const term = artists[0]; if (!state.candidates.length) state.candidates = rankCandidatesByTaste(buildSeededCandidates(term), buildTasteWeightsForState()); if (!state.listeningDeck.length) state.listeningDeck = state.candidates.slice(0, 3); ui.status.textContent = `Starting journey for: ${term}.`; saveState(); renderAll(); }
function resetAll() { localStorage.removeItem(STORAGE_KEY); Object.assign(state, loadState()); ui.status.textContent = 'Reset complete.'; renderAll(); }
function renderAll() { renderTasteDNA(); renderCandidates(); renderListeningDeck(); }
function renderTasteDNA() {
  ui.positiveAnchors.innerHTML = '<h3>Positive anchors</h3>'; ui.rejectPatterns.innerHTML = '<h3>Reject patterns</h3>';
  const counts = RATING_VALUES.reduce((acc, val) => ({ ...acc, [val]: 0 }), {}); for (const value of Object.values(state.ratings)) counts[value] = (counts[value] || 0) + 1;
  ui.ratingCounts.innerHTML = `<h3>Rating counts</h3><div class="card">${Object.entries(counts).map(([k,v]) => `<div>${k}: ${v}</div>`).join('')}</div>`;
  const weights = buildTasteWeightsForState(); const topPositive = topSignals(weights.positiveWeights); const topReject = topSignals(weights.rejectWeights);
  const recent = Object.entries(state.tasteDNA).sort((a,b)=>String(b[1].updatedAt||'').localeCompare(String(a[1].updatedAt||''))).slice(0,5).map(([k])=>k);
  ui.learningSignals.innerHTML = `<h3>Learning Signals</h3><div class="card"><div><strong>Strongest positive</strong>${topPositive.map(([k,v])=>`<div>${k}: +${v.toFixed(2)}</div>`).join('') || '<div>None</div>'}</div><div><strong>Strongest negative</strong>${topReject.map(([k,v])=>`<div>${k}: -${v.toFixed(2)}</div>`).join('') || '<div>None</div>'}</div><div><strong>Recently changed</strong>${recent.map((x)=>`<div>${x}</div>`).join('') || '<div>None</div>'}</div><div><strong>How many ratings contributed</strong> ${Object.keys(state.ratings).length}</div><div><strong>Last feedback interpreted</strong> ${state.lastFeedbackInterpreted?.raw || 'none yet'}</div></div>`;
  ui.traitRows.innerHTML = Object.entries(state.tasteDNA).map(([name, meta]) => `<div class="card trait-row"><strong>${name}</strong><div class="meta">${meta.polarity} · ${meta.category} · tracks ${meta.contributions}</div><div class="actions"><button data-action="weight-dec" data-trait="${name}">-</button><span data-weight="${name}">${Number(meta.weight).toFixed(2)}</span><button data-action="weight-inc" data-trait="${name}">+</button><input type="range" min="-5" max="10" step="0.2" value="${Number(meta.weight)}" data-action="weight-slider" data-trait="${name}" /></div></div>`).join('');
  ui.traitRows.querySelectorAll('[data-action="weight-inc"]').forEach((btn)=>btn.addEventListener('click',()=>adjustTraitWeight(btn.dataset.trait,0.5)));
  ui.traitRows.querySelectorAll('[data-action="weight-dec"]').forEach((btn)=>btn.addEventListener('click',()=>adjustTraitWeight(btn.dataset.trait,-0.5)));
  ui.traitRows.querySelectorAll('[data-action="weight-slider"]').forEach((input)=>input.addEventListener('input',()=>setTraitWeight(input.dataset.trait, Number(input.value))));
}
function adjustTraitWeight(name, delta) { if (!state.tasteDNA[name]) return; state.tasteDNA[name].weight = Number((state.tasteDNA[name].weight + delta).toFixed(2)); state.tasteDNA[name].updatedAt = new Date().toISOString(); state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderAll(); }
function setTraitWeight(name, value) { if (!state.tasteDNA[name]) return; state.tasteDNA[name].weight = Number(value.toFixed(2)); state.tasteDNA[name].updatedAt = new Date().toISOString(); state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderAll(); }
function renderCandidates() { ui.candidateList.innerHTML = state.candidates.length ? state.candidates.map((track) => `<article class="card"><strong>${track.title || track.name || 'Unknown'}</strong><div class="meta">${track.artist || 'Unknown Artist'}</div><div class="meta">Taste score: ${(track.tasteScore ?? 0).toFixed(2)}</div><div class="meta">Why this surfaced: Matched: ${track.why?.positiveHits?.join(', ') || 'none'}. Avoided: ${track.why?.rejectHits?.join(', ') || 'none'}.</div><div class="actions"><button data-action="enqueue" data-id="${track.id}">Add to listening queue</button>${mediaActionLinks(track, true)}</div></article>`).join('') : '<div class="card">No candidates yet. Press Build Journey.</div>';
ui.candidateList.querySelectorAll('[data-action="enqueue"]').forEach((btn)=>btn.addEventListener('click',()=>{ const id = btn.getAttribute('data-id'); const found = state.candidates.find((t) => `${t.id}` === `${id}`); if (found && !state.listeningDeck.some((t) => t.id === found.id)) { state.listeningDeck.push(found); ui.status.textContent = `Added ${found?.title || 'track'} to Listening Deck.`; } else { ui.status.textContent = `${found?.title || 'Track'} is already in Listening Deck.`; } state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderListeningDeck(); renderTasteDNA(); renderCandidates(); })); }
function renderListeningDeck() { ui.listeningDeck.innerHTML = state.listeningDeck.length ? state.listeningDeck.map((track) => listeningCardMarkup(track)).join('') : '<div class="card">Listening Deck is empty. Press Start Journey.</div>';
ui.listeningDeck.querySelectorAll('[data-rate]').forEach((btn)=>btn.addEventListener('click',()=>{ state.ratings[btn.dataset.id] = Number(btn.dataset.rate); state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderAll(); }));
ui.listeningDeck.querySelectorAll('[data-tag]').forEach((btn)=>btn.addEventListener('click',()=>{ const { id, tag } = btn.dataset; const list = new Set(state.tags[id] || []); list.has(tag) ? list.delete(tag) : list.add(tag); state.tags[id] = Array.from(list); saveState(); renderAll(); }));
ui.listeningDeck.querySelectorAll('[data-action="apply-feedback"]').forEach((btn)=>btn.addEventListener('click',()=>{ const id = btn.dataset.id; const field = ui.listeningDeck.querySelector(`[data-feedback-input="${id}"]`); applyFeedback(id, field?.value || ''); })); }
function listeningCardMarkup(track) { const embed = toSpotifyEmbedUrl(track.spotifyUrl || track.spotifyUri || ''); const rating = state.ratings[track.id]; const tags = state.tags[track.id] || []; return `<article class="card"><strong>${track.title || track.name || 'Unknown'}</strong><div class="meta">${track.artist || 'Unknown Artist'} · rating ${rating ?? 'unrated'}</div>${embed ? `<iframe src="${embed}" width="100%" height="152" style="border:0" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` : '<div class="meta">Needs Spotify link</div>'}<div class="actions media-controls">${mediaActionLinks(track, false)}</div><div class="actions">${RATING_VALUES.map((value) => `<button class="rating" data-id="${track.id}" data-rate="${value}">${value}</button>`).join('')}</div><div class="tags">${DEFAULT_POSITIVE_TRAITS.concat(DEFAULT_NEGATIVE_TRAITS).map((tag) => `<button class="tag" data-id="${track.id}" data-tag="${tag}">${tag}${tags.includes(tag) ? ' ✓' : ''}</button>`).join('')}</div><textarea data-feedback-input="${track.id}" class="feedback-input" placeholder="Tell the taste engine what you hear…">${state.trackFeedback[track.id] || ''}</textarea><div class="actions"><button type="button" data-action="apply-feedback" data-id="${track.id}">Apply feedback to Taste DNA</button><button type="button" disabled>Ask AI to interpret feedback</button></div></article>`; }
function mediaActionLinks(track) { const spotifyOpenUrl = parseSpotifyReference(track.spotifyUrl || track.spotifyUri || '')?.openUrl || ''; const youtubeUrl = track.youtubeUrl || ''; const spotifyLabel = spotifyOpenUrl ? 'Open in Spotify' : 'Find on Spotify'; const youtubeLabel = youtubeUrl ? 'Open in YouTube' : 'Find on YouTube'; const spotifyHref = spotifyOpenUrl || buildSpotifySearchUrl(track); const youtubeHref = youtubeUrl || buildYouTubeSearchUrl(track); return `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${spotifyHref}">${spotifyLabel}</a><a class="media-btn youtube" target="_blank" rel="noopener noreferrer" href="${youtubeHref}">${youtubeLabel}</a>`; }
function buildSeededCandidates(term) { const q = String(term || '').toLowerCase(); const fromLibrary = TRACK_LIBRARY.filter((track) => `${track.artist} ${track.title}`.toLowerCase().includes(q)).map((track) => ({ ...track, reason: 'Exact artist/title match', lane: 'Library match' })); const anchors = SEEDED_TASTE_TRACKS.map((track) => ({ ...track, reason: 'Related taste anchor', lane: track.lane || 'Taste anchor' })); const merged = [...fromLibrary, ...anchors]; const unique = []; const ids = new Set(); for (const track of merged) { if (ids.has(track.id)) continue; ids.add(track.id); unique.push(track); if (unique.length >= 12) break; } return unique.slice(0, Math.max(8, unique.length)); }
function parseArtists(raw) { return raw.split(',').map((a) => a.trim()).filter(Boolean); }
function initialTasteDNA() { const map = {}; DEFAULT_POSITIVE_TRAITS.forEach((name)=>{ map[name] = { weight: 1, polarity: 'positive', category: 'core', contributions: 0, custom: false, updatedAt: '' }; }); DEFAULT_NEGATIVE_TRAITS.forEach((name)=>{ map[name] = { weight: 1, polarity: 'negative', category: name === 'too harsh' ? 'banned' : 'avoid', contributions: 0, custom: false, updatedAt: '' }; }); return map; }
function loadState() { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return { candidates: Array.isArray(saved.candidates) ? saved.candidates : [], listeningDeck: Array.isArray(saved.listeningDeck) ? saved.listeningDeck : [], ratings: saved.ratings && typeof saved.ratings === 'object' ? saved.ratings : {}, tags: saved.tags && typeof saved.tags === 'object' ? saved.tags : {}, tasteDNA: saved.tasteDNA && typeof saved.tasteDNA === 'object' ? saved.tasteDNA : initialTasteDNA(), feedbackHistory: Array.isArray(saved.feedbackHistory) ? saved.feedbackHistory : [], trackFeedback: saved.trackFeedback && typeof saved.trackFeedback === 'object' ? saved.trackFeedback : {}, lastFeedbackInterpreted: saved.lastFeedbackInterpreted || null }; }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

