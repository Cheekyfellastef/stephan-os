import { buildTasteWeights, rankCandidatesByTaste } from './tasteLearning.js';
import { runMusicDiscoveryPipeline } from './musicDiscoveryPipeline.js';
import {
  catalogResultToMusicTileTrack,
  requestNativeCatalogSearch,
} from './nativeCatalogSearch.js';
import {
  dedupeFreshJourneyCandidates,
  journeyCandidateKeys,
  planFreshJourneyState,
} from './freshJourneyPlanner.js';

const STORAGE_KEY = 'stephanos.musicTile.dashboardState.v1';
const FRESHNESS_STORAGE_KEY = 'stephanos.musicTile.freshJourneyState.v1';
const CATALOGUE_TIMEOUT_MS = 6000;
const CATALOGUE_LIMIT = 10;
let controllerInstalled = false;
let journeyInFlight = false;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function browserStorage() {
  try {
    const storage = globalThis.localStorage;
    return storage
      && typeof storage.getItem === 'function'
      && typeof storage.setItem === 'function'
      && typeof storage.removeItem === 'function'
      ? storage
      : null;
  } catch {
    return null;
  }
}

function readStoredObject(storage, key) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readMusicState(storage = browserStorage()) {
  return readStoredObject(storage, STORAGE_KEY);
}

function readFreshnessLedger(storage = browserStorage()) {
  const parsed = readStoredObject(storage, FRESHNESS_STORAGE_KEY);
  if (!parsed) {
    return {
      schemaVersion: 1,
      journeyHistoryKeys: [],
      recentlyShownCandidateIds: [],
      lastFreshJourneySummary: null,
      lastFreshJourneyNotice: '',
      updatedAt: '',
    };
  }
  return {
    schemaVersion: 1,
    journeyHistoryKeys: safeArray(parsed.journeyHistoryKeys)
      .map((key) => String(key || '').trim())
      .filter(Boolean)
      .slice(-240),
    recentlyShownCandidateIds: safeArray(parsed.recentlyShownCandidateIds)
      .map((id) => String(id || '').trim())
      .filter(Boolean)
      .slice(-120),
    lastFreshJourneySummary: safeObject(parsed.lastFreshJourneySummary),
    lastFreshJourneyNotice: String(parsed.lastFreshJourneyNotice || '').slice(0, 1000),
    updatedAt: String(parsed.updatedAt || ''),
  };
}

function restoreStorageValue(storage, key, rawValue) {
  if (rawValue == null) storage.removeItem(key);
  else storage.setItem(key, rawValue);
}

function writeFreshJourneyTransaction({ storage, previousState, nextState, nextLedger }) {
  if (!storage || !nextState || !nextLedger) return false;
  const previousStateRaw = storage.getItem(STORAGE_KEY);
  const previousLedgerRaw = storage.getItem(FRESHNESS_STORAGE_KEY);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    storage.setItem(FRESHNESS_STORAGE_KEY, JSON.stringify(nextLedger));
    return true;
  } catch {
    try {
      restoreStorageValue(
        storage,
        STORAGE_KEY,
        previousStateRaw ?? JSON.stringify(previousState || {}),
      );
      restoreStorageValue(storage, FRESHNESS_STORAGE_KEY, previousLedgerRaw);
    } catch {
      return false;
    }
    return false;
  }
}

function writeFreshnessLedger(ledger, storage = browserStorage()) {
  if (!storage || !ledger) return false;
  try {
    storage.setItem(FRESHNESS_STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

function mergeFreshnessLedgerIntoState(snapshot = {}, ledger = {}) {
  return {
    ...snapshot,
    journeyHistoryKeys: [...new Set([
      ...safeArray(ledger.journeyHistoryKeys),
      ...safeArray(snapshot.journeyHistoryKeys),
    ])].slice(-240),
    recentlyShownCandidateIds: [...new Set([
      ...safeArray(ledger.recentlyShownCandidateIds),
      ...safeArray(snapshot.recentlyShownCandidateIds),
    ])].slice(-120),
  };
}

function setStatus(message) {
  const status = globalThis.document?.getElementById('status-text');
  if (status) status.textContent = message;
}

function setNovelty(message) {
  const novelty = globalThis.document?.getElementById('briefing-novelty');
  if (novelty) novelty.textContent = message;
}

function collectExcludedCandidateIds(snapshot = {}) {
  const ids = new Set([
    ...safeArray(snapshot.recentlyShownCandidateIds),
    ...safeArray(snapshot.candidates).map((track) => track?.id),
    ...safeArray(snapshot.listeningDeck).map((track) => track?.id),
    ...Object.keys(safeObject(snapshot.ratings)),
    ...safeArray(snapshot.journeyHistoryKeys)
      .filter((key) => String(key || '').startsWith('id:'))
      .map((key) => String(key).slice(3)),
  ].map((id) => String(id || '').trim()).filter(Boolean));
  return [...ids];
}

function isMetadataVerifiedCatalogueTrack(track = {}) {
  return track.sourceKind === 'native-catalog'
    && track.catalogVerificationStatus === 'metadata_verified'
    && Boolean(track.title);
}

function interleaveFreshLanes(catalogueCandidates = [], localCandidates = []) {
  const rows = [];
  const catalogue = [...catalogueCandidates];
  const local = [...localCandidates];
  while (rows.length < 20 && (catalogue.length || local.length)) {
    if (catalogue.length) rows.push(catalogue.shift());
    if (local.length) rows.push(local.shift());
  }
  return dedupeFreshJourneyCandidates(rows);
}

async function buildFreshCandidatePool({ snapshot, artist, buildCandidates }) {
  const sessionCounter = Number(snapshot.sessionCounter || 0) + 1;
  const localResult = buildCandidates({
    artistInput: artist,
    tasteDNA: safeObject(snapshot.tasteDNA),
    includeSeen: false,
    recycleSeen: false,
    recentlyShownIds: collectExcludedCandidateIds(snapshot),
    sessionCounter,
  });
  const tasteWeights = buildTasteWeights(snapshot);
  const localCandidates = rankCandidatesByTaste(
    safeArray(localResult?.candidates),
    tasteWeights,
  );

  let cataloguePayload = null;
  let catalogueError = '';
  try {
    cataloguePayload = await requestNativeCatalogSearch(artist, {
      limit: CATALOGUE_LIMIT,
      timeoutMs: CATALOGUE_TIMEOUT_MS,
    });
    if (!cataloguePayload?.ok) catalogueError = String(cataloguePayload?.error || 'Catalogue unavailable.');
  } catch (error) {
    catalogueError = String(error?.message || error || 'Catalogue unavailable.');
  }
  const catalogueCandidates = rankCandidatesByTaste(
    safeArray(cataloguePayload?.results)
      .map((result) => catalogResultToMusicTileTrack(result))
      .filter((track) => isMetadataVerifiedCatalogueTrack(track)),
    tasteWeights,
  );

  return {
    candidates: interleaveFreshLanes(catalogueCandidates, localCandidates),
    sessionCounter,
    localResult,
    cataloguePayload,
    catalogueError,
  };
}

function buildFallbackPipeline({ artist, selected, localResult, catalogueError, generatedAt }) {
  const catalogueCount = selected.filter((track) => track.sourceKind === 'native-catalog').length;
  return {
    query: artist,
    summary: catalogueError
      ? `Fresh local journey built; live catalogue unavailable: ${catalogueError}`
      : 'Fresh journey built from unseen local and catalogue candidates.',
    verifiedCandidates: selected.filter((track) => track.sourceKind === 'native-catalog'),
    searchLeads: [],
    aiSuggestions: [],
    fallbackCandidates: selected.filter((track) => track.sourceKind !== 'native-catalog'),
    warnings: catalogueError ? [catalogueError] : [],
    resultCount: selected.length,
    targetCount: 10,
    generatedAt,
    artistProfileStatus: localResult?.usedFallbackOnly ? 'fallback-only' : 'resolved',
    sourceCounts: { catalogue: catalogueCount, local: selected.length - catalogueCount },
  };
}

export async function startFreshJourney({
  buildCandidates,
  artist,
  storage = browserStorage(),
  reload = () => globalThis.location?.reload?.(),
} = {}) {
  if (typeof buildCandidates !== 'function') {
    return { ok: false, reason: 'candidate-builder-unavailable' };
  }
  const normalizedArtist = String(
    artist || globalThis.document?.getElementById('artist-input')?.value || '',
  ).trim();
  if (!normalizedArtist) {
    setStatus('Enter an artist or creative direction before starting a new journey.');
    return { ok: false, reason: 'artist-required' };
  }
  const rawSnapshot = readMusicState(storage);
  if (!rawSnapshot) {
    setStatus('Music Tile state is unavailable, so the current journey was left unchanged.');
    return { ok: false, reason: 'music-state-unavailable' };
  }
  const freshnessLedger = readFreshnessLedger(storage);
  const snapshot = mergeFreshnessLedgerIntoState(rawSnapshot, freshnessLedger);

  const pool = await buildFreshCandidatePool({ snapshot, artist: normalizedArtist, buildCandidates });
  const startedAt = new Date().toISOString();
  const plan = planFreshJourneyState({
    snapshot: {
      ...snapshot,
      sessionCounter: pool.sessionCounter,
      lastDiscoveryMeta: {
        query: pool.localResult?.query || normalizedArtist,
        usedFallbackOnly: Boolean(pool.localResult?.usedFallbackOnly),
        sourceKinds: safeArray(pool.localResult?.sourceKinds),
        artistVerificationStatus: safeArray(pool.cataloguePayload?.results).length
          ? 'catalogue-found'
          : (pool.localResult?.usedFallbackOnly ? 'fallback-only' : 'known-local'),
        canonicalArtist: pool.localResult?.query?.canonicalArtistName || normalizedArtist,
      },
    },
    candidates: pool.candidates,
    targetCount: 10,
    listeningRoomAdditionCount: 3,
    minimumFreshTarget: 6,
    startedAt,
  });

  if (!plan.ok) {
    const catalogueSuffix = pool.catalogueError ? ` Catalogue status: ${pool.catalogueError}` : '';
    const message = `No unseen tracks were available for ${normalizedArtist}. Stephanos did not recycle the old journey. Try another artist or creative direction.${catalogueSuffix}`;
    setStatus(message);
    setNovelty('No unseen result available; old songs were not recycled');
    return { ...plan, message, catalogueError: pool.catalogueError, recycledCount: 0 };
  }

  let discoveryPipeline;
  try {
    const pipeline = await runMusicDiscoveryPipeline({
      query: normalizedArtist,
      tasteDNA: safeObject(snapshot.tasteDNA),
      aiHints: safeArray(snapshot.aiSmarterJourney),
      localCandidates: plan.selected,
    });
    discoveryPipeline = { ...pipeline, generatedAt: startedAt };
  } catch {
    discoveryPipeline = buildFallbackPipeline({
      artist: normalizedArtist,
      selected: plan.selected,
      localResult: pool.localResult,
      catalogueError: pool.catalogueError,
      generatedAt: startedAt,
    });
  }

  const nextState = {
    ...plan.state,
    discoveryPipeline,
    lastFreshJourneySummary: {
      ...plan.state.lastFreshJourneySummary,
      artist: normalizedArtist,
      catalogueError: pool.catalogueError,
      candidateKeys: plan.selected.flatMap((track) => journeyCandidateKeys(track)).slice(0, 40),
    },
  };
  const nextLedger = {
    schemaVersion: 1,
    journeyHistoryKeys: safeArray(nextState.journeyHistoryKeys).slice(-240),
    recentlyShownCandidateIds: safeArray(nextState.recentlyShownCandidateIds).slice(-120),
    lastFreshJourneySummary: nextState.lastFreshJourneySummary,
    lastFreshJourneyNotice: plan.notice,
    updatedAt: startedAt,
  };
  if (!writeFreshJourneyTransaction({
    storage,
    previousState: rawSnapshot,
    nextState,
    nextLedger,
  })) {
    setStatus('The fresh journey was found but its durable freshness history could not be saved, so the current journey was left unchanged.');
    return {
      ok: false,
      reason: 'fresh-journey-transaction-failed',
      recycledCount: 0,
    };
  }

  setStatus(plan.notice);
  setNovelty(`${plan.freshCount} genuinely new · 0 recycled`);
  reload();
  return {
    ...plan,
    state: nextState,
    catalogueError: pool.catalogueError,
    recycledCount: 0,
  };
}

function restoreFreshJourneyNotice() {
  const storage = browserStorage();
  const ledger = readFreshnessLedger(storage);
  const notice = String(ledger.lastFreshJourneyNotice || '').trim();
  if (!notice) return;
  setStatus(notice);
  const summary = safeObject(ledger.lastFreshJourneySummary);
  if (summary.freshCount != null) {
    setNovelty(`${summary.freshCount} genuinely new · ${summary.recycledCount || 0} recycled`);
  }
  writeFreshnessLedger({
    ...ledger,
    lastFreshJourneyNotice: '',
  }, storage);
}

function installVisibleJourneyControls(startButton) {
  const room = globalThis.document?.querySelector('.listening-room');
  const artistInput = globalThis.document?.getElementById('artist-input');
  const artistControl = artistInput?.closest('.artist-control');
  if (!room || !startButton || !artistControl) return;
  let controls = globalThis.document.getElementById('fresh-journey-controls');
  if (!controls) {
    controls = globalThis.document.createElement('div');
    controls.id = 'fresh-journey-controls';
    controls.className = 'actions fresh-journey-controls';
    const heading = room.querySelector(':scope > .section-heading');
    if (heading) heading.after(controls);
    else room.prepend(controls);
  }
  controls.append(artistControl, startButton);
}

function installContinueCurrentJourneyButton(startButton) {
  if (!startButton || globalThis.document?.getElementById('continue-journey-btn')) return;
  const continueButton = globalThis.document.createElement('button');
  continueButton.id = 'continue-journey-btn';
  continueButton.type = 'button';
  continueButton.className = 'ghost';
  continueButton.textContent = 'Continue Current Journey';
  continueButton.addEventListener('click', () => {
    globalThis.document.querySelector('.listening-room')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    setStatus('Continuing the current journey. No songs were replaced or added.');
  });
  startButton.after(continueButton);
}

export function installFreshJourneyController({ buildCandidates } = {}) {
  if (controllerInstalled || typeof globalThis.document === 'undefined') return false;
  const startButton = globalThis.document.getElementById('start-journey-btn');
  if (!startButton || typeof buildCandidates !== 'function') return false;
  controllerInstalled = true;
  installVisibleJourneyControls(startButton);
  startButton.textContent = 'Start New Journey';
  startButton.title = 'Build a genuinely fresh candidate set and add new tracks to the Listening Room.';
  installContinueCurrentJourneyButton(startButton);
  restoreFreshJourneyNotice();

  globalThis.document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('#start-journey-btn')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (journeyInFlight) return;
    journeyInFlight = true;
    target.disabled = true;
    const previousLabel = target.textContent;
    target.textContent = 'Finding New Music…';
    setStatus('Searching unseen local and live catalogue candidates…');
    void startFreshJourney({ buildCandidates }).finally(() => {
      journeyInFlight = false;
      target.disabled = false;
      target.textContent = previousLabel || 'Start New Journey';
    });
  }, true);
  return true;
}
