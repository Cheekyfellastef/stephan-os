const MISSION_LINEAGE_SCHEMA_VERSION = 1;
const MAX_MISSIONS = 24;
const MAX_HISTORY_EVENTS = 48;

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asList(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => asText(entry)).filter(Boolean))].slice(0, limit);
}

function asBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function normalizeEvent(entry = {}) {
  return {
    id: asText(entry.id),
    type: asText(entry.type, 'mission-updated'),
    summary: asText(entry.summary, 'Mission state updated.'),
    at: asText(entry.at),
    data: entry.data && typeof entry.data === 'object' ? entry.data : {},
  };
}

function normalizeMission(entry = {}) {
  const history = Array.isArray(entry.history) ? entry.history : [];
  return {
    missionId: asText(entry.missionId),
    packetKey: asText(entry.packetKey),
    title: asText(entry.title, 'Untitled mission'),
    summary: asText(entry.summary, 'No mission summary captured yet.'),
    createdAt: asText(entry.createdAt),
    updatedAt: asText(entry.updatedAt),
    lifecycleState: asText(entry.lifecycleState, 'proposed'),
    buildAssistanceState: asText(entry.buildAssistanceState, 'unavailable'),
    codexHandoff: entry.codexHandoff && typeof entry.codexHandoff === 'object'
      ? {
        handoffId: asText(entry.codexHandoff.handoffId),
        status: asText(entry.codexHandoff.status, 'not-generated'),
        validationStatus: asText(entry.codexHandoff.validationStatus, 'not-run'),
        lastOperatorAction: asText(entry.codexHandoff.lastOperatorAction, 'none'),
      }
      : { handoffId: '', status: 'not-generated', validationStatus: 'not-run', lastOperatorAction: 'none' },
    lastKnownGoodState: entry.lastKnownGoodState && typeof entry.lastKnownGoodState === 'object'
      ? entry.lastKnownGoodState
      : { lifecycleState: 'unknown', codexHandoffStatus: 'not-generated', validationStatus: 'not-run', updatedAt: '' },
    lastOperatorAction: asText(entry.lastOperatorAction, 'none'),
    lastValidationResult: asText(entry.lastValidationResult, 'not-run'),
    resumableState: asBoolean(entry.resumableState, false),
    nextRecommendedAction: asText(entry.nextRecommendedAction, 'Await explicit operator guidance.'),
    continuityStrength: asText(entry.continuityStrength, 'unknown'),
    parentMissionId: asText(entry.parentMissionId),
    relatedMissionIds: asList(entry.relatedMissionIds, 12),
    derivedFrom: asText(entry.derivedFrom),
    blockageReason: asText(entry.blockageReason),
    warnings: asList(entry.warnings, 6),
    history: history.map(normalizeEvent).filter((event) => event.id).slice(0, MAX_HISTORY_EVENTS),
  };
}

export function createDefaultMissionLineageStore() {
  return {
    schemaVersion: MISSION_LINEAGE_SCHEMA_VERSION,
    activeMissionId: '',
    missions: [],
  };
}

export function normalizeMissionLineageStore(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const missions = Array.isArray(source.missions)
    ? source.missions.map(normalizeMission).filter((mission) => mission.missionId).slice(0, MAX_MISSIONS)
    : [];

  const activeMissionId = asText(source.activeMissionId);
  return {
    schemaVersion: MISSION_LINEAGE_SCHEMA_VERSION,
    activeMissionId: missions.some((mission) => mission.missionId === activeMissionId)
      ? activeMissionId
      : asText(missions[0]?.missionId),
    missions,
  };
}

function resolveResumableState({ lifecycleState = '', codexStatus = '', validationStatus = '', missionBlocked = false, continuityStrength = 'unknown' } = {}) {
  if (missionBlocked) {
    return { resumableState: false, reason: 'mission-blocked' };
  }
  if (continuityStrength === 'sparse' || continuityStrength === 'unknown') {
    return { resumableState: false, reason: 'sparse-continuity' };
  }
  if (['completed', 'rolled-back', 'rejected'].includes(lifecycleState)) {
    return { resumableState: false, reason: 'terminal-state' };
  }
  if (codexStatus === 'validated' && validationStatus === 'passed') {
    return { resumableState: false, reason: 'already-validated' };
  }
  return { resumableState: true, reason: '' };
}

function appendHistory(history = [], event = {}) {
  const normalized = normalizeEvent(event);
  if (!normalized.id) {
    return history.slice(0, MAX_HISTORY_EVENTS);
  }
  const filtered = history.filter((entry) => entry.id !== normalized.id);
  return [normalized, ...filtered].slice(0, MAX_HISTORY_EVENTS);
}

export function applyMissionLineageUpdate(storeInput = {}, {
  packetTruth = {},
  selectors = {},
  envelope = null,
  now = new Date().toISOString(),
} = {}) {
  const store = normalizeMissionLineageStore(storeInput);
  const packetKey = asText(selectors?.currentMissionState?.packetKey || packetTruth?.packetKey);
  const missionId = asText(packetTruth?.moveId || selectors?.currentMissionState?.packetKey || packetKey);
  if (!missionId || !packetKey) {
    return store;
  }

  const continuityStrength = asText(selectors?.continuityLoopState?.strength, 'unknown');
  const lifecycleState = asText(selectors?.currentMissionState?.missionPhase, 'proposed');
  const codexStatus = asText(selectors?.currentMissionState?.codexHandoffStatus, 'not-generated');
  const validationStatus = asText(selectors?.currentMissionState?.validationStatus, 'not-run');
  const blockageReason = asText(selectors?.blockageExplanation);
  const missionBlocked = selectors?.missionBlocked === true;
  const resumability = resolveResumableState({ lifecycleState, codexStatus, validationStatus, missionBlocked, continuityStrength });

  const existing = store.missions.find((mission) => mission.missionId === missionId) || null;
  const title = asText(packetTruth?.moveTitle || selectors?.currentMissionState?.missionTitle, existing?.title || 'Untitled mission');
  const summary = asText(packetTruth?.rationale, existing?.summary || 'No mission summary captured yet.');
  const lastOperatorAction = asText(envelope?.actionRequested || selectors?.currentMissionState?.lastHandoffAction, 'none');

  const baseMission = normalizeMission({
    missionId,
    packetKey,
    title,
    summary,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lifecycleState,
    buildAssistanceState: asText(selectors?.buildAssistanceReadiness?.state, 'unavailable'),
    codexHandoff: {
      handoffId: asText(selectors?.currentMissionState?.packetKey),
      status: codexStatus,
      validationStatus,
      lastOperatorAction: asText(selectors?.currentMissionState?.lastHandoffAction, 'none'),
    },
    lastKnownGoodState: validationStatus === 'passed' || lifecycleState === 'completed'
      ? {
        lifecycleState,
        codexHandoffStatus: codexStatus,
        validationStatus,
        updatedAt: now,
      }
      : (existing?.lastKnownGoodState || {
        lifecycleState: 'unknown', codexHandoffStatus: 'not-generated', validationStatus: 'not-run', updatedAt: '',
      }),
    lastOperatorAction,
    lastValidationResult: validationStatus,
    resumableState: resumability.resumableState,
    nextRecommendedAction: asText(selectors?.nextRecommendedAction, 'Await explicit operator guidance.'),
    continuityStrength,
    parentMissionId: asText(existing?.parentMissionId),
    relatedMissionIds: existing?.relatedMissionIds || [],
    derivedFrom: asText(existing?.derivedFrom),
    blockageReason,
    warnings: [resumability.reason].filter(Boolean),
    history: existing?.history || [],
  });

  const eventType = envelope?.actionRequested
    ? `mission.${asText(envelope.actionRequested).replace(/[^a-z0-9-]/gi, '-')}`
    : existing
      ? 'mission.updated'
      : 'mission.created';

  const summaryText = envelope?.actionRequested
    ? `Lifecycle action ${envelope.actionRequested} (${envelope.status || 'unknown-status'}).`
    : existing
      ? `Mission state refreshed (${lifecycleState}).`
      : `Mission created (${title}).`;

  const nextMission = {
    ...baseMission,
    history: appendHistory(baseMission.history, {
      id: `mission_event_${Date.parse(now)}_${eventType}`,
      type: eventType,
      summary: summaryText,
      at: now,
      data: {
        lifecycleState,
        codexStatus,
        validationStatus,
        nextRecommendedAction: baseMission.nextRecommendedAction,
      },
    }),
  };

  const remaining = store.missions.filter((mission) => mission.missionId !== missionId);
  return normalizeMissionLineageStore({
    ...store,
    activeMissionId: missionId,
    missions: [nextMission, ...remaining].slice(0, MAX_MISSIONS),
  });
}

export function deriveMissionResumability(storeInput = {}, { preferredMissionId = '' } = {}) {
  const store = normalizeMissionLineageStore(storeInput);
  const resumableMissions = store.missions.filter((mission) => mission.resumableState === true);
  const activeMission = store.missions.find((mission) => mission.missionId === preferredMissionId)
    || store.missions.find((mission) => mission.missionId === store.activeMissionId)
    || resumableMissions[0]
    || store.missions[0]
    || null;

  if (!activeMission) {
    return {
      hasResumableMission: false,
      resumableMissionCount: 0,
      missionId: '',
      missionSummary: 'No persisted mission lineage was found.',
      lastStableState: null,
      lastExternalAction: 'none',
      nextRecommendedAction: 'Create or accept a mission packet before requesting resume.',
      warnings: ['no-missions-recorded'],
    };
  }

  return {
    hasResumableMission: activeMission.resumableState === true,
    resumableMissionCount: resumableMissions.length,
    missionId: activeMission.missionId,
    missionSummary: `${activeMission.title} (${activeMission.lifecycleState})`,
    lastStableState: activeMission.lastKnownGoodState,
    lastExternalAction: asText(activeMission.codexHandoff?.lastOperatorAction, activeMission.lastOperatorAction),
    nextRecommendedAction: activeMission.nextRecommendedAction,
    warnings: [
      ...(activeMission.continuityStrength === 'sparse' ? ['sparse-continuity'] : []),
      ...(activeMission.warnings || []),
    ].filter(Boolean).slice(0, 4),
  };
}
