const ACTIVE_MISSION_STORAGE_KEY = 'stephanos.active.mission.v1';
const ACTIVE_MISSION_VERSION = 'active-mission.v1';

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function sanitizeText(value, max = 240) {
  return asText(value).replace(/\s+/g, ' ').slice(0, max);
}

function sanitizeList(value, max = 8) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizeText(item, 120)).filter(Boolean).slice(0, max);
}

export function createEmptyActiveMissionState() {
  return {
    version: ACTIVE_MISSION_VERSION,
    missionId: 'unknown',
    title: 'unknown',
    phase: 'unknown',
    objective: 'unknown',
    currentFocus: 'unknown',
    lastKnownGoodStackState: 'unknown',
    nextRecommendedStep: 'Answer directly with bounded confidence.',
    blockedReason: 'unknown',
    proofState: 'unknown',
    relatedSystems: [],
    updatedAt: '',
    rawTranscriptStored: 'no',
    storageKey: ACTIVE_MISSION_STORAGE_KEY,
    rehydrated: false,
    storageReadStatus: 'missing',
  };
}

export function buildActiveMissionState(input = {}, previous = createEmptyActiveMissionState()) {
  const base = { ...createEmptyActiveMissionState(), ...(previous || {}) };
  return {
    ...base,
    version: ACTIVE_MISSION_VERSION,
    missionId: sanitizeText(input.missionId || base.missionId || `mission_${Date.now()}`, 80) || 'unknown',
    title: sanitizeText(input.title || base.title, 220) || 'unknown',
    phase: sanitizeText(input.phase || base.phase, 80) || 'unknown',
    objective: sanitizeText(input.objective || base.objective, 280) || 'unknown',
    currentFocus: sanitizeText(input.currentFocus || base.currentFocus, 220) || 'unknown',
    lastKnownGoodStackState: sanitizeText(input.lastKnownGoodStackState || base.lastKnownGoodStackState, 220) || 'unknown',
    nextRecommendedStep: sanitizeText(input.nextRecommendedStep || base.nextRecommendedStep, 220) || 'Answer directly with bounded confidence.',
    blockedReason: sanitizeText(input.blockedReason || base.blockedReason, 220) || 'unknown',
    proofState: sanitizeText(input.proofState || base.proofState, 120) || 'unknown',
    relatedSystems: sanitizeList(input.relatedSystems || base.relatedSystems),
    updatedAt: new Date().toISOString(),
    rawTranscriptStored: 'no',
    storageKey: ACTIVE_MISSION_STORAGE_KEY,
    rehydrated: false,
    storageReadStatus: 'success',
  };
}

export function persistActiveMissionState(state = {}, storage = globalThis.localStorage) {
  if (!storage?.setItem) return false;
  const normalized = { ...createEmptyActiveMissionState(), ...(state || {}), storageKey: ACTIVE_MISSION_STORAGE_KEY, rawTranscriptStored: 'no' };
  storage.setItem(ACTIVE_MISSION_STORAGE_KEY, JSON.stringify(normalized));
  return true;
}

export function readActiveMissionState(storage = globalThis.localStorage) {
  if (!storage?.getItem) return { ...createEmptyActiveMissionState(), storageReadStatus: 'unavailable' };
  const raw = storage.getItem(ACTIVE_MISSION_STORAGE_KEY);
  if (!raw) return { ...createEmptyActiveMissionState(), storageReadStatus: 'missing' };
  try {
    const parsed = JSON.parse(raw);
    return { ...createEmptyActiveMissionState(), ...(parsed || {}), rehydrated: true, rawTranscriptStored: 'no', storageKey: ACTIVE_MISSION_STORAGE_KEY, storageReadStatus: 'success' };
  } catch {
    return { ...createEmptyActiveMissionState(), storageReadStatus: 'corrupt' };
  }
}

export { ACTIVE_MISSION_STORAGE_KEY, ACTIVE_MISSION_VERSION };
