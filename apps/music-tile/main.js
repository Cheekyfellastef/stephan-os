import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { SEEDED_TASTE_TRACKS } from './data/musicTasteSeeds.js';
import { buildSpotifySearchUrl, buildYouTubeSearchUrl, resolveSpotifyReference, getSpotifyLinkState } from './utils/spotifyEmbed.js';
import { AI_CANDIDATE_STATUSES, getCandidateVerificationStatus, isVerifiedCandidateTrack } from './engine/candidateVerification.js';
import { buildTasteWeights, rankCandidatesByTaste, topSignals } from './engine/tasteLearning.js';
import { parseFeedback } from './engine/tasteFeedbackRules.js';
import { buildArtistAwareCandidates, DEFAULT_DISCOVERY_RESULT_TARGET, MIN_DISCOVERY_RESULT_TARGET } from './engine/musicCandidateEngine.js';
import { runMusicDiscoveryPipeline } from './engine/musicDiscoveryPipeline.js';
import { askMusicAi, getMusicAiStatus, getMusicAiRuntimeDiagnostics, testMusicAiRoute } from './engine/musicAiBridge.js';
import { createTileMemoryBridge } from '../../shared/runtime/tileMemoryBridge.js';
import { createTileEventBridge } from '../../shared/runtime/tileEventBridge.js';
import { reducePresenceState, getPresenceSummary, acknowledgePresenceItem, dismissPresenceItem, approvePresenceAction } from '../../shared/runtime/stephanosPresenceModel.mjs';
import { emitPresenceEvent as emitGlobalPresenceEvent } from '../../shared/runtime/stephanosPresenceBridge.mjs';
import { runAiActionLifecycle } from '../../shared/runtime/aiActionLifecycle.mjs';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const RATING_VALUES = [-2, -1, 0, 1, 2];
const DEFAULT_POSITIVE_TRAITS = ['haunting female vocal','echo vocal','reverb vocal','processed vocal','dark club pressure','wide club sound','emotional lift','serious trance DNA','Universal Nation spine','slow-build payoff','complex riff','off-kilter rhythm','Lana-coded','Sevdaliza-coded','Courtyard architecture','ghost in the track','club engine'];
const DEFAULT_NEGATIVE_TRAITS = ['too cheesy','too Goa / psy','too harsh','too miserable / down','too weird','boring','flat','wrong vocal','wrong rock / industrial lane','no ghost','no complexity','no lift','no club pressure','too average','too bright'];
const ANYMA_SEEDED_CANDIDATES = [];
const LEGACY_MINIMUM_CANDIDATE_FLOOR = "Math.max(8, unique.length)";

const IMMERSION_REQUEST_TIMEOUT_MS = 25000;
const IMMERSION_FALLBACK_PHASES = [
  { name: 'Doorway / Warm-up', description: 'Prime the room with reverb vocal, dark atmosphere, and a slow-build contour.', traits: ['reverb vocal', 'dark atmosphere', 'slow-build'] },
  { name: 'Lift / Portal', description: 'Pivot into serious trance DNA with emotional lift and a Universal Nation spine.', traits: ['serious trance DNA', 'emotional lift', 'Universal Nation spine'] },
  { name: 'Club Engine', description: 'Raise pressure with dark club drive, wide sound staging, and complex riff motion.', traits: ['dark club pressure', 'wide sound', 'complex riff'] },
  { name: 'Afterglow', description: 'Land in haunting female vocal atmosphere with Lana-coded echo and reverb tails.', traits: ['haunting female vocal', 'Lana-coded', 'echo/reverb'] },
];
const IMMERSION_FALLBACK_CANDIDATES = ['Anyma', 'Sevdaliza', 'Hunger & Law', 'Close Your Eyes', 'Universal Nation', '1999', 'Greece 2000', 'Samsara', 'Welcome To The Opera', 'Say Yes To Heaven remix'];

const ui = { artistInput: document.getElementById('artist-input'), buildBtn: document.getElementById('build-journey-btn'), startBtn: document.getElementById('start-journey-btn'), resetBtn: document.getElementById('reset-btn'), resolveAllBtn: document.getElementById('resolve-all-links-btn'), status: document.getElementById('status-text'), addTrackUrlInput: document.getElementById('add-track-url-input'), addTrackBtn: document.getElementById('add-track-url-btn'), positiveAnchors: document.getElementById('positive-anchors'), rejectPatterns: document.getElementById('reject-patterns'), ratingCounts: document.getElementById('rating-counts'), learningSignals: document.getElementById('learning-signals'), candidateList: document.getElementById('candidate-list'), listeningDeck: document.getElementById('listening-deck'), traitRows: document.getElementById('taste-dna-traits'), addTraitBtn: document.getElementById('save-trait-btn'), addTraitName: document.getElementById('trait-name-input'), addTraitWeight: document.getElementById('trait-weight-input'), addTraitType: document.getElementById('trait-polarity-input'), aiBtn: document.getElementById('ask-ai-feedback-btn'), aiStatusText: document.getElementById('ai-status-text'), aiLastAction: document.getElementById('ai-last-action'), aiSuggestionPanel: document.getElementById('ai-suggestion-panel'), aiSuggestionsList: document.getElementById('ai-suggestions-list'), discoveryResults: document.getElementById('discovery-results-list'), journeyQueue: document.getElementById('journey-queue-list'), pendingTasteChanges: document.getElementById('pending-taste-dna-changes'), appliedTasteChanges: document.getElementById('applied-taste-dna-changes'), immersionSessionPanel: document.getElementById('immersion-session-panel'), aiBuildJourneyBtn: document.getElementById('ask-ai-build-journey-btn'), aiSummariseDnaBtn: document.getElementById('ask-ai-summarise-dna-btn'), aiSuggestTraitsBtn: document.getElementById('ask-ai-suggest-traits-btn'), resolveAllAiBtn: document.getElementById('resolve-all-links-ai-btn'), promoteMemoryBtn: document.getElementById('promote-memory-btn'), memoryStatus: document.getElementById('memory-promotion-status'), testAiRouteBtn: document.getElementById('test-ai-route-btn'), synthesiseTasteDnaBtn: document.getElementById('synthesise-taste-dna-btn'), buildImmersionSessionBtn: document.getElementById('build-immersion-session-btn'), immersionDuration: document.getElementById('immersion-duration'), immersionIntensity: document.getElementById('immersion-intensity'), immersionVocalAmount: document.getElementById('immersion-vocal-amount'), immersionDarkness: document.getElementById('immersion-darkness'), immersionTranceSpine: document.getElementById('immersion-trance-spine'), presenceVoice: document.getElementById('presence-voice'), presenceQueue: document.getElementById('presence-queue'), presenceEvents: document.getElementById('presence-events'), copyAiSuggestionsBtn: document.getElementById('copy-ai-suggestions-btn'), copyJourneySummaryBtn: document.getElementById('copy-journey-summary-btn'), exportJourneyJsonBtn: document.getElementById('export-journey-json-btn'), copyCodexPromptBtn: document.getElementById('copy-codex-prompt-btn'), copyTasteDnaSummaryBtn: document.getElementById('copy-taste-dna-summary-btn'), activeJourneySummary: document.getElementById('active-journey-summary'), resolveArtistSpotifyBtn: document.getElementById('resolve-artist-spotify-btn'), jumpAiSmarterJourneyBtn: document.getElementById('jump-ai-smarter-journey-btn'), aiSmarterJourneyPanel: document.getElementById('ai-smarter-journey-panel'), assistedSetupStatus: document.getElementById('assisted-setup-status'), assistedSetupPlan: document.getElementById('assisted-setup-plan'), setupViewStepsBtn: document.getElementById('setup-view-steps-btn'), setupTestSpotifyBtn: document.getElementById('setup-test-spotify-btn'), setupPrepareEnvBtn: document.getElementById('setup-prepare-env-btn'), setupMarkAddedBtn: document.getElementById('setup-mark-added-btn'), setupRetestBtn: document.getElementById('setup-retest-btn'), setupAskCodexBtn: document.getElementById('setup-ask-codex-btn') };

const intelligenceUi = {
  surpriseBtn: document.getElementById('surprise-me-btn'),
  reasonBtn: document.getElementById('show-briefing-reason-btn'),
  title: document.getElementById('daily-briefing-title'),
  copy: document.getElementById('daily-briefing-copy'),
  meta: document.getElementById('daily-briefing-meta'),
  listenNow: document.getElementById('briefing-listen-now'),
  why: document.getElementById('briefing-why'),
  novelty: document.getElementById('briefing-novelty'),
  spotlight: document.getElementById('discovery-spotlight'),
  stage: document.getElementById('discovery-stage'),
  tasteSignals: document.getElementById('taste-signal-strip'),
  tasteConfidence: document.getElementById('taste-confidence-chip'),
  tasteCopy: document.getElementById('taste-compass-copy'),
  tasteMeter: document.getElementById('taste-compass-meter'),
};

const tileEventBridge = (() => { try { return createTileEventBridge({ tileId: 'music-tile', tileSource: 'music-cockpit' }); } catch { return null; } })();
let presenceState = { status: 'idle', voiceMessages: [], awarenessQueue: [], recentEvents: [], lastSpokenSummary: '' };

const tileMemoryBridge = (() => { try { return createTileMemoryBridge({ tileId: 'music-tile', tileSource: 'music-cockpit' }); } catch { return null; } })();

function emitPresenceEvent(event = {}) {
  const payload = { sourceTile: 'music', kind: event.kind?.startsWith('music.') ? event.kind : `music.${event.kind || 'event'}`, ...event };
  emitGlobalPresenceEvent(payload);
  tileEventBridge?.emitEvent?.({ type: `music.${payload.kind || 'event'}`, payload });
  presenceState = reducePresenceState(presenceState, payload);
  renderPresencePanel();
}
function renderPresencePanel() {
  if (ui.presenceVoice) ui.presenceVoice.textContent = getPresenceSummary(presenceState);
  if (ui.presenceQueue) ui.presenceQueue.innerHTML = (presenceState.awarenessQueue || []).slice(0, 6).map((item) => `<div class="card"><strong>${item.summary || item.kind}</strong><div class="meta">${item.impact || ''}</div><div class="actions"><button data-presence-action="ack" data-id="${item.id}">Acknowledge</button><button data-presence-action="dismiss" data-id="${item.id}" class="ghost">Dismiss</button>${item.requiresApproval ? `<button data-presence-action="approve" data-id="${item.id}">Approve</button>` : ''}</div></div>`).join('');
  if (ui.presenceEvents) ui.presenceEvents.innerHTML = (presenceState.recentEvents || []).slice(0, 6).map((item) => `<div>${item.timestamp}: ${item.kind}</div>`).join('');
  document.querySelectorAll('[data-presence-action]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    if (btn.dataset.presenceAction === 'ack') presenceState = acknowledgePresenceItem(presenceState, id);
    if (btn.dataset.presenceAction === 'dismiss') presenceState = dismissPresenceItem(presenceState, id);
    if (btn.dataset.presenceAction === 'approve') presenceState = approvePresenceAction(presenceState, id);
    renderPresencePanel();
  }));
}
async function testAiRouteAction() {
  setAiAction('Contacting Stephanos AI for smarter journey…'); emitPresenceEvent({ kind: 'music.ai_smarter_journey_started', severity: 'info', summary: 'AI smarter journey started', impact: 'Waiting for AI candidates.' }); state.aiSmarterJourney=[{id:`ai-loading-${Date.now()}`, title:'AI Smarter Journey', summary:'Contacting Stephanos AI for smarter journey…', badge:'loading'}]; renderAiSuggestions();
  const result = await testMusicAiRoute();
  if (result.ok) {
    setAiAction(`AI router ready. Test AI route succeeded (${result.status}).`, result.diagnostics);
    emitPresenceEvent({ kind: 'music.ai_transport_ready', severity: 'info', summary: 'Music Tile AI router ready', impact: `AI transport reachable: status ${result.status}.`, suggestedAction: 'Use AI journey tools.' });
  } else {
    setAiAction(`AI transport failed: ${result.failureReason || result.status || result.snippet}. Rule-based mode active.`, result.diagnostics);
    emitPresenceEvent({ kind: 'music.ai_route_unavailable', severity: 'warning', summary: 'Music Tile AI router unavailable', impact: 'AI journey building and interpretation degraded; rule-based mode remains active.', suggestedAction: 'Test or repair the Music AI bridge.' });
  }
}


function buildMusicAiStatusView(diagnostics = {}) {
  const status = getMusicAiStatus();
  const runtime = getMusicAiRuntimeDiagnostics();
  const lastStatus = diagnostics.lastStatus == null ? null : Number(diagnostics.lastStatus);
  const lastError = String(diagnostics.lastError || '').trim();
  const reached = diagnostics.requestReachedBackend;
  const responded = diagnostics.backendResponded;
  const responseMode = diagnostics.responseKind || 'n/a';
  const providerUnknown = status.routeKind === 'unknown' || status.provider === 'unknown';
  let statusKind = 'unknown'; let headline = 'AI transport status unknown. Press Test AI route.'; let badge='music-badge';
  if ((lastStatus == null || Number.isNaN(lastStatus) || lastStatus <= 0) && reached !== true && !lastError) { statusKind='not-tested'; headline='AI transport not tested yet. Press Test AI route.'; badge='music-badge'; }
  else if (lastError && (reached === false || lastStatus === 0)) { statusKind='network-error'; headline=`AI backend unreachable/network error. ${lastError}`; badge='music-badge music-badge--warning'; }
  else if (lastStatus === 404) { statusKind='route-missing'; headline='AI route missing. 404 /api/ai/chat.'; badge='music-badge music-badge--warning'; }
  else if (lastStatus === 405) { statusKind='method-mismatch'; headline='AI method mismatch: 405.'; badge='music-badge music-badge--warning'; }
  else if (lastStatus === 400) { statusKind='payload-invalid'; headline='AI payload invalid: 400.'; badge='music-badge music-badge--warning'; }
  else if (lastStatus >= 500) { statusKind='backend-error'; headline=`AI backend/provider error: ${lastStatus}.`; badge='music-badge music-badge--warning'; }
  else if (lastStatus === 200 && responded === true) { statusKind = providerUnknown ? 'degraded' : 'ready'; headline = providerUnknown ? 'AI transport ready. Provider details unavailable in this tile.' : 'AI transport ready.'; badge='music-badge music-badge--success'; }
  if (responseMode === 'text-fallback') headline += ' Text fallback mode active.';
  return { statusKind, headline, details:'Rule-based parser remains available.', badge, providerMetadataHelp:'The Music Tile can reach the AI backend, but this embedded tile cannot currently read the selected provider/model metadata. Provider details will appear when route truth is available.', shouldShowRuleFallback:true, diagnosticsRows:[`Endpoint: ${runtime.endpointUrl}`,`Backend base: ${runtime.backendBaseUrl}`,`Last HTTP status: ${lastStatus ?? 'n/a'}`,`Last error: ${lastError || 'none'}`,`Request reached backend: ${reached===true?'yes':reached===false?'no':'unknown'}`,`Backend responded: ${responded===true?'yes':responded===false?'no':'unknown'}`,`Response mode: ${responseMode}`,`Route/provider metadata: ${status.routeKind}/${status.provider}`] };
}

const state = loadState(); renderAll(); wireEvents(); updateAiStatus(); renderPresencePanel(); wireIntelligenceExperience(); refreshIntegrationSetupStatus({ announce: false });

function updateAiStatus(extra = {}) {
  if (!ui.aiStatusText) return;
  const view = buildMusicAiStatusView(extra);
  const providerMetaBadge = view.statusKind === 'degraded' ? '<span class="music-badge" title="The Music Tile can reach the AI backend, but this embedded tile cannot currently read the selected provider/model metadata.">provider_metadata_unavailable · info</span>' : '';
  ui.aiStatusText.innerHTML = `<span class="${view.badge}">${view.statusKind}</span> ${view.headline} ${view.details} ${providerMetaBadge} ${view.providerMetadataHelp ? `<span class="meta" title="${view.providerMetadataHelp}">ⓘ</span>` : ''}`;
  if (ui.aiLastAction) ui.aiLastAction.innerHTML = `<details class="music-diagnostics"><summary>Show diagnostics</summary>${view.diagnosticsRows.map((lineText) => `<div class="meta">${lineText}</div>`).join('')}</details>`;
}
function setAiAction(text, diagnostics = null) { if (ui.status) ui.status.textContent = text; updateAiStatus(diagnostics || {}); }

function wireIntelligenceExperience() {
  intelligenceUi.surpriseBtn?.addEventListener('click', startSurpriseJourney);
  intelligenceUi.reasonBtn?.addEventListener('click', () => {
    intelligenceUi.stage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    intelligenceUi.spotlight?.classList.remove('music-highlight-pulse');
    void intelligenceUi.spotlight?.offsetWidth;
    intelligenceUi.spotlight?.classList.add('music-highlight-pulse');
    window.setTimeout(() => intelligenceUi.spotlight?.classList.remove('music-highlight-pulse'), 1200);
  });
  intelligenceUi.spotlight?.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-action="spotlight-add"]');
    if (!addButton) return;
    const track = (state.candidates || []).find((candidate) => `${candidate.id}` === `${addButton.dataset.id}`);
    if (!track) return;
    if (!state.listeningDeck.some((candidate) => `${candidate.id}` === `${track.id}`)) {
      state.listeningDeck.unshift(track);
      ui.status.textContent = `${track.title || 'Track'} added to your Listening Room.`;
      saveState();
      renderAll();
    }
  });
}

function getJourneySeedArtist() {
  const typedArtist = parseArtists(ui.artistInput?.value || '')[0];
  if (typedArtist) return typedArtist;
  const previousArtist = String(state.lastDiscoveryMeta?.canonicalArtist || '').trim();
  if (previousArtist && previousArtist.toLowerCase() !== 'unknown artist') return previousArtist;
  const knownDeckArtist = (state.listeningDeck || []).find((track) => {
    const artist = String(track?.artist || '').trim().toLowerCase();
    return artist && artist !== 'unknown' && artist !== 'unknown artist';
  })?.artist;
  return knownDeckArtist || 'Anyma';
}

async function startSurpriseJourney() {
  const button = intelligenceUi.surpriseBtn;
  if (!button || button.disabled) return;
  const seedArtist = getJourneySeedArtist();
  if (ui.artistInput) ui.artistInput.value = seedArtist;
  button.disabled = true;
  button.classList.add('is-loading');
  const title = button.querySelector('strong');
  const subtitle = button.querySelector('small');
  if (title) title.textContent = 'Opening the next door…';
  if (subtitle) subtitle.textContent = `Reading your ${seedArtist} signal`;
  try {
    const buildOutcome = await buildJourney();
    if (!buildOutcome?.ok) return;
    const doorwayTrack = state.candidates?.[0] || null;
    if (doorwayTrack && !state.listeningDeck.some((track) => `${track.id}` === `${doorwayTrack.id}`)) {
      state.listeningDeck.unshift(doorwayTrack);
      saveState();
    }
    renderAll();
    if (doorwayTrack) {
      ui.status.textContent = `Journey ready. ${doorwayTrack.artist || 'Unknown Artist'} — ${getDisplayTrackTitle(doorwayTrack)} is your doorway track.`;
      intelligenceUi.stage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      ui.status.textContent = 'No evidence-backed doorway track was available. Try an artist in Advanced Studio.';
    }
  } catch (error) {
    setTerminalStatus(`Journey not ready: ${String(error?.message || error)}. Your existing listening room was not reported as ready.`);
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (title) title.textContent = 'Surprise Me';
    if (subtitle) subtitle.textContent = 'Start my journey';
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getDisplayTrackTitle(track = {}) {
  const rawTitle = String(track.title || track.name || 'Untitled').trim();
  const artist = String(track.artist || '').trim();
  if (!artist) return rawTitle;
  const artistPrefix = `${artist} - `;
  return rawTitle.toLowerCase().startsWith(artistPrefix.toLowerCase())
    ? rawTitle.slice(artistPrefix.length).trim() || rawTitle
    : rawTitle;
}

function getTrackReason(track = {}) {
  const explicitReason = String(track.aiReason || track.reason || track.discoveryReason || '').trim();
  if (explicitReason) return explicitReason;
  const positiveHits = Array.isArray(track.why?.positiveHits) ? track.why.positiveHits.filter(Boolean) : [];
  if (positiveHits.length) return `It matches ${positiveHits.slice(0, 3).join(', ')} in your Taste DNA.`;
  return 'Evidence unavailable — Stephanos has not stored a reason for this candidate yet.';
}

function getTrackEvidence(track = {}) {
  const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  const verification = getCandidateVerificationStatus(track);
  if (isVerifiedCandidateTrack(track) && spotify.valid && spotify.type === 'track') {
    return { label: 'Verified playable', tone: 'success', spotify };
  }
  if (verification === AI_CANDIDATE_STATUSES.likelyHallucinated || verification === AI_CANDIDATE_STATUSES.notFound) {
    return { label: 'Suppressed · not verified', tone: 'warning', spotify };
  }
  if (track.aiSuggested) {
    return { label: 'AI lead · unverified', tone: 'warning', spotify };
  }
  return { label: 'Local candidate · verify', tone: 'neutral', spotify };
}

function getNoveltyStatement(track = {}) {
  if (!track?.id) return 'Novelty evidence not available yet';
  if (Object.hasOwn(state.ratings || {}, track.id)) {
    return `Already rated ${state.ratings[track.id]}; this is not a new discovery`;
  }
  if (track.aiSuggested) return 'AI lead only; novelty and existence are not yet verified';
  return 'Unrated in this tile; wider listening history is unavailable';
}

function renderMusicIntelligenceCentre() {
  const track = state.candidates?.[0] || state.listeningDeck?.[0] || null;
  const positiveSignalEntries = Object.entries(state.tasteDNA || {})
    .filter(([, meta]) => meta?.polarity !== 'negative' && Number(meta?.weight || 0) > 0)
    .sort((a, b) => Number(b[1]?.weight || 0) - Number(a[1]?.weight || 0))
    .slice(0, 3);
  const positiveSignals = positiveSignalEntries.map(([name]) => name);
  const ratingCount = Object.keys(state.ratings || {}).length;

  if (intelligenceUi.tasteSignals) {
    intelligenceUi.tasteSignals.innerHTML = positiveSignals.length
      ? positiveSignals.map((signal) => `<span>${escapeHtml(signal)}</span>`).join('')
      : '<span>No positive Taste DNA signals yet</span>';
  }
  if (intelligenceUi.tasteConfidence) {
    intelligenceUi.tasteConfidence.textContent = ratingCount ? `${ratingCount} rated` : 'Taste seed';
  }
  if (intelligenceUi.tasteCopy) {
    const signalText = positiveSignals.length ? positiveSignals.join(', ') : 'no positive signals yet';
    intelligenceUi.tasteCopy.textContent = `Current compass: ${signalText}. Bars are relative to the strongest current stored signal; based on ${ratingCount} track rating${ratingCount === 1 ? '' : 's'}. AI suggestions still require approval.`;
  }
  if (intelligenceUi.tasteMeter) {
    const strongestWeight = Number(positiveSignalEntries[0]?.[1]?.weight || 0);
    intelligenceUi.tasteMeter.hidden = positiveSignalEntries.length === 0;
    intelligenceUi.tasteMeter.innerHTML = positiveSignalEntries.map(([name, meta]) => {
      const weight = Number(meta?.weight || 0);
      const relativeStrength = strongestWeight > 0
        ? Math.max(0, Math.min(100, Math.round((weight / strongestWeight) * 100)))
        : 0;
      const label = `${name}: stored weight ${weight.toFixed(2)}, ${relativeStrength}% of the strongest positive signal`;
      return `<span style="--strength: ${relativeStrength}%" role="img" aria-label="${escapeHtml(label)}"></span>`;
    }).join('');
  }

  if (!track) {
    if (intelligenceUi.title) intelligenceUi.title.textContent = 'Your taste is loaded. The next door is unopened.';
    if (intelligenceUi.copy) intelligenceUi.copy.textContent = 'One tap turns your real Taste DNA into a listening journey. Every recommendation will tell you why it earned its place.';
    if (intelligenceUi.meta) intelligenceUi.meta.textContent = 'No journey generated yet';
    if (intelligenceUi.listenNow) intelligenceUi.listenNow.textContent = 'Awaiting your journey';
    if (intelligenceUi.why) intelligenceUi.why.textContent = 'Taste evidence will appear here';
    if (intelligenceUi.novelty) intelligenceUi.novelty.textContent = 'Novelty evidence not available yet';
    return;
  }

  const title = getDisplayTrackTitle(track);
  const artist = track.artist || 'Unknown Artist';
  const reason = getTrackReason(track);
  const evidence = getTrackEvidence(track);
  const novelty = getNoveltyStatement(track);
  const matchedTraits = Array.isArray(track.why?.positiveHits) ? track.why.positiveHits.filter(Boolean).slice(0, 3) : [];
  const reasonSummary = matchedTraits.length ? matchedTraits.join(' · ') : reason;
  const score = Number(track.finalScore ?? track.tasteScore);
  const scoreLabel = Number.isFinite(score) ? `Taste score ${score.toFixed(2)}` : 'Taste score unavailable';
  const inDeck = state.listeningDeck.some((candidate) => `${candidate.id}` === `${track.id}`);
  const spotifyAction = evidence.spotify.valid && evidence.spotify.type === 'track' && isVerifiedCandidateTrack(track)
    ? `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${escapeHtml(evidence.spotify.openUrl)}">Open in Spotify</a>`
    : `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${escapeHtml(buildSpotifySearchUrl(track))}">Verify on Spotify</a>`;

  if (intelligenceUi.title) intelligenceUi.title.textContent = `Start with ${title}. Then follow the signal.`;
  if (intelligenceUi.copy) intelligenceUi.copy.textContent = `${artist} surfaced from your stored Taste DNA. Stephanos is showing the reason and the reality boundary before asking you to trust the recommendation.`;
  if (intelligenceUi.meta) intelligenceUi.meta.textContent = `${state.candidates?.length || 0} candidates · ${state.listeningDeck?.length || 0} in the room · ${scoreLabel}`;
  if (intelligenceUi.listenNow) intelligenceUi.listenNow.textContent = `${artist} — ${title}`;
  if (intelligenceUi.why) intelligenceUi.why.textContent = reasonSummary;
  if (intelligenceUi.novelty) intelligenceUi.novelty.textContent = novelty;
  if (!intelligenceUi.spotlight) return;

  intelligenceUi.spotlight.innerHTML = `
    <article class="spotlight-track">
      <div class="spotlight-art">
        <span class="spotlight-monogram">${escapeHtml(`${artist.charAt(0)}${title.charAt(0)}`.toUpperCase())}</span>
      </div>
      <div class="spotlight-body">
        <div class="spotlight-badges">
          <span class="music-badge${evidence.tone === 'success' ? ' music-badge--success' : evidence.tone === 'warning' ? ' music-badge--warning' : ''}">${escapeHtml(evidence.label)}</span>
          <span class="music-badge">${escapeHtml(scoreLabel)}</span>
          <span class="music-badge">${Object.hasOwn(state.ratings || {}, track.id) ? `Rated ${escapeHtml(state.ratings[track.id])}` : 'Unrated'}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p class="spotlight-artist">${escapeHtml(artist)}</p>
        <p class="spotlight-reason"><strong>Why this:</strong> ${escapeHtml(reason)}</p>
        <div class="spotlight-actions">
          ${spotifyAction}
          <a class="media-btn youtube" target="_blank" rel="noopener noreferrer" href="${escapeHtml(buildYouTubeSearchUrl(track))}">Search YouTube</a>
          ${inDeck ? '<span class="music-badge music-badge--success">In Listening Room</span>' : `<button type="button" data-action="spotlight-add" data-id="${escapeHtml(track.id)}">Add to Listening Room</button>`}
        </div>
      </div>
    </article>`;
}

function enhanceListeningDeckCards() {
  ui.listeningDeck?.querySelectorAll('.player-deck-card').forEach((card) => {
    if (card.querySelector(':scope > .track-tools')) return;
    const children = Array.from(card.children);
    const header = children.find((node) => node.classList?.contains('music-card-header'));
    const iframe = children.find((node) => node.tagName === 'IFRAME');
    const directMeta = children.filter((node) => node.classList?.contains('meta'));
    const mediaControls = children.find((node) => node.classList?.contains('media-controls'));
    const ratingControls = children.find((node) => node.classList?.contains('actions') && node.querySelector('[data-rate]'));
    const linksEditor = children.find((node) => node.classList?.contains('links-editor'));
    const tags = children.find((node) => node.classList?.contains('tags'));
    const feedback = children.find((node) => node.classList?.contains('feedback-input'));
    const feedbackActions = feedback?.nextElementSibling?.classList?.contains('actions') ? feedback.nextElementSibling : null;

    const summary = document.createElement('div');
    summary.className = 'player-card-summary';
    [header, ...directMeta, iframe, mediaControls, ratingControls].filter(Boolean).forEach((node) => summary.append(node));

    const details = document.createElement('details');
    details.className = 'track-tools';
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = 'Tune, verify & teach Stephanos';
    const detailsBody = document.createElement('div');
    detailsBody.className = 'track-tools__body';
    [linksEditor, tags, feedback, feedbackActions].filter(Boolean).forEach((node) => detailsBody.append(node));
    details.append(detailsSummary, detailsBody);
    card.prepend(summary);
    card.append(details);
  });
}

function jumpToDiscoveryPipeline() {
  const target = document.getElementById('discovery-pipeline-summary');
  if (!state.discoveryPipeline) { ui.status.textContent = 'No Discovery Pipeline yet. Build a journey first.'; return; }
  if (!target) { ui.status.textContent = 'Discovery Pipeline section not found.'; return; }
  const scroller = target.closest('#journey-col.col') || ui.discoveryResults?.closest('.col') || null;
  if (scroller) {
    const targetTop = target.getBoundingClientRect().top;
    const scrollerTop = scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + (targetTop - scrollerTop) - 12, behavior: 'smooth' });
  } else target.scrollIntoView({ behavior:'smooth', block:'start' });
  target.classList.remove('music-highlight-pulse');
  void target.offsetWidth;
  target.classList.add('music-highlight-pulse');
  window.setTimeout(() => target.classList.remove('music-highlight-pulse'), 1200);
  ui.status.textContent = 'Jumped to Discovery Pipeline.';
}

async function askAiInterpretFeedback(track, feedback) {
 const promptInstructions = `Return strict JSON only. No markdown. Schema:
{
  "summary": "short explanation",
  "positiveTraits": [{ "name": "serious trance DNA", "weightDelta": 1, "reason": "..." }],
  "negativeTraits": [{ "name": "too cheesy", "weightDelta": 1, "reason": "..." }],
  "confidence": "low|medium|high",
  "suggestedAction": "apply|review|ignore",
  "plainEnglish": "human readable explanation"
}`;
 const res = await askMusicAi('interpret-feedback', { track, feedback, tasteDNA: state.tasteDNA, promptInstructions });
 if (!res.ok) { setAiAction(`AI router unavailable: ${res.message}. Rule-based mode remains active.`, res.diagnostics || { lastError: res.error, reason: res.message }); return; }
 if (res.parsed && typeof res.parsed === 'object') {
   emitPresenceEvent({ kind: 'music.ai_response_structured', severity: 'info', summary: 'Music AI response parsed as structured JSON', impact: 'Structured trait suggestions are ready for review.', suggestedAction: 'Review and apply selected suggestions.' });
   renderAiSuggestion(res.parsed, track?.id, { fallbackText: '' });
   setAiAction('AI interpreted feedback. Review and approve suggestions before applying.', res.diagnostics);
 } else {
   emitPresenceEvent({ kind: 'music.ai_response_text_fallback', severity: 'notice', summary: 'Music AI response fell back to text mode', impact: 'Structured suggestions unavailable.', suggestedAction: 'Use rule-based parser or retry AI interpretation.' });
   renderAiSuggestion({}, track?.id, { fallbackText: res.text || '' });
   setAiAction('AI interpreted feedback in text fallback mode.', res.diagnostics);
 }
}
async function askAiTrackTask(trackId, task, successPrefix){ const track=state.listeningDeck.find((t)=>`${t.id}`===`${trackId}`); if(!track){ setAiAction('Track not found for AI request.'); return; } setAiAction('Contacting Stephanos AI for smarter journey…'); emitPresenceEvent({ kind: 'music.ai_smarter_journey_started', severity: 'info', summary: 'AI smarter journey started', impact: 'Waiting for AI candidates.' }); state.aiSmarterJourney=[{id:`ai-loading-${Date.now()}`, title:'AI Smarter Journey', summary:'Contacting Stephanos AI for smarter journey…', badge:'loading'}]; renderAiSuggestions(); const res=await askMusicAi(task,{ track, tasteDNA: state.tasteDNA, feedback: state.trackFeedback[trackId] || '' }); if(!res.ok){ setAiAction(`AI router unavailable: ${res.message}. Rule-based mode remains active.`, res.diagnostics || { lastError: res.error, reason: res.message }); return; } const summary = res.parsed?.summary || res.parsed?.failureSummary || res.text || 'AI response returned.'; ui.aiSuggestionPanel.innerHTML = `<h3>${successPrefix}</h3><div class="meta">${summary}</div>`; emitPresenceEvent({ kind: 'music.ai_more_like_this_generated', severity: 'info', summary: `${successPrefix} suggestions generated`, impact: 'Candidate branch suggestions are available for review.', suggestedAction: 'Add useful candidates to Listening Deck.' }); if (task === 'why-this-failed') emitPresenceEvent({ kind: 'music.ai_failure_analysis_generated', severity: 'notice', summary: 'Repeated reject pattern detected: flat/boring candidates.', impact: 'Failure explanation available with adjustment options.', suggestedAction: 'Apply negative trait update or keep partial reference.' }); setAiAction(`${successPrefix} completed.`, res.diagnostics); }
function renderAiSuggestion(parsed, trackId, options = {}) {
  const plus = Array.isArray(parsed.positiveTraits) ? parsed.positiveTraits : [];
  const minus = Array.isArray(parsed.negativeTraits) ? parsed.negativeTraits : [];
  const confidence = parsed.confidence || 'unknown';
  const summary = parsed.summary || '';
  const fallbackText = String(options.fallbackText || '').trim();
  const structured = plus.length > 0 || minus.length > 0 || summary;
  state.aiSuggestions = state.aiSuggestions || [];
  state.aiSuggestions.push({ id: `ai-${Date.now()}`, timestamp: new Date().toISOString(), actionId: options.actionId || 'unknown', type: structured ? 'feedback' : (fallbackText ? 'text-fallback' : 'error'), status: 'pending', title: structured ? 'AI suggested trait changes' : 'AI text fallback', summary: summary || fallbackText, plainText: fallbackText, structured: parsed, traitSuggestions: { plus, minus }, sourceTrackId: trackId || null, diagnostics: options.diagnostics || null });
  emitPresenceEvent({ kind: 'music.ai_suggestion_rendered', severity: 'info', summary: 'AI suggestion rendered', impact: 'Suggestion is now available in AI Suggestions panel.' });
  state.pendingAiSuggestion = structured ? { parsed, trackId } : null;
  if (!structured) {
    ui.aiSuggestionPanel.innerHTML = `<h3>AI interpretation</h3><div class="meta">${fallbackText || 'No AI text response returned.'}</div><div class="meta">Structured suggestions unavailable.</div><div class="meta">Rule-based parser remains available.</div>`;
    saveState(); renderAiSuggestions(); return;
  }
  ui.aiSuggestionPanel.innerHTML = `<h3>AI suggested trait changes</h3><div class="meta"><strong>Summary:</strong> ${summary || 'No structured summary returned.'}</div><div class="meta"><strong>Confidence:</strong> ${confidence}</div><div class="meta">${parsed.plainEnglish || ''}</div><div><strong>Positive trait suggestions</strong>${plus.map((p)=>`<label><input type="checkbox" data-ai-kind="plus" data-ai-name="${p.name}" data-ai-delta="${Number(p.weightDelta || 1)}" checked /> + ${p.name} (${Number(p.weightDelta || 1)}) — ${p.reason || ''}</label>`).join('') || '<div class="meta">No positive trait changes.</div>'}</div><div><strong>Negative trait suggestions</strong>${minus.map((p)=>`<label><input type="checkbox" data-ai-kind="minus" data-ai-name="${p.name}" data-ai-delta="${Number(p.weightDelta || 1)}" checked /> - ${p.name} (${Number(p.weightDelta || 1)}) — ${p.reason || ''}</label>`).join('') || '<div class="meta">No negative trait changes.</div>'}</div><div class="actions"><button id="apply-ai-all-btn" type="button">Apply all</button><button id="apply-ai-selected-btn" type="button" class="ghost">Apply selected</button><button id="reject-ai-btn" type="button" class="ghost">Reject suggestion</button></div>`;
  document.getElementById('apply-ai-all-btn')?.addEventListener('click', () => applyAiSuggestion(false));
  document.getElementById('apply-ai-selected-btn')?.addEventListener('click', () => applyAiSuggestion(true));
  document.getElementById('reject-ai-btn')?.addEventListener('click', rejectAiSuggestion);
  saveState(); renderAiSuggestions();
}
function applyAiSuggestion(selectedOnly=true) {
  const selected = Array.from(ui.aiSuggestionPanel.querySelectorAll('[data-ai-kind]')).filter((n)=>!selectedOnly || n.checked);
  const applyEntry = (entry, polarity) => {
    const name = String(entry.dataset.aiName || '').trim();
    if (!name) return;
    const delta = Number(entry.dataset.aiDelta || 1) || 1;
    ensureTrait(name, polarity, 1, 'ai-suggested');
    state.tasteDNA[name].weight = Number((state.tasteDNA[name].weight + delta).toFixed(2));
    state.tasteDNA[name].contributions = Number(state.tasteDNA[name].contributions || 0) + 1;
    state.tasteDNA[name].updatedAt = new Date().toISOString();
  };
  selected.filter((n)=>n.dataset.aiKind==='plus').forEach((entry)=>applyEntry(entry, 'positive'));
  selected.filter((n)=>n.dataset.aiKind==='minus').forEach((entry)=>applyEntry(entry, 'negative'));
  state.pendingAiSuggestion=null;
  state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState());
  saveState(); renderAll();
  emitPresenceEvent({ kind: 'music.ai_suggestion_applied', severity: 'info', summary: 'Music AI suggestions applied', impact: `Applied ${selected.length} AI suggestion(s) to Taste DNA.`, suggestedAction: 'Review Learning Signals and reranked journey candidates.' });
  setAiAction('AI suggestion applied with approval.');
}
function rejectAiSuggestion(){ state.pendingAiSuggestion=null; ui.aiSuggestionPanel.innerHTML='<h3>AI suggested trait changes</h3><div class="meta">Suggestion rejected.</div>'; emitPresenceEvent({ kind: 'music.ai_suggestion_rejected', severity: 'notice', summary: 'Music AI suggestion rejected', impact: 'No Taste DNA changes were applied.', suggestedAction: 'Retry AI interpretation or apply rule-based feedback.' }); setAiAction('AI suggestion rejected.'); }

function logBuildJourney(stage, payload = {}) { try { console.info('[music-tile]', stage, payload); } catch {} }
function setTerminalStatus(message) { if (ui.status) ui.status.textContent = message; logBuildJourney('terminal status', { message }); }
function emitJourneyBuildFailure(message, artist = '') {
  try {
    emitPresenceEvent({
      kind: 'journey_build_failed',
      severity: 'warning',
      summary: artist ? `Journey build failed for ${artist}` : 'Journey build failed',
      impact: String(message || 'The journey was not reported as ready.'),
      suggestedAction: 'Retry when storage and rendering are available, or choose another artist.',
    });
  } catch (eventError) {
    logBuildJourney('journey build failure event unavailable', {
      message: String(eventError?.message || eventError),
    });
  }
}
function emitJourneyBuildSuccess(artist, candidateCount) {
  try {
    emitPresenceEvent({
      kind: 'journey_built',
      severity: 'info',
      summary: `Journey built for ${artist}`,
      impact: `${candidateCount} candidates ready.`,
      suggestedAction: 'Start journey and rate tracks.',
    });
  } catch (eventError) {
    logBuildJourney('journey build success event unavailable', {
      message: String(eventError?.message || eventError),
    });
  }
}
function normalizeCandidate(candidate = {}, fallbackArtist = 'Unknown Artist', index = 0) {
  const title = String(candidate.title || candidate.name || '').trim();
  if (!title) return null;
  const artist = String(candidate.artist || fallbackArtist || 'Unknown Artist').trim() || 'Unknown Artist';
  const lane = String(candidate.lane || candidate.sourceArtistMatch || 'broad-fallback');
  const traits = Array.isArray(candidate.traits) ? candidate.traits : [];
  const avoidTraits = Array.isArray(candidate.avoidTraits) ? candidate.avoidTraits : [];
  const searchQueries = (candidate.searchQueries && typeof candidate.searchQueries === 'object' && !Array.isArray(candidate.searchQueries)) ? candidate.searchQueries : {};
  return {
    id: String(candidate.id || `${artist.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${index}`),
    title,
    artist,
    lane,
    sourceKind: String(candidate.sourceKind || 'fallback'),
    traits,
    avoidTraits,
    discoveryReason: String(candidate.discoveryReason || candidate.reason || 'Local taste match'),
    verificationStatus: String(candidate.verificationStatus || candidate.candidateVerificationStatus || ''),
    spotifyUrl: candidate.spotifyUrl || null,
    spotifyUri: candidate.spotifyUri || null,
    youtubeUrl: candidate.youtubeUrl || null,
    searchQueries,
    noveltyKey: String(candidate.noveltyKey || `${lane}:${artist}:${title}`),
    ...candidate,
  };
}
function normalizeCandidates(candidates = [], fallbackArtist = 'Unknown Artist') {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => normalizeCandidate(candidate, fallbackArtist, index)).filter(Boolean);
}
function safeRenderAll(context = 'render') { logBuildJourney('renderAll:start', { context }); try { renderAll(); logBuildJourney('renderAll:end', { context }); return true; } catch (error) { const msg = `Build failed: ${String(error?.message || error)}, fallback used`; setTerminalStatus(msg); logBuildJourney('caught error message and stack', { message: String(error?.message || error), stack: String(error?.stack || '') }); return false; } }


let integrationSetupSnapshot = null;
async function refreshIntegrationSetupStatus({ announce = true } = {}) { try { const response = await fetch('/api/setup/integrations'); const payload = await response.json(); const spotify = (payload.integrations || []).find((row) => row.id === 'spotify-catalog'); integrationSetupSnapshot = spotify || null; if (!spotify) return; const missing = Array.isArray(spotify.missingSecrets) ? spotify.missingSecrets : []; const missingLabel = missing.length ? missing.join(', ') : 'none'; if (ui.assistedSetupStatus) ui.assistedSetupStatus.innerHTML = `Spotify Catalogue Search · <strong>${spotify.status}</strong><br/>SPOTIFY_CLIENT_ID: ${spotify.requiredSecretPresence?.SPOTIFY_CLIENT_ID ? 'present' : 'missing'}<br/>SPOTIFY_CLIENT_SECRET: ${spotify.requiredSecretPresence?.SPOTIFY_CLIENT_SECRET ? 'present' : 'missing'}<br/>What it enables: Resolve Spotify links automatically for Music Tile.`; if (ui.assistedSetupPlan) ui.assistedSetupPlan.textContent = `Next action: ${spotify.nextAction}
Missing secrets: ${missingLabel}`; if (announce) { const kind = !spotify.configured ? 'setup.spotify_catalog_missing' : 'setup.spotify_catalog_configured'; emitPresenceEvent({ kind, severity: spotify.configured ? 'info' : 'warning', summary: spotify.configured ? 'Spotify catalog setup configured' : 'Spotify catalog setup missing', impact: spotify.nextAction, suggestedAction: spotify.nextAction }); } } catch { if (ui.assistedSetupStatus) ui.assistedSetupStatus.textContent = 'Assisted Setup unavailable. Check backend /api/setup/integrations.'; }}

function wireEvents() { ui.buildBtn?.addEventListener('click', buildJourney); ui.startBtn?.addEventListener('click', startJourney); ui.resetBtn?.addEventListener('click', resetAll); ui.resolveAllBtn?.addEventListener('click', resolveAllMissingLinks); ui.resolveAllAiBtn?.addEventListener('click', resolveAllMissingLinksAiAssisted); ui.resolveArtistSpotifyBtn?.addEventListener('click', resolveArtistOnSpotify); ui.jumpAiSmarterJourneyBtn?.addEventListener('click',()=>ui.aiSmarterJourneyPanel?.scrollIntoView({behavior:'smooth',block:'start'})); ui.addTraitBtn?.addEventListener('click', addCustomTrait); ui.aiBtn?.addEventListener('click', () => { ui.status.textContent = 'AI interpretation not connected yet. Rule-based interpretation applied.'; }); ui.aiBuildJourneyBtn?.addEventListener('click', buildJourneyAiAssisted); ui.synthesiseTasteDnaBtn?.addEventListener('click', synthesiseTasteDnaWithAi); ui.buildImmersionSessionBtn?.addEventListener('click', buildImmersionSessionWithAi); ui.aiSummariseDnaBtn?.addEventListener('click', summariseDnaWithAi); ui.aiSuggestTraitsBtn?.addEventListener('click', suggestTraitsWithAi); ui.testAiRouteBtn?.addEventListener('click', testAiRouteAction); ui.promoteMemoryBtn?.addEventListener('click', promoteTasteMemory); ui.addTrackBtn?.addEventListener('click', addTrackByUrl); ui.copyAiSuggestionsBtn?.addEventListener('click', ()=>copyTextAction('Copied AI Suggestions.', JSON.stringify(state.aiSuggestions || [], null, 2))); ui.copyJourneySummaryBtn?.addEventListener('click', ()=>copyTextAction('Copied Journey Summary.', JSON.stringify({ candidates: state.candidates || [], listeningDeck: state.listeningDeck || [] }, null, 2))); ui.exportJourneyJsonBtn?.addEventListener('click', ()=>copyTextAction('Exported Journey JSON.', JSON.stringify({ controls: {}, tasteDNA: state.tasteDNA, currentJourney: { candidates: state.candidates || [] }, aiSuggestions: state.aiSuggestions || [], immersionSession: state.immersionSession || state.aiImmersionSession || null, listeningQueue: state.listeningDeck || [], timestamp: new Date().toISOString() }, null, 2))); ui.copyCodexPromptBtn?.addEventListener('click', ()=>copyTextAction('Copied Codex Prompt.', `Improve music journey.\nTaste DNA:${JSON.stringify(state.tasteDNA)}\nJourney:${JSON.stringify(state.candidates || [])}`)); ui.setupViewStepsBtn?.addEventListener('click', ()=>{ ui.status.textContent = 'View setup steps: create Spotify app credentials, add backend .env entries, restart backend, then retest.'; }); ui.setupPrepareEnvBtn?.addEventListener('click', ()=>{ const block = 'SPOTIFY_CLIENT_ID=\nSPOTIFY_CLIENT_SECRET='; ui.assistedSetupPlan && (ui.assistedSetupPlan.textContent = `Copy into stephanos-server/.env (operator approval required):\n${block}\nRestart backend after saving.`); emitPresenceEvent({ kind: 'setup.secret_write_requires_approval', severity: 'warning', summary: 'Secret write requires operator approval', impact: 'Guided mode only: copy .env block manually.', requiresApproval: true }); }); ui.setupMarkAddedBtn?.addEventListener('click', ()=>refreshIntegrationSetupStatus({ announce: true })); ui.setupRetestBtn?.addEventListener('click', ()=>refreshIntegrationSetupStatus({ announce: true })); ui.setupTestSpotifyBtn?.addEventListener('click', async ()=>{ try { const r = await fetch('/api/music/spotify/search?q=Sevdaliza%20Save%20Me&type=track&limit=1'); const p = await r.json(); if (p?.configured && !p?.error) { emitPresenceEvent({ kind: 'setup.spotify_catalog_test_passed', severity: 'info', summary: 'Spotify catalog resolver test passed', impact: 'Route returned configured response.' }); ui.status.textContent = 'Spotify resolver test passed.'; } else { emitPresenceEvent({ kind: 'setup.spotify_catalog_test_failed', severity: 'warning', summary: 'Spotify catalog resolver test failed', impact: p?.error || 'Unknown Spotify resolver issue.' }); ui.status.textContent = p?.error || 'Spotify resolver test failed.'; } } catch (error) { emitPresenceEvent({ kind: 'setup.spotify_catalog_test_failed', severity: 'warning', summary: 'Spotify catalog resolver test failed', impact: String(error?.message || error) }); } }); ui.setupAskCodexBtn?.addEventListener('click', ()=>{ const mission = `Mission: Enable Spotify Catalogue Search for Music Tile
1) confirm backend route exists
2) confirm env vars present
3) guide operator credentials
4) test /api/music/spotify/search
5) verify Music Tile Resolve Spotify Link
6) report proof`; ui.assistedSetupPlan && (ui.assistedSetupPlan.textContent = mission); ui.status.textContent = 'Prepared Codex mission packet in Assisted Setup.'; }); ui.copyTasteDnaSummaryBtn?.addEventListener('click', ()=>copyTextAction('Copied Taste DNA Summary.', JSON.stringify({ strongestPositive: Object.entries(state.tasteDNA).filter(([,v])=>v.polarity !== 'negative').slice(0, 8), strongestNegative: Object.entries(state.tasteDNA).filter(([,v])=>v.polarity === 'negative').slice(0, 8), recentAppliedChanges: state.appliedTasteDnaChanges || [] }, null, 2))); }
async function copyTextAction(successMessage, text){ try { if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); ui.status.textContent = successMessage; emitPresenceEvent({ kind: 'music.export_copied', severity: 'info', summary: successMessage, impact: 'Export/copy completed.' }); return; } throw new Error('clipboard-unavailable'); } catch { ui.status.textContent = 'Clipboard unavailable. Select and copy manually.'; window.prompt('Clipboard unavailable. Copy manually:', text); emitPresenceEvent({ kind: 'music.export_failed', severity: 'warning', summary: 'Clipboard unavailable', impact: 'Manual copy fallback shown.' }); } }
function ensureTrait(trait, polarity = 'positive', weight = 1, category = 'experimental') { const normalized = String(trait || '').trim(); if (!normalized) return; if (!state.tasteDNA[normalized]) state.tasteDNA[normalized] = { weight: Number(weight) || 1, polarity, category, contributions: 0, custom: true, updatedAt: new Date().toISOString() }; }
function addCustomTrait() { const name = ui.addTraitName?.value?.trim(); if (!name) return; const polarity = ui.addTraitType?.value === 'negative' ? 'negative' : 'positive'; ensureTrait(name, polarity, Number(ui.addTraitWeight?.value || 1), 'experimental'); ui.addTraitName.value = ''; saveState(); renderAll(); }
function applyFeedback(id, text) { const result = parseFeedback(text); const track = state.listeningDeck.find((item) => `${item.id}` === `${id}`); const lower = String(text || '').toLowerCase(); const unverifiedSignal = /(not a real song|can't find it|could not find it|made up|hallucinated|artist is real but song isn't|artist is real however|not on spotify|not on youtube)/i.test(lower); if (unverifiedSignal && track?.aiSuggested) { const likelyHallucinated = /(not a real song|made up|hallucinated|artist is real but song isn't|artist is real however)/i.test(lower); track.candidateVerificationStatus = likelyHallucinated ? AI_CANDIDATE_STATUSES.likelyHallucinated : AI_CANDIDATE_STATUSES.notFound; track.verificationNote = 'User could not verify this track. Artist/reference may be real, title may be AI-generated.'; track.aiFitScore = Number(track.aiFitScore || 0) - 50; state.aiCandidateAudit = Array.isArray(state.aiCandidateAudit) ? state.aiCandidateAudit : []; state.aiCandidateAudit.push({ id: track.id, artist: track.artist || '', title: track.title || '', status: track.candidateVerificationStatus, feedback: String(text || ''), at: new Date().toISOString() }); state.feedbackHistory.push({ id, ...result, at: new Date().toISOString(), verificationOnly: true }); emitPresenceEvent({ kind: likelyHallucinated ? 'music.ai_candidate_hallucinated' : 'music.ai_candidate_unverified', severity: 'warning', summary: likelyHallucinated ? 'AI candidate likely hallucinated.' : 'AI candidate could not be verified.', impact: track.verificationNote, suggestedAction: 'Replace with verified link or keep as search-only candidate.' }); state.lastFeedbackInterpreted = result; state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderAll(); return; } state.feedbackHistory.push({ id, ...result, at: new Date().toISOString() }); const bump = (trait, polarity, delta) => { ensureTrait(trait, polarity, delta, polarity === 'negative' ? 'avoid' : 'core'); const rec = state.tasteDNA[trait]; rec.weight = Number((rec.weight + delta).toFixed(2)); rec.contributions += 1; rec.updatedAt = new Date().toISOString(); }; result.plus.forEach((trait) => bump(trait, 'positive', 0.6)); result.minus.forEach((trait) => bump(trait, 'negative', 0.8)); state.lastFeedbackInterpreted = result; emitPresenceEvent({ kind: 'feedback_applied', severity: 'notice', summary: 'Music feedback applied to Taste DNA', impact: 'Taste DNA weights updated from feedback.', suggestedAction: 'Review strongest positive and negative signals.' }); state.candidates = rankCandidatesByTaste(buildSeededCandidates(parseArtists(ui.artistInput?.value || '')[0] || 'anyma'), buildTasteWeightsForState()); saveState(); renderAll(); }
function buildTasteWeightsForState() { const learned = buildTasteWeights(state); for (const [trait, meta] of Object.entries(state.tasteDNA || {})) { if (meta.polarity === 'negative') learned.rejectWeights[trait.toLowerCase()] = Number(((learned.rejectWeights[trait.toLowerCase()] || 0) + Number(meta.weight || 0)).toFixed(2)); else learned.positiveWeights[trait.toLowerCase()] = Number(((learned.positiveWeights[trait.toLowerCase()] || 0) + Number(meta.weight || 0)).toFixed(2)); } return learned; }
async function buildJourney() {
  const artists = parseArtists(ui.artistInput?.value || '');
  if (!artists.length) {
    const message = 'Enter an artist to build a journey.';
    setTerminalStatus(message);
    return Object.freeze({ ok: false, message, candidateCount: 0 });
  }

  const term = artists[0];
  const normalized = normalizeArtistAlias(term);
  logBuildJourney('buildJourney:start', { artist: term });
  logBuildJourney('input value', { value: ui.artistInput?.value || '' });
  logBuildJourney('normalized artist key', { normalizedArtistKey: normalized });
  setTerminalStatus(`Building journey for: ${term}`);
  state.sessionCounter = Number(state.sessionCounter || 0) + 1;

  try {
    let rawCandidates = [];
    let resolverFailed = false;
    try {
      rawCandidates = buildSeededCandidates(term, { includeSeen: false });
    } catch (error) {
      resolverFailed = true;
      logBuildJourney('caught error message and stack', {
        message: String(error?.message || error),
        stack: String(error?.stack || ''),
      });
      rawCandidates = buildSeededCandidates('unknown artist', { includeSeen: false });
    }

    logBuildJourney('candidate count from resolver', { count: Array.isArray(rawCandidates) ? rawCandidates.length : 0 });
    logBuildJourney('first candidate shape', { first: rawCandidates?.[0] || null });
    const normalizedCandidates = normalizeCandidates(rawCandidates, normalized);
    state.candidates = rankCandidatesByTaste(normalizedCandidates, buildTasteWeightsForState());

    try {
      const pipeline = await runMusicDiscoveryPipeline({
        query: term,
        tasteDNA: state.tasteDNA,
        aiHints: state.aiSmarterJourney || [],
        localCandidates: state.candidates || [],
      });
      state.discoveryPipeline = {
        ...pipeline,
        generatedAt: new Date().toISOString(),
        artistProfile: pipeline.artistProfile || null,
      };
    } catch (pipelineError) {
      state.discoveryPipeline = {
        query: term,
        summary: 'Discovery Pipeline v2 unavailable; showing legacy/local discovery results.',
        verifiedCandidates: [],
        searchLeads: [],
        aiSuggestions: [],
        fallbackCandidates: [],
        warnings: [`Discovery Pipeline error: ${String(pipelineError?.message || pipelineError)}`],
        resultCount: 0,
        targetCount: DEFAULT_DISCOVERY_RESULT_TARGET,
        generatedAt: new Date().toISOString(),
      };
    }

    logBuildJourney('ranked candidate count', { count: state.candidates.length });
    if (!state.listeningDeck.length && state.candidates.length) state.listeningDeck = [state.candidates[0]];
    const meta = state.lastDiscoveryMeta || {};
    const status = meta.artistVerificationStatus || 'unresolved';
    let finalStatus = 'No candidates found';
    if (!state.candidates.length) finalStatus = 'No candidates found';
    else if (resolverFailed) finalStatus = 'Build failed: resolver exception, fallback used';
    else if (normalized === 'Y do I') finalStatus = 'Y do I recognised. Local candidate bank limited; showing Spotify search-led candidates.';
    else if (status === 'fallback-only' || status === 'unresolved') finalStatus = 'No artist bank found, broad fallback used';
    else finalStatus = `Built ${state.candidates.length} candidates for ${meta.canonicalArtist || term} — see Discovery Pipeline.`;

    saveState();
    if (!safeRenderAll('buildJourney')) {
      const message = 'Build failed while rendering the journey.';
      setTerminalStatus(message);
      emitJourneyBuildFailure(message, term);
      return Object.freeze({ ok: false, message, candidateCount: state.candidates.length });
    }
    const buildSucceeded = !resolverFailed && state.candidates.length > 0;
    if (!buildSucceeded) {
      setTerminalStatus(finalStatus);
      emitJourneyBuildFailure(finalStatus, term);
      return Object.freeze({ ok: false, message: finalStatus, candidateCount: state.candidates.length });
    }
    setTerminalStatus(finalStatus);
    emitJourneyBuildSuccess(term, state.candidates.length);
    return Object.freeze({ ok: true, message: finalStatus, candidateCount: state.candidates.length });
  } catch (error) {
    const message = `Build failed: ${String(error?.message || error)}, fallback used`;
    logBuildJourney('caught error message and stack', {
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
    });
    setTerminalStatus(message);
    safeRenderAll('buildJourney-error');
    emitJourneyBuildFailure(message, term);
    return Object.freeze({ ok: false, message, candidateCount: state.candidates.length });
  }
}
function startJourney() { const artists = parseArtists(ui.artistInput?.value || ''); if (!artists.length) { ui.status.textContent = 'Enter an artist to build a journey.'; return; } const term = artists[0]; if (!state.candidates.length) state.candidates = rankCandidatesByTaste(buildSeededCandidates(term), buildTasteWeightsForState()); if (!state.listeningDeck.length) state.listeningDeck = state.candidates.slice(0, 3); ui.status.textContent = `Starting journey for: ${term}.`; saveState(); renderAll(); }
function addTrackByUrl() { const raw = String(ui.addTrackUrlInput?.value || '').trim(); if (!raw) return; const spotify = resolveSpotifyReference(raw); const youtube = normalizeYouTubeUrl(raw); if (spotify.valid && spotify.type !== 'track') { ui.status.textContent = 'Paste a Spotify track URL to create a playable card.'; return; } if (!spotify.valid && !youtube) { ui.status.textContent = spotify.reason === 'search-url' ? 'This is a Spotify search link, not a playable track link. Open a result in Spotify and paste the track URL.' : 'Paste a valid Spotify track URL or YouTube URL.'; return; } const track = { id: `manual-${Date.now()}`, title: spotify.valid ? 'Spotify track' : 'YouTube track', artist: 'Unknown', spotifyUrl: spotify.valid ? spotify.openUrl : null, spotifyUri: spotify.valid ? spotify.uri : null, candidateVerificationStatus: spotify.valid ? AI_CANDIDATE_STATUSES.userConfirmed : AI_CANDIDATE_STATUSES.unverified, youtubeUrl: youtube || null, lane: 'Manual URL import' }; state.listeningDeck.unshift(track); ui.addTrackUrlInput.value = ''; ui.status.textContent = spotify.valid ? 'Spotify track verified. Listening Deck card updated.' : 'Add track by URL: added YouTube URL to Listening Deck.'; saveState(); renderListeningDeck(); }
function resetAll() { localStorage.removeItem(STORAGE_KEY); Object.assign(state, loadState()); ui.status.textContent = 'Reset complete.'; renderAll(); }
function renderAll() { renderTasteDNA(); renderCandidates(); renderListeningDeck(); renderDiscoveryResults(); renderAiSuggestions(); renderPendingTasteDnaChanges(); renderAppliedTasteDnaChanges(); renderImmersionSession(); renderJourneyQueue(); renderActiveJourneySummary(); renderMusicIntelligenceCentre(); }
function renderTasteDNA() { const anchors = Object.entries(state.tasteDNA).filter(([,meta]) => meta?.polarity !== 'negative' && Number(meta?.weight || 0) > 0).map(([name]) => name).filter(Boolean); ui.positiveAnchors.innerHTML = `<h3>✨ Positive anchors</h3>${anchors.length ? anchors.slice(0, 10).map((name) => `<div class="meta">${name}</div>`).join('') : '<div class="music-empty-state">🎯 No positive anchors yet. Rate tracks or add custom traits to shape your sound.</div>'}`; ui.rejectPatterns.innerHTML = '<h3>🚫 Reject patterns</h3>'; const counts = RATING_VALUES.reduce((acc, val) => ({ ...acc, [val]: 0 }), {}); for (const value of Object.values(state.ratings)) counts[value] = (counts[value] || 0) + 1; ui.ratingCounts.innerHTML = `<h3>Rating counts</h3><div class="card">${Object.entries(counts).map(([k,v]) => `<div>${k}: ${v}</div>`).join('')}</div>`; const weights = buildTasteWeightsForState(); const topPositive = topSignals(weights.positiveWeights); const topReject = topSignals(weights.rejectWeights); const recent = Object.entries(state.tasteDNA).sort((a,b)=>String(b[1].updatedAt||'').localeCompare(String(a[1].updatedAt||''))).slice(0,5).map(([k])=>k); ui.learningSignals.innerHTML = `<h3>🧬 Learning Signals</h3><div class="card dna-grid"><div><strong>Strongest positive</strong>${topPositive.map(([k,v])=>`<div class="dna-row dna-row--positive"><span>${k}</span><strong>+${v.toFixed(2)}</strong></div>`).join('') || '<div class="meta">None</div>'}</div><div><strong>Strongest negative</strong>${topReject.map(([k,v])=>`<div class="dna-row dna-row--negative"><span>${k}</span><strong>-${v.toFixed(2)}</strong></div>`).join('') || '<div class="meta">None</div>'}</div><div><strong>Recently changed</strong>${recent.map((x)=>`<div class="meta">${x}</div>`).join('') || '<div class="meta">None</div>'}</div><div class="meta"><strong>Ratings contributed</strong> ${Object.keys(state.ratings).length}</div><div class="meta"><strong>Last feedback interpreted</strong> ${state.lastFeedbackInterpreted?.raw || 'none yet'}</div></div>`; ui.traitRows.innerHTML = Object.entries(state.tasteDNA).map(([name, meta]) => `<div class="card trait-row"><strong>${name}</strong><div class="meta">${meta.polarity} · ${meta.category} · tracks ${meta.contributions}</div><div class="actions"><button data-action="weight-dec" data-trait="${name}">-</button><span data-weight="${name}">${Number(meta.weight).toFixed(2)}</span><button data-action="weight-inc" data-trait="${name}">+</button><input type="range" min="-5" max="10" step="0.2" value="${Number(meta.weight)}" data-action="weight-slider" data-trait="${name}" /></div></div>`).join(''); ui.traitRows.querySelectorAll('[data-action="weight-inc"]').forEach((btn)=>btn.addEventListener('click',()=>adjustTraitWeight(btn.dataset.trait,0.5))); ui.traitRows.querySelectorAll('[data-action="weight-dec"]').forEach((btn)=>btn.addEventListener('click',()=>adjustTraitWeight(btn.dataset.trait,-0.5))); ui.traitRows.querySelectorAll('[data-action="weight-slider"]').forEach((input)=>input.addEventListener('input',()=>setTraitWeight(input.dataset.trait, Number(input.value)))); }
function adjustTraitWeight(name, delta) { if (!state.tasteDNA[name]) return; state.tasteDNA[name].weight = Number((state.tasteDNA[name].weight + delta).toFixed(2)); state.tasteDNA[name].updatedAt = new Date().toISOString(); state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderAll(); }
function setTraitWeight(name, value) { if (!state.tasteDNA[name]) return; state.tasteDNA[name].weight = Number(value.toFixed(2)); state.tasteDNA[name].updatedAt = new Date().toISOString(); state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderAll(); }
function renderCandidates() { ui.candidateList.innerHTML = state.candidates.length ? state.candidates.map((track) => `<article class="card"><strong>${track.title || track.name || 'Unknown'}</strong><div class="meta">${track.artist || 'Unknown Artist'}</div><div class="meta">Local score: ${(track.tasteScore ?? 0).toFixed(2)}</div><div class="meta">AI fit score: ${Number(track.aiFitScore ?? 0).toFixed(0)}</div><div class="meta">Why this surfaced: Matched traits: ${track.why?.positiveHits?.join(', ') || 'none'}. Avoid flags: ${track.why?.rejectHits?.join(', ') || 'none'}. Final reason: ${track.aiReason || track.reason || 'Local taste match'}.</div><div class="actions"><button data-action="enqueue" data-id="${track.id}">Add to listening queue</button>${mediaActionLinks(track)}</div></article>`).join('') : '<div class="card">No candidates yet. Press Build Journey.</div>'; ui.candidateList.querySelectorAll('[data-action="enqueue"]').forEach((btn)=>btn.addEventListener('click',()=>{ const id = btn.getAttribute('data-id'); const found = state.candidates.find((t) => `${t.id}` === `${id}`); if (found && !state.listeningDeck.some((t) => t.id === found.id)) { state.listeningDeck.push(found); ui.status.textContent = `Added ${found?.title || 'track'} to Listening Deck.`; } else { ui.status.textContent = `${found?.title || 'Track'} is already in Listening Deck.`; } state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); renderAll(); })); }
function updateRatingPresentation(button, rating) {
  const trackId = button?.dataset?.id;
  const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`);
  const card = button?.closest?.('.player-deck-card');
  const ratingMeta = card?.querySelector('.music-card-header .music-card-meta');
  if (ratingMeta && track) ratingMeta.textContent = `${track.artist || 'Unknown Artist'} · rating ${rating}`;
  card?.querySelectorAll('[data-rate]').forEach((ratingButton) => {
    const selected = Number(ratingButton.dataset.rate) === Number(rating);
    ratingButton.classList.toggle('is-active', selected);
    ratingButton.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  renderTasteDNA();
  renderCandidates();
  renderJourneyQueue();
  renderMusicIntelligenceCentre();
}
function renderListeningDeck() { ui.listeningDeck.innerHTML = state.listeningDeck.length ? state.listeningDeck.map((track) => listeningCardMarkup(track)).join('') : '<div class="music-empty-state">🎵 Listening Deck is empty. Press <strong>Start Journey</strong> or add a track URL to begin.</div>'; ui.listeningDeck.querySelectorAll('[data-rate]').forEach((btn)=>btn.addEventListener('click',()=>{ state.ratings[btn.dataset.id] = Number(btn.dataset.rate); emitPresenceEvent({ kind: 'track_rated', severity: 'info', summary: `Track rated: ${btn.dataset.id} = ${btn.dataset.rate}`, impact: 'Taste DNA may strengthen from recent ratings.', suggestedAction: 'Build a new journey using updated Taste DNA.' }); state.candidates = rankCandidatesByTaste(state.candidates, buildTasteWeightsForState()); saveState(); updateRatingPresentation(btn, Number(btn.dataset.rate)); })); ui.listeningDeck.querySelectorAll('[data-tag]').forEach((btn)=>btn.addEventListener('click',()=>{ const { id, tag } = btn.dataset; const list = new Set(state.tags[id] || []); list.has(tag) ? list.delete(tag) : list.add(tag); state.tags[id] = Array.from(list); saveState(); renderAll(); })); ui.listeningDeck.querySelectorAll('[data-action="apply-feedback"]').forEach((btn)=>btn.addEventListener('click',()=>{ const id = btn.dataset.id; const field = ui.listeningDeck.querySelector(`[data-feedback-input="${id}"]`); state.trackFeedback[id] = field?.value || ''; applyFeedback(id, field?.value || ''); })); ui.listeningDeck.querySelectorAll('[data-action="save-spotify-link"]').forEach((btn)=>btn.addEventListener('click',()=>saveTrackSpotifyLink(btn.dataset.id))); ui.listeningDeck.querySelectorAll('[data-action="save-youtube-link"]').forEach((btn)=>btn.addEventListener('click',()=>saveTrackYouTubeLink(btn.dataset.id))); ui.listeningDeck.querySelectorAll('[data-action="resolve-spotify-link"]').forEach((btn)=>btn.addEventListener('click',()=>resolveSpotifyLink(btn.dataset.id))); ui.listeningDeck.querySelectorAll('[data-action="resolve-youtube-link"]').forEach((btn)=>btn.addEventListener('click',()=>resolveYouTubeLink(btn.dataset.id))); ui.listeningDeck.querySelectorAll('[data-action="ai-interpret-feedback"]').forEach((btn)=>btn.addEventListener('click',()=>{ const track=state.listeningDeck.find((t)=>`${t.id}`===`${btn.dataset.id}`); const field = ui.listeningDeck.querySelector(`[data-feedback-input="${btn.dataset.id}"]`); askAiInterpretFeedback(track, field?.value || state.trackFeedback[btn.dataset.id] || ''); })); ui.listeningDeck.querySelectorAll('[data-action="ai-why-worked"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'why-worked','Ask AI why this worked'))); ui.listeningDeck.querySelectorAll('[data-action="ai-more-like"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'more-like-this','More like this'))); ui.listeningDeck.querySelectorAll('[data-action="ai-less-like"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'less-like-this','Less like this'))); ui.listeningDeck.querySelectorAll('[data-action="ai-same-energy-darker"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'same-energy-darker','Same energy, darker'))); ui.listeningDeck.querySelectorAll('[data-action="ai-same-vocal-more-pressure"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'same-vocal-more-club-pressure','Same vocal, more club pressure'))); ui.listeningDeck.querySelectorAll('[data-action="ai-same-pressure-more-ghost"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'same-club-pressure-more-ghost','Same club pressure, more ghost'))); ui.listeningDeck.querySelectorAll('[data-action="ai-more-universal-nation"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'more-universal-nation-spine','More Universal Nation spine'))); ui.listeningDeck.querySelectorAll('[data-action="ai-less-cheese"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'less-cheese','Less cheese'))); ui.listeningDeck.querySelectorAll('[data-action="ai-less-goa"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'less-goa','Less Goa'))); ui.listeningDeck.querySelectorAll('[data-action="ai-more-echo-reverb"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'more-echo-reverb','More echo/reverb'))); ui.listeningDeck.querySelectorAll('[data-action="ai-why-failed"]').forEach((btn)=>btn.addEventListener('click',()=>askAiTrackTask(btn.dataset.id,'why-this-failed','Ask AI why this failed'))); ui.listeningDeck.querySelectorAll('[data-action="mark-verified"]').forEach((btn)=>btn.addEventListener('click',()=>markCandidateVerified(btn.dataset.id))); ui.listeningDeck.querySelectorAll('[data-action="mark-not-found"]').forEach((btn)=>btn.addEventListener('click',()=>markCandidateNotFound(btn.dataset.id))); ui.listeningDeck.querySelectorAll('[data-action="mark-hallucinated"]').forEach((btn)=>btn.addEventListener('click',()=>markCandidateHallucinated(btn.dataset.id))); ui.listeningDeck.querySelectorAll('[data-action="replace-verified-track"]').forEach((btn)=>btn.addEventListener('click',()=>replaceWithVerifiedTrack(btn.dataset.id))); enhanceListeningDeckCards(); }
function listeningCardMarkup(track) { const spotifyRef = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || ''); const verifiedCandidate = isVerifiedCandidateTrack(track); const hasPlayableSpotifyTrack = verifiedCandidate && spotifyRef.valid && spotifyRef.type === 'track'; const embed = hasPlayableSpotifyTrack ? spotifyRef.embedUrl : null; const spotifyOpenUrl = hasPlayableSpotifyTrack ? spotifyRef.openUrl : '';  const youtubeUrl = normalizeYouTubeUrl(track.youtubeUrl || ''); const rating = state.ratings[track.id]; const tags = state.tags[track.id] || []; const message = state.linkMessages?.[track.id] || ''; const status = getCandidateVerificationStatus(track); const aiVerificationBadge = track.aiSuggested ? `<span class="music-badge">${status === AI_CANDIDATE_STATUSES.unverified ? 'AI suggestion · unverified' : `AI suggestion · ${status}`}</span>` : ''; return `<article class="music-card player-deck-card"><div class="music-card-header"><div><div class="music-card-title">${escapeHtml(getDisplayTrackTitle(track))}</div><div class="music-card-meta">${track.artist || 'Unknown Artist'} · rating ${rating ?? 'unrated'}</div></div><span class="music-badge">▶ deck</span>${aiVerificationBadge}</div>${embed ? `<iframe src="${embed}" width="100%" height="152" style="border:0" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>` : `<div class="meta">${track.aiSuggested && status === AI_CANDIDATE_STATUSES.unverified ? 'Unverified AI candidate. Search before treating as real.' : (status === AI_CANDIDATE_STATUSES.likelyHallucinated ? 'Likely hallucinated candidate. Do not recommend again unless verified.' : 'Needs verified Spotify link')}</div>${track.verificationNote ? `<div class="meta">${track.verificationNote}</div>` : ''}`}<div class="actions media-controls">${spotifyOpenUrl ? `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${spotifyOpenUrl}">Open in Spotify</a>` : ''}<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${buildSpotifySearchUrl(track)}">Find on Spotify</a>${youtubeUrl ? `<a class="media-btn youtube" target="_blank" rel="noopener noreferrer" href="${youtubeUrl}">Open in YouTube</a>` : ''}<a class="media-btn youtube" target="_blank" rel="noopener noreferrer" href="${buildYouTubeSearchUrl(track)}">Find on YouTube</a>${track.aiSuggested ? `<div class="meta"><strong>Candidate Verification</strong></div><button type="button" data-action="mark-verified" data-id="${track.id}">Mark verified</button><button type="button" title="Mark not found" data-action="mark-not-found" data-id="${track.id}">Mark as not found</button><button type="button" data-action="mark-hallucinated" data-id="${track.id}">Mark hallucinated</button><button type="button" data-action="replace-verified-track" data-id="${track.id}">Replace with verified link</button>` : ''}</div><div class="links-editor"><label>Spotify URL<input data-link-input="spotify-${track.id}" placeholder="https://open.spotify.com/track/..." /></label><button data-action="save-spotify-link" data-id="${track.id}">Save Spotify link</button>${spotifyOpenUrl ? '' : `<button data-action="resolve-spotify-link" data-id="${track.id}">Resolve Spotify Link</button>`}<label>YouTube URL<input data-link-input="youtube-${track.id}" placeholder="https://www.youtube.com/watch?v=..." /></label><button data-action="save-youtube-link" data-id="${track.id}">Save YouTube link</button>${youtubeUrl ? '' : `<button data-action="resolve-youtube-link" data-id="${track.id}">Resolve YouTube Link</button>`}${message ? `<div class="meta">${message}</div>` : ''}</div><div class="actions">${RATING_VALUES.map((value) => `<button class="rating${Number(rating) === value ? ' is-active' : ''}" data-id="${track.id}" data-rate="${value}" aria-pressed="${Number(rating) === value ? 'true' : 'false'}">${value}</button>`).join('')}</div><div class="tags">${DEFAULT_POSITIVE_TRAITS.concat(DEFAULT_NEGATIVE_TRAITS).map((tag) => `<button class="tag" data-id="${track.id}" data-tag="${tag}">${tag}${tags.includes(tag) ? ' ✓' : ''}</button>`).join('')}</div><textarea data-feedback-input="${track.id}" class="feedback-input" placeholder="Tell the taste engine what you hear…">${state.trackFeedback[track.id] || ''}</textarea><div class="actions"><button type="button" data-action="apply-feedback" data-id="${track.id}">Apply feedback to Taste DNA</button><button type="button" data-action="ai-interpret-feedback" data-id="${track.id}">Ask AI to interpret feedback</button><button type="button" data-action="ai-why-worked" data-id="${track.id}">Ask AI why this worked</button><button type="button" data-action="ai-more-like" data-id="${track.id}">More like this</button><button type="button" data-action="ai-less-like" data-id="${track.id}">Less like this</button><button type="button" data-action="ai-same-energy-darker" data-id="${track.id}">Same energy, darker</button><button type="button" data-action="ai-same-vocal-more-pressure" data-id="${track.id}">Same vocal, more club pressure</button><button type="button" data-action="ai-same-pressure-more-ghost" data-id="${track.id}">Same club pressure, more ghost</button><button type="button" data-action="ai-more-universal-nation" data-id="${track.id}">More Universal Nation spine</button><button type="button" data-action="ai-less-cheese" data-id="${track.id}">Less cheese</button><button type="button" data-action="ai-less-goa" data-id="${track.id}">Less Goa</button><button type="button" data-action="ai-more-echo-reverb" data-id="${track.id}">More echo/reverb</button><button type="button" data-action="ai-why-failed" data-id="${track.id}">Ask AI why this failed</button></div></article>`; }
function saveTrackSpotifyLink(trackId) { const field = ui.listeningDeck.querySelector(`[data-link-input="spotify-${trackId}"]`); const value = String(field?.value || '').trim(); const parsed = resolveSpotifyReference(value); state.linkMessages = state.linkMessages || {}; if (!parsed.valid || parsed.type !== 'track') { if (parsed.reason === 'search-url') state.linkMessages[trackId] = 'Spotify search link or invalid link. Open a result in Spotify and paste the track URL.'; else if (parsed.valid && parsed.type !== 'track') state.linkMessages[trackId] = 'Paste a Spotify track URL to create a playable card.'; else state.linkMessages[trackId] = 'Spotify search link or invalid link. Paste a valid Spotify track URL.'; saveState(); renderListeningDeck(); return; } const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return; track.spotifyUrl = parsed.openUrl; track.spotifyUri = parsed.uri; track.candidateVerificationStatus = track.aiSuggested ? AI_CANDIDATE_STATUSES.userConfirmed : AI_CANDIDATE_STATUSES.verified; state.linkMessages[trackId] = 'Spotify track verified. Listening Deck card updated.'; saveState(); renderListeningDeck(); }
function markCandidateVerified(trackId) { const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return; track.candidateVerificationStatus = AI_CANDIDATE_STATUSES.verified; state.linkMessages = state.linkMessages || {}; state.linkMessages[trackId] = 'Marked verified.'; saveState(); renderListeningDeck(); }
function markCandidateNotFound(trackId) { const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return; track.candidateVerificationStatus = AI_CANDIDATE_STATUSES.notFound; track.aiFitScore = Number(track.aiFitScore || 0) - 35; state.linkMessages = state.linkMessages || {}; state.linkMessages[trackId] = 'Marked as not found. Try replacing with a verified track URL.'; emitPresenceEvent({ kind: 'music.ai_candidate_not_found', severity: 'warning', summary: 'AI candidate marked as not found.', impact: `${track.artist || 'Unknown artist'} - ${track.title || 'Unknown track'} not confirmed on services.`, suggestedAction: 'Replace with a verified track URL.' }); saveState(); renderListeningDeck(); }
function markCandidateHallucinated(trackId) { const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return; track.candidateVerificationStatus = AI_CANDIDATE_STATUSES.likelyHallucinated; track.aiFitScore = Number(track.aiFitScore || 0) - 80; state.aiCandidateAudit = Array.isArray(state.aiCandidateAudit) ? state.aiCandidateAudit : []; state.aiCandidateAudit.push({ id: track.id, status: AI_CANDIDATE_STATUSES.likelyHallucinated, artist: track.artist || '', title: track.title || '', at: new Date().toISOString() }); state.candidates = (state.candidates || []).filter((entry) => `${entry.id}` !== `${trackId}`); state.linkMessages = state.linkMessages || {}; state.linkMessages[trackId] = 'Marked hallucinated and removed from active discovery results.'; emitPresenceEvent({ kind: 'music.ai_candidate_hallucinated', severity: 'warning', summary: 'AI candidate marked hallucinated.', impact: 'Candidate removed from active discovery and retained in audit history.', suggestedAction: 'Prefer search query based discovery for this artist.' }); saveState(); renderAll(); }
function replaceWithVerifiedTrack(trackId) { const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return; track.candidateVerificationStatus = AI_CANDIDATE_STATUSES.searchOnly; state.linkMessages = state.linkMessages || {}; state.linkMessages[trackId] = 'Replace with verified track: paste a valid Spotify track URL.'; saveState(); renderListeningDeck(); }
function saveTrackYouTubeLink(trackId) { const field = ui.listeningDeck.querySelector(`[data-link-input="youtube-${trackId}"]`); const value = String(field?.value || '').trim(); const normalized = normalizeYouTubeUrl(value); state.linkMessages = state.linkMessages || {}; if (!normalized) { state.linkMessages[trackId] = 'Paste a valid YouTube URL.'; saveState(); renderListeningDeck(); return; } const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return; track.youtubeUrl = normalized; state.linkMessages[trackId] = 'YouTube link saved.'; saveState(); renderListeningDeck(); }
function mediaActionLinks(track) { const spotifyState = getSpotifyLinkState(track); const youtubeUrl = normalizeYouTubeUrl(track.youtubeUrl || ''); const spotifyAction = spotifyState.canOpenSpotify ? `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${spotifyState.openUrl}">Open in Spotify</a>` : `<span class="media-btn spotify blocked" title="Open in Spotify becomes available after a verified track URL is saved.">Needs verified Spotify link</span><a class="media-btn spotify neutral" target="_blank" rel="noopener noreferrer" href="${spotifyState.searchUrl}">Find on Spotify</a><button type="button" class="media-btn spotify resolve" data-action="resolve-spotify-link" data-id="${track.id}">Resolve Spotify Link</button>`; const youtubeLabel = youtubeUrl ? 'Open in YouTube' : 'Find on YouTube'; const youtubeHref = youtubeUrl || buildYouTubeSearchUrl(track); return `${spotifyAction}<a class="media-btn youtube" target="_blank" rel="noopener noreferrer" href="${youtubeHref}">${youtubeLabel}</a>`; }
function normalizeYouTubeUrl(input = '') { const raw = String(input || '').trim(); if (!raw) return ''; try { const url = new URL(raw); const host = url.hostname.toLowerCase(); if (host.includes('youtube.com') || host === 'youtu.be') return url.toString(); return ''; } catch { return ''; } }

function normalizeTrackIdentity(track) { return `${String(track.artist || '').trim().toLowerCase()}::${String(track.title || track.name || '').trim().toLowerCase()}`; }
function findSpotifyCandidate(track) { const identity = normalizeTrackIdentity(track); const catalog = [...TRACK_LIBRARY, ...SEEDED_TASTE_TRACKS];
  const matches = catalog.filter((item) => normalizeTrackIdentity(item) === identity).map((item) => {
    const parsed = resolveSpotifyReference(item.spotifyUrl || item.spotifyUri || '');
    return { item, parsed };
  }).filter((entry) => entry.parsed.valid && entry.parsed.type === 'track');
  if (!matches.length) return null;
  const first = matches[0];
  return { openUrl: first.parsed.openUrl, uri: first.parsed.uri, title: first.item.title || track.title, artist: first.item.artist || track.artist, confidence: matches.length === 1 ? 0.99 : 0.85 };
}

async function searchSpotifyCatalogForTrack(track) { const query = `${track.artist || ''} ${track.title || track.name || ''}`.trim(); const response = await fetch(`/api/music/spotify/search?q=${encodeURIComponent(query)}&type=track&limit=10`); const payload = await response.json(); return { query, payload }; }
function applyResolvedSpotifyTrack(track, candidate) { const parsed = resolveSpotifyReference(candidate.url || candidate.uri || ''); if (!parsed.valid || parsed.type !== 'track') return false; track.spotifyUrl = parsed.openUrl; track.spotifyUri = parsed.uri; track.candidateVerificationStatus = track.aiSuggested ? AI_CANDIDATE_STATUSES.userConfirmed : AI_CANDIDATE_STATUSES.verified; return true; }
async function resolveSpotifyLink(trackId) { const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return;
  state.linkMessages = state.linkMessages || {};
  const existing = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || '');
  if (existing.valid && existing.type === 'track') { state.linkMessages[trackId] = 'Spotify link already present.'; saveState(); renderListeningDeck(); return; }
  try {
    const { payload } = await searchSpotifyCatalogForTrack(track);
    if (!payload?.configured) { state.linkMessages[trackId] = 'Spotify catalog search not configured. Spotify catalogue search is not configured. Stephanos can help set it up. Open Assisted Setup, view required credentials, or continue with manual Spotify search and paste track URL.'; saveState(); renderListeningDeck(); return; }
    if (payload?.error) { state.linkMessages[trackId] = payload.error; saveState(); renderListeningDeck(); return; }
    const results = Array.isArray(payload?.results) ? payload.results : [];
    if (!results.length) { state.linkMessages[trackId] = 'No Spotify match found. Try search manually or paste URL.'; saveState(); renderListeningDeck(); return; }
    const top = results[0];
    const approved = window.confirm(`Use this Spotify track? ${top.artist} - ${top.title} (${top.confidence})`);
    if (!approved) { state.linkMessages[trackId] = 'Spotify match not applied. Use manual paste fallback or Find on Spotify.'; saveState(); renderListeningDeck(); return; }
    const applied = applyResolvedSpotifyTrack(track, top);
    state.linkMessages[trackId] = applied ? 'Spotify track verified. Listening Deck card updated.' : 'Resolver result was not a playable Spotify track URL.';
    saveState(); renderListeningDeck();
  } catch (error) {
    window.open(buildSpotifySearchUrl(track), '_blank', 'noopener,noreferrer');
    state.linkMessages[trackId] = 'Spotify catalog search failed. Use search/paste fallback.';
    saveState(); renderListeningDeck();
  }
}
function resolveYouTubeLink(trackId) { const track = state.listeningDeck.find((item) => `${item.id}` === `${trackId}`); if (!track) return;
  const youtubeUrl = normalizeYouTubeUrl(track.youtubeUrl || '');
  state.linkMessages = state.linkMessages || {};
  if (youtubeUrl) { state.linkMessages[trackId] = 'YouTube link already present.'; saveState(); renderListeningDeck(); return; }
  window.open(buildYouTubeSearchUrl(track), '_blank', 'noopener,noreferrer');
  state.linkMessages[trackId] = 'Opened YouTube search in a new tab. Paste URL if you pick one.'; saveState(); renderListeningDeck();
}
async function resolveAllMissingLinks() { const summary = { searched: 0, candidatesFound: 0, noMatch: 0, notConfigured: 0, errors: 0 }; for (const track of state.listeningDeck) { const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || ''); if (!spotify.valid || spotify.type !== 'track') { summary.searched += 1; try { const { payload } = await searchSpotifyCatalogForTrack(track); if (!payload?.configured) { summary.notConfigured += 1; continue; } if (payload?.error) { summary.errors += 1; continue; } if ((payload.results || []).length) summary.candidatesFound += 1; else summary.noMatch += 1; } catch { summary.errors += 1; } await resolveSpotifyLink(track.id); } const youtubeUrl = normalizeYouTubeUrl(track.youtubeUrl || ''); if (!youtubeUrl) resolveYouTubeLink(track.id); } ui.status.textContent = `Resolve all summary: searched ${summary.searched}, candidates ${summary.candidatesFound}, no match ${summary.noMatch}, not configured ${summary.notConfigured}, errors ${summary.errors}.`; }
async function resolveAllMissingLinksAiAssisted(){ setAiAction('Contacting Stephanos AI for smarter journey…'); emitPresenceEvent({ kind: 'music.ai_smarter_journey_started', severity: 'info', summary: 'AI smarter journey started', impact: 'Waiting for AI candidates.' }); state.aiSmarterJourney=[{id:`ai-loading-${Date.now()}`, title:'AI Smarter Journey', summary:'Contacting Stephanos AI for smarter journey…', badge:'loading'}]; renderAiSuggestions(); try { for (const track of state.listeningDeck){ const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || ''); const youtubeUrl = normalizeYouTubeUrl(track.youtubeUrl || ''); if (spotify.valid && spotify.type==='track' && youtubeUrl) continue; const res = await askMusicAi('resolve-links', { track, tasteDNA: state.tasteDNA, allowLiveVerification: getMusicAiStatus().freshWeb }); const parsed = res.parsed || {}; if (!res.ok) { state.linkMessages[track.id] = `AI router unavailable: ${res.message}. Open Spotify search or paste confirmed track URL.`; if (!spotify.valid || spotify.type!=='track') window.open(buildSpotifySearchUrl(track), '_blank', 'noopener,noreferrer'); if (!youtubeUrl) window.open(buildYouTubeSearchUrl(track), '_blank', 'noopener,noreferrer'); continue; } const candidateUrl = parsed.spotifyCandidates?.[0]?.url || ''; const candidateRef = resolveSpotifyReference(candidateUrl); if (parsed.status === 'candidate-found' && candidateRef.valid && candidateRef.type === 'track') { track.spotifyUrl = candidateRef.openUrl; track.spotifyUri = candidateRef.uri; state.linkMessages[track.id] = 'Spotify track verified. Listening Deck card updated.'; } else if (!spotify.valid || spotify.type!=='track') { state.linkMessages[track.id] = 'Spotify catalog search is not configured. Use Spotify search and paste a confirmed track URL.'; window.open(buildSpotifySearchUrl(track), '_blank', 'noopener,noreferrer'); } if (!youtubeUrl) window.open(buildYouTubeSearchUrl(track), '_blank', 'noopener,noreferrer'); } setAiAction('AI-assisted link resolution completed.'); saveState(); renderAll(); } catch (error) { setAiAction('AI router unavailable: request failed. Rule-based mode remains active.', { lastError: String(error?.message || error) }); } }
async function buildJourneyAiAssisted(){ const artists=parseArtists(ui.artistInput?.value || ''); if(!artists.length){ ui.status.textContent='Enter an artist to build a journey.'; return; } setAiAction('Contacting Stephanos AI for smarter journey…'); emitPresenceEvent({ kind: 'music.ai_smarter_journey_started', severity: 'info', summary: 'AI smarter journey started', impact: 'Waiting for AI candidates.' }); state.aiSmarterJourney=[{id:`ai-loading-${Date.now()}`, title:'AI Smarter Journey', summary:'Contacting Stephanos AI for smarter journey…', badge:'loading'}]; renderAiSuggestions(); const promptInstructions = `Return strict JSON only. No markdown. Do not invent track titles. If unsure, provide search query candidates instead of exact track claims. Only mark a track as verified if a real Spotify/YouTube/source URL is provided. Schema:
{
  "journeySummary": "...",
  "candidateHints": [{"title":"...","artist":"...","reason":"...","matchedTraits":["dark club pressure"],"avoidanceNotes":["not vocal trance cheese"],"spotifySearchQuery":"...","youtubeSearchQuery":"..."}],
  "avoid": ["cheesy vocal trance", "Goa / psy"],
  "confidence": "low|medium|high"
}`; const payload={ artist: artists[0], controls:{}, tasteDNA: state.tasteDNA, ratings: state.ratings, candidateBank: state.candidates, promptInstructions }; const res=await askMusicAi('build-journey', payload); if(!res.ok){ buildJourney(); setAiAction(`AI router unavailable: ${res.message}. Rule-based mode remains active.`, res.diagnostics || { lastError: res.error, reason: res.message }); return; } const p=res.parsed||{}; state.aiJourney=p; if(Array.isArray(p.candidateHints)){ state.aiSmarterJourney = p.candidateHints.map((h,ix)=>({ id:`ai-${Date.now()}-${ix}`, title:h.title || 'Unverified AI candidate', artist:h.artist || '', summary:h.reason || 'AI-guided candidate', reason:`Matched traits: ${(h.matchedTraits||[]).join(', ') || 'none'} · Avoid notes: ${(h.avoidanceNotes||[]).join(', ') || 'none'} · AI fit score: ${Number(h.aiFitScore||0) || 'n/a'}`, badge: h.title && h.artist ? 'AI suggested' : 'AI suggested · unverified', searchQuery:h.spotifySearchQuery || h.youtubeSearchQuery || `${h.artist || ''} ${h.title || ''}`.trim(), spotifySearchQuery:h.spotifySearchQuery || '', youtubeSearchQuery:h.youtubeSearchQuery || '' })); state.candidates = rankCandidatesByTaste(p.candidateHints.map((h,ix)=>{ const parsedSpotify = resolveSpotifyReference(h.spotifyUrl || h.sourceUrl || ''); const verified = parsedSpotify.valid && parsedSpotify.type === 'track'; return ({ id:`ai-${Date.now()}-${ix}`, title:h.title, artist:h.artist, why:{positiveHits:h.matchedTraits||[],rejectHits:h.avoidanceNotes||[]}, aiSuggested:true, aiReason:h.reason, spotifySearchQuery: h.spotifySearchQuery || '', youtubeSearchQuery: h.youtubeSearchQuery || '', spotifyUrl: verified ? parsedSpotify.openUrl : '', spotifyUri: verified ? parsedSpotify.uri : '', candidateVerificationStatus: verified ? AI_CANDIDATE_STATUSES.verified : AI_CANDIDATE_STATUSES.unverified }); }), buildTasteWeightsForState()); } else { state.aiSmarterJourney=[{id:`ai-text-${Date.now()}`, title:'AI text fallback', plainText:res.text || 'No AI text fallback body', summary:'Structured candidate schema unavailable', badge:'text fallback'}]; emitPresenceEvent({ kind: 'music.ai_smarter_journey_text_fallback', severity: 'notice', summary: 'AI smarter journey text fallback', impact: 'Structured candidate schema unavailable.' }); } saveState(); renderAll(); emitPresenceEvent({ kind: 'music.ai_smarter_journey_rendered', severity: 'info', summary: 'AI smarter journey rendered', impact: 'AI Smarter Journey section now has candidates.', suggestedAction: 'Review and add candidates.' }); emitPresenceEvent({ kind: 'music.ai_journey_built', severity: 'info', summary: 'New candidate branch surfaced: ghost vocals + Universal Nation spine.', impact: 'AI journey candidate hints are ready with trait reasons.', suggestedAction: 'Review cards and add to Listening Deck.' }); setAiAction('AI Smarter Journey ready — see AI Smarter Journey section.', res.diagnostics); }
async function summariseDnaWithAi(){ setAiAction('Contacting Stephanos AI for smarter journey…'); emitPresenceEvent({ kind: 'music.ai_smarter_journey_started', severity: 'info', summary: 'AI smarter journey started', impact: 'Waiting for AI candidates.' }); state.aiSmarterJourney=[{id:`ai-loading-${Date.now()}`, title:'AI Smarter Journey', summary:'Contacting Stephanos AI for smarter journey…', badge:'loading'}]; renderAiSuggestions(); const res=await askMusicAi('summarise-taste-dna',{ tasteDNA: state.tasteDNA, feedbackHistory: state.feedbackHistory }); if(!res.ok){ setAiAction(`AI router unavailable: ${res.message}. Rule-based mode remains active.`, res.diagnostics || { lastError: res.error, reason: res.message }); return; } setAiAction(res.parsed?.summary || res.text || 'AI summary returned.', res.diagnostics); }
async function suggestTraitsWithAi(){ setAiAction('Contacting Stephanos AI for smarter journey…'); emitPresenceEvent({ kind: 'music.ai_smarter_journey_started', severity: 'info', summary: 'AI smarter journey started', impact: 'Waiting for AI candidates.' }); state.aiSmarterJourney=[{id:`ai-loading-${Date.now()}`, title:'AI Smarter Journey', summary:'Contacting Stephanos AI for smarter journey…', badge:'loading'}]; renderAiSuggestions(); const res=await askMusicAi('suggest-traits',{ tasteDNA: state.tasteDNA, history: state.feedbackHistory }); if(res.ok){ renderAiSuggestion(res.parsed||{}, null); setAiAction('AI trait suggestions ready for review.', res.diagnostics); } else setAiAction(`AI router unavailable: ${res.message}. Rule-based mode remains active.`, res.diagnostics || { lastError: res.error, reason: res.message }); }

async function synthesiseTasteDnaWithAi(){ setAiAction('Contacting Stephanos AI for smarter journey…'); emitPresenceEvent({ kind: 'music.ai_smarter_journey_started', severity: 'info', summary: 'AI smarter journey started', impact: 'Waiting for AI candidates.' }); state.aiSmarterJourney=[{id:`ai-loading-${Date.now()}`, title:'AI Smarter Journey', summary:'Contacting Stephanos AI for smarter journey…', badge:'loading'}]; renderAiSuggestions(); const payload={ ratings: state.ratings, feedbackHistory: state.feedbackHistory, positiveTraits:Object.entries(state.tasteDNA).filter(([,v])=>v.polarity!=='negative'), negativeTraits:Object.entries(state.tasteDNA).filter(([,v])=>v.polarity==='negative'), acceptedSuggestions: state.feedbackHistory.slice(-8), rejectedSuggestions: [], anchors: DEFAULT_POSITIVE_TRAITS, rejects: DEFAULT_NEGATIVE_TRAITS, interestingTracks: state.listeningDeck.filter((t)=>Number(state.ratings[t.id]||0)>=1).slice(0,8) }; const res=await askMusicAi('synthesise-taste-dna', payload); if(!res.ok){ setAiAction(`AI router unavailable: ${res.message}. Rule-based mode remains active.`, res.diagnostics || { lastError: res.error, reason: res.message }); return; } const p=res.parsed||{}; state.pendingTasteDnaSynthesis = p; renderTasteDnaSynthesisPanel(p); setAiAction('Taste DNA synthesis ready for review.', res.diagnostics); emitPresenceEvent({ kind: 'music.ai_taste_dna_synthesised', severity: 'info', summary: 'Stephanos has refined the Music Taste DNA.', impact: 'Review and approve trait updates before applying.', suggestedAction: 'Apply all or apply selected.' }); }
function renderTasteDnaSynthesisPanel(parsed={}){ const plus=Array.isArray(parsed.strongPositiveTraits)?parsed.strongPositiveTraits:[]; const minus=Array.isArray(parsed.strongNegativeTraits)?parsed.strongNegativeTraits:[]; ui.aiSuggestionPanel.innerHTML = `<h3>Synthesise Taste DNA</h3><div class="meta">${parsed.tasteSummary||''}</div><div class="meta">Core identity: ${(parsed.coreIdentity||[]).join(', ')}</div><div><strong>Positive</strong>${plus.map((p)=>`<label><input type="checkbox" data-ai-kind="plus" data-ai-name="${p.name}" data-ai-delta="${Number(p.suggestedWeight||1)}" checked /> ${p.name} (${p.suggestedWeight}) — ${p.reason||''}</label>`).join('')}</div><div><strong>Negative</strong>${minus.map((p)=>`<label><input type="checkbox" data-ai-kind="minus" data-ai-name="${p.name}" data-ai-delta="${Number(p.suggestedWeight||1)}" checked /> ${p.name} (${p.suggestedWeight}) — ${p.reason||''}</label>`).join('')}</div><div class="meta">Emerging branches: ${(parsed.emergingBranches||[]).map((b)=>b.name).join(', ')}</div><div class="meta">Recommendation rules: ${(parsed.recommendationRules||[]).join(' | ')}</div><div class="actions"><button id="apply-ai-all-btn" type="button">Apply all</button><button id="apply-ai-selected-btn" type="button" class="ghost">Apply selected</button><button id="reject-ai-btn" type="button" class="ghost">Reject</button></div>`; document.getElementById('apply-ai-all-btn')?.addEventListener('click', () => applyAiSuggestion(false)); document.getElementById('apply-ai-selected-btn')?.addEventListener('click', () => applyAiSuggestion(true)); document.getElementById('reject-ai-btn')?.addEventListener('click', rejectAiSuggestion); }
function withTimeout(promise, timeoutMs, timeoutMessage='Request timed out'){ let timeoutId; const timeoutPromise = new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs); }); return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId)); }
function buildRuleBasedImmersionSession(artist='anyma', reason='AI unavailable'){ return { title: `${artist} immersion fallback session`, intent: `Rule-based immersion session generated from Taste DNA because ${reason}.`, mode: 'rule-fallback', phases: IMMERSION_FALLBACK_PHASES.map((phase) => ({ ...phase, candidateHints: IMMERSION_FALLBACK_CANDIDATES.map((candidate) => ({ title: candidate, artist: candidate, reason: `${phase.name} candidate hint`, spotifySearchQuery: `${candidate} ${phase.traits[0]}`, youtubeSearchQuery: `${candidate} ${phase.traits[0]}` })) })), diagnostics: { generatedAt: new Date().toISOString(), responseMode: 'rule-fallback' } }; }
function normalizeImmersionSession(parsed={}, artist='anyma'){ const session = (parsed && typeof parsed === 'object') ? parsed : {}; const phases = Array.isArray(session.phases) ? session.phases : []; return { ...session, title: session.title || `${artist} immersion session`, intent: session.intent || session.sessionIntent || 'AI-built immersion journey.', mode: 'structured-json', phases: phases.map((phase, index) => ({ name: phase.name || phase.phase || `Phase ${index + 1}`, description: phase.description || phase.summary || '', traits: Array.isArray(phase.traits) ? phase.traits : [], candidateHints: Array.isArray(phase.candidateHints) ? phase.candidateHints : [] })), diagnostics: session.diagnostics && typeof session.diagnostics === 'object' ? session.diagnostics : {} }; }
function renderImmersionTextFallback(artist, text){ const summary = text || 'AI returned text fallback without structured phase data.'; ui.aiSuggestionPanel.innerHTML = `<h3>${artist} immersion session (text fallback)</h3><div class="meta">${summary}</div><div class="meta">Use Build Immersion Session again to retry structured JSON output.</div>`; }

async function buildImmersionSessionWithAi(){
  const artist=parseArtists(ui.artistInput?.value||'')[0]||'anyma';
  const startedAt=new Date().toISOString();
  const endpoint=getMusicAiRuntimeDiagnostics().endpointUrl;
  const payload={ targetArtist:artist, duration:Number(ui.immersionDuration?.value||60), intensity:ui.immersionIntensity?.value||'medium', vocalAmount:ui.immersionVocalAmount?.value||'medium', darkness:ui.immersionDarkness?.value||'deep', tranceSpine:ui.immersionTranceSpine?.value||'medium', tasteDNA: state.tasteDNA };
  const previousDisabled=Boolean(ui.buildImmersionSessionBtn?.disabled);
  if (ui.buildImmersionSessionBtn) ui.buildImmersionSessionBtn.disabled=true;
  setAiAction('Contacting Stephanos AI for immersion session...', { requestStartedAt: startedAt, endpoint, responseKind: 'pending' });
  try {
    const res=await withTimeout(askMusicAi('build-immersion-session', payload), IMMERSION_REQUEST_TIMEOUT_MS, 'AI request timed out');
    const diagnostics={ ...(res.diagnostics||{}), requestStartedAt: startedAt, endpoint, responseStatus: res.status ?? 'n/a' };
    if(!res.ok){
      const fallback=buildRuleBasedImmersionSession(artist, res.message || 'AI unavailable');
      state.aiImmersionSession=fallback;
      renderAll();
      emitPresenceEvent({ kind:'music.ai_immersion_session_failed', severity:'warning', summary:`AI immersion session failed for ${artist}.`, impact:res.message||'No AI result.', suggestedAction:'Rule-based fallback session created.' });
      emitPresenceEvent({ kind:'music.immersion_session_rule_fallback', severity:'notice', summary:'Rule-based immersion session created', impact:'Fallback phases were generated locally from Taste DNA.', suggestedAction:'Review phases and add candidates to deck.' });
      setAiAction(`AI session build failed: ${res.message}. Rule-based immersion session created.`, { ...diagnostics, responseKind: 'rule-fallback', lastError: res.error || res.message });
      saveState();
      return;
    }
    if (res.parsed && typeof res.parsed === 'object') {
      state.aiImmersionSession=normalizeImmersionSession(res.parsed, artist);
      emitPresenceEvent({ kind:'music.ai_immersion_session_built', severity:'info', summary:`AI built an immersion session for ${artist}.`, impact:'Session phases available in Discovery Journey.', suggestedAction:'Add candidates to Listening Deck and rate them.' });
      setAiAction('Immersion session built.', { ...diagnostics, responseKind: 'structured-json' });
      saveState(); renderAll();
      return;
    }
    renderImmersionTextFallback(artist, res.text || '');
    emitPresenceEvent({ kind:'music.ai_immersion_session_text_fallback', severity:'notice', summary:'AI immersion session returned text fallback', impact:'Structured session schema unavailable.', suggestedAction:'Review text plan or retry for structured output.' });
    setAiAction('AI returned a text session plan.', { ...diagnostics, responseKind: 'text-fallback' });
  } catch (error) {
    const timeoutHit=String(error?.message||'').toLowerCase().includes('timed out');
    const fallback=buildRuleBasedImmersionSession(artist, timeoutHit ? 'AI request timed out' : (error?.message || 'request failed'));
    state.aiImmersionSession=fallback;
    renderAll();
    emitPresenceEvent({ kind:'music.ai_immersion_session_failed', severity:'warning', summary:'AI immersion session request failed', impact:String(error?.message || error), suggestedAction:'Rule-based fallback session created.' });
    emitPresenceEvent({ kind:'music.immersion_session_rule_fallback', severity:'notice', summary:'Rule-based immersion session created', impact:'Fallback phases were generated locally from Taste DNA.', suggestedAction:'Review phases and add candidates to deck.' });
    const statusLine = timeoutHit ? 'AI request timed out. Rule-based immersion session created.' : `AI session build failed: ${String(error?.message || error)}. Rule-based immersion session created.`;
    setAiAction(statusLine, { requestStartedAt: startedAt, endpoint, responseKind: timeoutHit ? 'timeout' : 'error', lastError: String(error?.message || error) });
    saveState();
  } finally {
    if (ui.buildImmersionSessionBtn) ui.buildImmersionSessionBtn.disabled=previousDisabled;
  }
}

function promoteTasteMemory(){ const summary='User strongly likes echo-heavy haunting female vocals; rejects cheesy vocal trance; Universal Nation / Cream Courtyard serious trance architecture core anchor.'; if(!window.confirm('Promote strong Taste DNA to Stephanos memory?')) return; if(!tileMemoryBridge){ ui.memoryStatus.textContent='Durable memory promotion not connected yet; local Music Tile memory is active.'; return; } const result = tileMemoryBridge.submitMemoryCandidate({ key:'music.taste_dna.core', value:summary, type:'preference', tags:['music','taste-dna'], sourceRef:'apps/music-tile/main.js', memoryReason:'Operator approved strong Taste DNA promotion from Music Tile.' }); ui.memoryStatus.textContent = result.promoted ? 'Taste DNA promoted to Stephanos memory.' : 'Memory promotion rejected by guardrails.'; }

function buildSeededCandidates(term, options = {}) { const result = buildArtistAwareCandidates({ artistInput: term, tasteDNA: state.tasteDNA, includeSeen: Boolean(options.includeSeen), recentlyShownIds: state.recentlyShownCandidateIds || [], sessionCounter: Number(state.sessionCounter || 0) }); const hasExact = Array.isArray(result.sourceKinds) && result.sourceKinds.includes('exact-artist'); const verificationStatus = options.spotifyVerified ? 'spotify-found' : (hasExact ? 'known-local' : (result.usedFallbackOnly ? 'fallback-only' : 'unresolved')); state.lastDiscoveryMeta = { query: result.query, usedFallbackOnly: result.usedFallbackOnly, sourceKinds: result.sourceKinds, artistVerificationStatus: verificationStatus, canonicalArtist: result.query?.canonicalArtistName || term }; state.recentlyShownCandidateIds = (state.recentlyShownCandidateIds || []).concat(result.candidates.map((c) => c.id)).slice(-40); return result.candidates; }
function resolveArtistOnSpotify() { const artists = parseArtists(ui.artistInput?.value || ''); if (!artists.length) { ui.status.textContent = 'Enter an artist to resolve on Spotify.'; return; } const artist = artists[0]; const encodedSearch = `https://open.spotify.com/search/${encodeURIComponent(artist)}`; window.open(encodedSearch, '_blank', 'noopener,noreferrer'); state.lastDiscoveryMeta = { ...(state.lastDiscoveryMeta || {}), artistVerificationStatus: 'spotify-found', canonicalArtist: artist, spotifySearchUrl: encodedSearch }; ui.status.textContent = `Opened Spotify search for ${artist}. Confirm in Spotify, then Build Journey.`; saveState(); renderAll(); }
function parseArtists(raw) { return raw.split(',').map((a) => a.trim()).filter(Boolean).map((name) => normalizeArtistAlias(name)); }
function normalizeArtistAlias(name = '') { const lower = String(name || '').trim().toLowerCase(); return lower === 'y do i' || lower === 'ydoi' ? 'Y do I' : String(name || '').trim(); }
function initialTasteDNA() { const map = {}; DEFAULT_POSITIVE_TRAITS.forEach((name)=>{ map[name] = { weight: 1, polarity: 'positive', category: 'core', contributions: 0, custom: false, updatedAt: '' }; }); DEFAULT_NEGATIVE_TRAITS.forEach((name)=>{ map[name] = { weight: 1, polarity: 'negative', category: name === 'too harsh' ? 'banned' : 'avoid', contributions: 0, custom: false, updatedAt: '' }; }); return map; }
function loadState() { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return { candidates: Array.isArray(saved.candidates) ? saved.candidates : [], listeningDeck: Array.isArray(saved.listeningDeck) ? saved.listeningDeck : [], ratings: saved.ratings && typeof saved.ratings === 'object' ? saved.ratings : {}, tags: saved.tags && typeof saved.tags === 'object' ? saved.tags : {}, tasteDNA: saved.tasteDNA && typeof saved.tasteDNA === 'object' ? saved.tasteDNA : initialTasteDNA(), feedbackHistory: Array.isArray(saved.feedbackHistory) ? saved.feedbackHistory : [], trackFeedback: saved.trackFeedback && typeof saved.trackFeedback === 'object' ? saved.trackFeedback : {}, linkMessages: saved.linkMessages && typeof saved.linkMessages === 'object' ? saved.linkMessages : {}, lastFeedbackInterpreted: saved.lastFeedbackInterpreted || null, aiSuggestions: Array.isArray(saved.aiSuggestions) ? saved.aiSuggestions : [], aiSmarterJourney: Array.isArray(saved.aiSmarterJourney) ? saved.aiSmarterJourney : [], pendingTasteDnaChanges: Array.isArray(saved.pendingTasteDnaChanges) ? saved.pendingTasteDnaChanges : [], appliedTasteDnaChanges: Array.isArray(saved.appliedTasteDnaChanges) ? saved.appliedTasteDnaChanges : [], immersionSession: saved.immersionSession && typeof saved.immersionSession === 'object' ? saved.immersionSession : null, recentlyShownCandidateIds: Array.isArray(saved.recentlyShownCandidateIds) ? saved.recentlyShownCandidateIds : [], sessionCounter: Number(saved.sessionCounter || 0), lastDiscoveryMeta: saved.lastDiscoveryMeta || null }; }
function saveState() { logBuildJourney('saveState:start'); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); logBuildJourney('saveState:end'); }


function renderAiResultPanel({title, sourceLabel, status='Structured', summary='', body='', actions=[]}){
  const cls = status.toLowerCase().includes('error') ? 'ai-result-panel--error' : status.toLowerCase().includes('text') ? 'ai-result-panel--text' : status.toLowerCase().includes('fallback') ? 'ai-result-panel--fallback' : status.toLowerCase().includes('pending') ? 'ai-result-panel--pending' : status.toLowerCase().includes('applied') ? 'ai-result-panel--applied' : 'ai-result-panel--structured';
  const time = new Date().toLocaleTimeString();
  return `<article class="ai-result-panel ${cls}"><div class="ai-result-header"><strong>${title}</strong><span class="meta">${sourceLabel}</span><span class="badge">${status}</span><span class="meta">${time}</span></div><div class="ai-result-body"><div class="meta">${summary}</div><div>${body}</div></div><div class="ai-result-actions">${actions.join('')}</div></article>`;
}
function renderAiSuggestions(){ if (!ui.aiSuggestionsList) return; const list = (state.aiSmarterJourney || []); ui.aiSuggestionsList.innerHTML = list.length ? list.slice().reverse().map((s)=>`<article class="music-card"><div class="music-card-header"><strong>${s.title || 'AI suggestion'}</strong><span class="music-badge music-badge--ai">${s.badge || 'AI suggested'}</span></div><div class="music-card-meta">${s.summary || s.plainText || 'No summary.'}</div><div class="music-card-meta">${s.reason || ''}</div><div class="music-card-meta">${s.searchQuery ? `Search query: ${s.searchQuery}` : ''}</div><div class="actions">${s.spotifySearchQuery ? `<a href="${buildSpotifySearchUrl({ artist: s.artist || '', title: s.title || s.spotifySearchQuery })}" target="_blank" rel="noopener noreferrer">Find on Spotify</a>` : ''}${s.youtubeSearchQuery ? `<a href="${buildYouTubeSearchUrl({ artist: s.artist || '', title: s.title || s.youtubeSearchQuery })}" target="_blank" rel="noopener noreferrer">Find on YouTube</a>` : ''}<button data-ai-action="add-discovery" data-id="${s.id}">Add to Discovery Results</button><button data-ai-action="add-deck" data-id="${s.id}">Add to Listening Deck</button></div></article>`).join('') : '<div class="music-empty-state">No AI smarter journey yet. Click "Ask AI to build smarter journey" to generate one.</div>'; ui.aiSuggestionsList.querySelectorAll('[data-ai-action="add-discovery"]').forEach((btn)=>btn.addEventListener('click',()=>{ const row=(state.aiSmarterJourney||[]).find((x)=>`${x.id}`===`${btn.dataset.id}`); if(!row)return; state.candidates=[row,...state.candidates].slice(0,DEFAULT_DISCOVERY_RESULT_TARGET); ui.status.textContent='AI Smarter Journey ready — see AI Smarter Journey section.'; saveState(); renderAll(); })); ui.aiSuggestionsList.querySelectorAll('[data-ai-action="add-deck"]').forEach((btn)=>btn.addEventListener('click',()=>{ const row=(state.aiSmarterJourney||[]).find((x)=>`${x.id}`===`${btn.dataset.id}`); if(!row)return; if(!state.listeningDeck.some((x)=>x.id===row.id)) state.listeningDeck.push(row); ui.status.textContent='AI Smarter Journey ready — see AI Smarter Journey section.'; saveState(); renderAll(); })); }
function renderPendingTasteDnaChanges(){ if (!ui.pendingTasteChanges) return; const rows = (state.pendingTasteDnaChanges || []).filter((x)=>x.status==='pending'); ui.pendingTasteChanges.innerHTML = `<h3>⏳ Pending Taste DNA Changes</h3>${rows.length ? rows.map((c)=>`<div class="dna-row ${c.weightDelta >= 0 ? 'dna-row--positive' : 'dna-row--negative'}"><span>${c.traitName}</span><strong>${c.currentWeight} → ${c.proposedWeight} (${c.weightDelta >= 0 ? '+' : ''}${c.weightDelta})</strong></div>`).join('') : '<div class="music-empty-state">🧪 No pending suggestions. New AI updates will appear here for one-click approval.</div>'}`; }
function renderAppliedTasteDnaChanges(){ if (!ui.appliedTasteChanges) return; const rows = state.appliedTasteDnaChanges || []; ui.appliedTasteChanges.innerHTML = `<h3>✅ Recently Applied Taste DNA Changes</h3>${rows.length ? rows.slice(-8).reverse().map((c)=>`<div class="meta">${c.traitName}: ${c.oldWeight} → ${c.newWeight} (${c.reason || 'applied'})</div>`).join('') : '<div class="music-empty-state">📭 No AI Taste DNA changes applied yet.</div>'}`; }
function renderImmersionSession(){ if (!ui.immersionSessionPanel) return; const session = state.immersionSession || state.aiImmersionSession; if (!session) { ui.immersionSessionPanel.innerHTML = '<h3>Immersion Session</h3><div class="music-empty-state">No immersion session yet. Build one from current Taste DNA.</div>'; return; } ui.immersionSessionPanel.innerHTML = `<h3>Immersion Session</h3><div class="music-card"><div class="music-card-title">${session.title || 'Session'}</div><div class="music-card-meta">${session.intent || ''}</div></div>${(session.phases||[]).map((p)=>`<article class="music-card"><div class="music-card-title">${p.name}</div><div class="music-card-meta">${p.description || ''}</div><div class="tags">${(p.traits||[]).map((t)=>`<span class='music-chip music-chip--positive'>${t}</span>`).join('')}</div></article>`).join('')}`; }
function renderJourneyQueue(){ if (!ui.journeyQueue) return; const rows = state.candidates || []; ui.journeyQueue.innerHTML = rows.length ? rows.slice(0,8).map((t)=>`<article class="card"><strong>${t.title || 'Unknown'}</strong><div class="meta">${t.artist || 'Unknown'} · ${(t.tasteScore ?? 0).toFixed(2)} · ${t.aiSuggested ? 'AI suggested' : 'seeded'}</div></article>`).join('') : '<div class="meta">No journey candidates yet. Build a journey or add AI suggestions.</div>'; }
function renderDiscoveryResults(){ if (!ui.discoveryResults) return; const p = state.discoveryPipeline || null; const renderRows = (rows, emptyText, kind, limit = 999) => rows?.length ? rows.slice(0, limit).map((track)=>{ const spotify = resolveSpotifyReference(track.spotifyUrl || track.spotifyUri || ''); const verified = spotify.valid && spotify.type === 'track'; const embed = kind === 'verified' && verified ? `<iframe src="${spotify.embedUrl}" width="100%" height="152" style="border:0" loading="lazy"></iframe>` : ''; const searchButtons = `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${buildSpotifySearchUrl(track)}">Search Spotify</a><a class="media-btn youtube" target="_blank" rel="noopener noreferrer" href="${buildYouTubeSearchUrl(track)}">Search YouTube</a>`; return `<article class="music-card"><div class="music-card-header"><div><div class="music-card-title">${track.title || 'Unknown'}</div><div class="music-card-meta">${track.artist || p?.query || 'Unknown'}</div></div><span class="music-badge">${kind === 'verified' ? (track.candidateVerificationStatus || 'verified') : (kind === 'ai' ? 'AI suggested · unverified' : 'Search lead')}</span></div><div class="music-card-meta">${track.reason || track.discoveryReason || 'Discovery pipeline candidate'}</div><div class="music-card-meta">Matched traits: ${(track.why?.positiveHits || track.why || []).join(', ') || 'none'} · final score ${Number(track.finalScore || track.tasteScore || 0).toFixed(2)}</div>${embed}<div class="actions">${kind === 'verified' && verified ? `<a class="media-btn spotify" target="_blank" rel="noopener noreferrer" href="${spotify.openUrl}">Open in Spotify</a>` : ''}${searchButtons}<button data-action="enqueue" data-id="${track.id}">Add to Listening Deck</button></div></article>`; }).join('') : `<div class="music-empty-state">${emptyText}</div>`;
  if (!p) { ui.discoveryResults.innerHTML = '<div class="music-card">Discovery Pipeline v2 unavailable; showing Legacy / local results only.</div>'; return; }
  ui.discoveryResults.innerHTML = `<section id="discovery-pipeline-summary" class="music-card"><h3>Discovery Pipeline Summary</h3><div class="meta">${p.summary || 'Pipeline summary unavailable.'}</div><div class="meta">artist input: ${ui.artistInput?.value || p.query || 'unknown'} · canonical/profile status: ${p.artistProfileStatus || 'unresolved'} · result counts: ${(p.resultCount ?? (state.candidates || []).length)} / target ${(p.targetCount ?? DEFAULT_DISCOVERY_RESULT_TARGET)}</div><div class="meta">candidate count: ${(state.candidates || []).length} · search lead count: ${(p.searchLeads || []).length} · verified count: ${(p.verifiedCandidates || []).length} · fallback count: ${(p.fallbackCandidates || []).length}</div><div class="meta">generated timestamp: ${p.generatedAt || 'n/a'}</div><div class="meta">pipeline present: ${p ? 'yes' : 'no'} · query: ${p.query || 'unknown'} · sections counts: candidates ${(state.candidates || []).length}, search leads ${(p.searchLeads || []).length}, verified ${(p.verifiedCandidates || []).length}, fallback ${(p.fallbackCandidates || []).length}</div><div class="actions"><button id="jump-discovery-pipeline-btn" data-action="jump-discovery-pipeline" type="button" class="ghost">Jump to Discovery Pipeline</button></div></section><section><h3>Search Leads</h3><div class="meta">Search-only candidates that still need verification.</div>${renderRows(p.searchLeads, 'Search leads available.', 'search', 5)}</section><section><h3>Verified Candidates</h3><div class="meta">Playable or user-confirmed entries only.</div>${renderRows(p.verifiedCandidates, 'No verified candidates yet.', 'verified', 5)}</section><section><h3>Fallback Taste DNA Matches</h3><div class="meta">Fallback lane used when artist catalog confidence is limited.</div>${renderRows(p.fallbackCandidates, 'No fallback candidates needed for this journey.', 'fallback', 5)}</section><section><h3>Reality / Verification Warnings</h3>${(p.warnings || []).length ? (p.warnings || []).map((w)=>`<div class="meta">• ${w}</div>`).join('') : '<div class="music-empty-state">No warnings.</div>'}</section><section><h3>Verification Audit</h3>${(state.aiCandidateAudit || []).length ? (state.aiCandidateAudit || []).slice(-8).reverse().map((a)=>`<div class="meta">${a.artist || p.query || 'Unknown'} - ${a.title || 'Unknown'} · ${a.status} · ${a.at || ''}</div>`).join('') : '<div class="music-empty-state">No audit entries yet.</div>'}</section><section><h3>AI Smarter Journey</h3><div class="meta">AI-guided candidates remain separate from normal Build Journey output.</div></section><section><h3>Discovery Results (Legacy / local results — secondary)</h3>${(state.candidates || []).length ? (state.candidates || []).slice(0,4).map((track)=>`<div class="meta">${track.artist || 'Unknown'} - ${track.title || 'Unknown'}</div>`).join('') : '<div class="music-empty-state">No legacy local results.</div>'}</section>`;
  ui.discoveryResults.querySelector('[data-action="jump-discovery-pipeline"]')?.addEventListener('click', jumpToDiscoveryPipeline);
}
function renderActiveJourneySummary(){ if (!ui.activeJourneySummary) return; ui.activeJourneySummary.textContent = state.candidates?.length ? `${state.candidates.length} journey candidates · ${state.listeningDeck?.length || 0} in listening deck.` : 'No active journey yet.'; }
