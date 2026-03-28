import { TRACK_LIBRARY } from './data/trackLibrary.js';
import { buildJourney } from './engine/journeyBuilder.js';
import { DEFAULT_SELECTION, loadMusicTileState, saveMusicTileState, resetMusicTileState } from './state/musicTileState.js';
import { resolveYouTubeLink } from './utils/youtubeLinkResolver.js';

const elements = {
  root: document.getElementById('music-tile-root'),
  era: document.getElementById('era-select'),
  energy: document.getElementById('energy-select'),
  emotion: document.getElementById('emotion-select'),
  density: document.getElementById('density-select'),
  build: document.getElementById('build-journey-btn'),
  reset: document.getElementById('reset-btn'),
  openFirst: document.getElementById('open-first-btn'),
  openAll: document.getElementById('open-all-btn'),
  summary: document.getElementById('summary-grid'),
  journey: document.getElementById('journey-list'),
  debugToggle: document.getElementById('debug-toggle'),
  debugPanel: document.getElementById('debug-panel'),
  debugOutput: document.getElementById('debug-output')
};

const state = {
  selection: { ...DEFAULT_SELECTION },
  lastJourney: null,
  debugVisible: false
};

function getSelectionFromUI() {
  return {
    era: elements.era.value,
    energyCurve: elements.energy.value,
    emotion: elements.emotion.value,
    density: elements.density.value
  };
}

function applySelectionToUI(selection) {
  elements.era.value = selection.era;
  elements.energy.value = selection.energyCurve;
  elements.emotion.value = selection.emotion;
  elements.density.value = selection.density;
  elements.root.dataset.theme = selection.era;
}

function renderSummary(result) {
  const bpm = `${result.intent.bpmRange[0]}-${result.intent.bpmRange[1]} BPM`;

  elements.summary.innerHTML = [
    ['Detected Vibe', result.detectedVibe],
    ['BPM Range', bpm],
    ['Transition Style', result.intent.transitionStyle],
    ['Visual Theme', result.intent.visualTheme],
    ['Recommended Tags', result.intent.recommendedTags.join(', ')]
  ].map(([label, value]) => `
    <article class="summary-card">
      <strong>${label}</strong>
      <span>${value}</span>
    </article>
  `).join('');
}

function renderJourney(result) {
  if (!result.journey.length) {
    elements.journey.innerHTML = '<li class="journey-item">No matching tracks found for this intent.</li>';
    return;
  }

  elements.journey.innerHTML = result.journey.map((track, index) => {
    const link = resolveYouTubeLink(track);
    return `
    <li class="journey-item" data-link-mode="${link.mode}">
      <div><strong>${index + 1}. ${track.title}</strong> — ${track.artist}</div>
      <div class="track-meta">~${track.approximateBpm} BPM • ${track.notes} • Link mode: ${link.mode}</div>
      <div class="track-actions"><a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.actionLabel}</a></div>
    </li>
  `;
  }).join('');
}

function renderDebug() {
  if (!state.lastJourney) {
    elements.debugOutput.textContent = 'Build a journey to inspect ranked output.';
    return;
  }

  const rankedPreview = state.lastJourney.ranked.slice(0, 10).map((entry, index) => ({
    rank: index + 1,
    score: entry.score,
    id: entry.track.id,
    title: entry.track.title,
    artist: entry.track.artist,
    bpm: entry.track.approximateBpm
  }));

  elements.debugOutput.textContent = JSON.stringify({
    selection: state.selection,
    intent: state.lastJourney.intent,
    rankedPreview,
    finalJourneyIds: state.lastJourney.journey.map((track) => track.id)
  }, null, 2);
}

function buildAndRenderJourney({ persistSelection = true } = {}) {
  state.selection = getSelectionFromUI();
  if (persistSelection) {
    saveMusicTileState(state.selection);
  }

  const result = buildJourney(state.selection, TRACK_LIBRARY);
  state.lastJourney = result;

  renderSummary(result);
  renderJourney(result);
  renderDebug();

  console.info('[MusicTile] Journey built', {
    selection: state.selection,
    vibe: result.detectedVibe,
    topTrack: result.journey[0]?.id || null
  });
}

function resetSelection() {
  const resetState = resetMusicTileState();
  state.selection = resetState.selection;
  applySelectionToUI(state.selection);
  buildAndRenderJourney();
}

function openFirstTrack() {
  const first = state.lastJourney?.journey?.[0];
  if (!first) {
    return;
  }

  const link = resolveYouTubeLink(first);
  window.open(link.url, '_blank', 'noopener,noreferrer');
}

function openFullJourney() {
  const tracks = state.lastJourney?.journey || [];
  tracks.forEach((track, index) => {
    window.setTimeout(() => {
      const link = resolveYouTubeLink(track);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    }, index * 250);
  });
}

function initialize() {
  loadMusicTileState().then((persisted) => {
    state.selection = persisted.selection;
    applySelectionToUI(state.selection);
    buildAndRenderJourney({ persistSelection: false });
    console.info('[TILE DATA][music-tile] hydrate', {
      appId: 'music-tile',
      sourceUsedOnLoad: persisted?.__tileDataMeta?.source || 'unknown',
      backendDiagnostics: persisted?.__tileDataMeta?.diagnostics || null
    });
  });

  elements.build.addEventListener('click', buildAndRenderJourney);
  elements.reset.addEventListener('click', resetSelection);
  elements.openFirst.addEventListener('click', openFirstTrack);
  elements.openAll.addEventListener('click', openFullJourney);

  [elements.era, elements.energy, elements.emotion, elements.density].forEach((control) => {
    control.addEventListener('change', () => {
      state.selection = getSelectionFromUI();
      elements.root.dataset.theme = state.selection.era;
      saveMusicTileState(state.selection);
    });
  });

  elements.debugToggle.addEventListener('click', () => {
    state.debugVisible = !state.debugVisible;
    elements.debugPanel.hidden = !state.debugVisible;
  });
}

initialize();
