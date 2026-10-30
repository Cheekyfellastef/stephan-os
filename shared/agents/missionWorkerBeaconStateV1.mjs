export const MISSION_WORKER_BEACON_STATE_SCHEMA = 'stephanos.mission-worker-beacon-state.v1';

const SHA = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_PHASE = /^[a-z0-9][a-z0-9._:/ -]{0,159}$/i;
const STATE_BY_TICK_VERDICT = Object.freeze({
  MISSION_WORKER_RUNNING: 'RUNNING',
  MISSION_WORKER_TICK_RUNNING: 'RUNNING',
  MISSION_WORKER_TICK_PASS: 'IDLE',
  MISSION_WORKER_TICK_FAILED: 'BLOCKED',
  RUNNING: 'RUNNING',
  IDLE: 'IDLE',
  BLOCKED: 'BLOCKED',
});

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function safeSha(value) {
  const normalized = text(value, 40).toLowerCase();
  return SHA.test(normalized) ? normalized : '';
}

function safeId(value) {
  const normalized = text(value, 128);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function safePhase(value) {
  const normalized = text(value, 160);
  return SAFE_PHASE.test(normalized) ? normalized : '';
}

function observedAt(record = {}) {
  const value = text(
    record.timestampUtc
    || record.observedAtUtc
    || record.heartbeatAt
    || record.updatedAtUtc,
  );
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function rawWorkerState(record = {}) {
  return text(
    record.workerState
    || record.lastTickVerdict
    || record.status
    || record.state
    || record.phase
    || 'UNKNOWN',
    120,
  ).toUpperCase();
}

export function projectMissionWorkerBeaconState(record = {}, {
  nowMs = Date.now(),
  staleAfterMs = 180_000,
  expectedHead = '',
} = {}) {
  const rawState = rawWorkerState(record);
  const mappedState = STATE_BY_TICK_VERDICT[rawState] || 'UNKNOWN';
  const timestampUtc = observedAt(record);
  const timestampMs = Date.parse(timestampUtc);
  const ageMs = Number.isFinite(timestampMs) ? Math.max(0, nowMs - timestampMs) : null;
  const stale = ageMs === null || ageMs > staleAfterMs;
  const head = safeSha(record.headSha || record.sourceHead || record.expectedHead);
  const normalizedExpectedHead = safeSha(expectedHead);
  const exactHeadMatch = Boolean(normalizedExpectedHead && head === normalizedExpectedHead);
  const activeTaskId = safeId(record.activeTaskId || record.taskId || record.executionId);
  const activeReceiptId = safeId(record.activeReceiptId || record.receiptId);
  const executionPhase = safePhase(record.executionPhase || record.activeExecutionPhase);
  const activeExecutionIdentityComplete = Boolean(activeTaskId && activeReceiptId && executionPhase);

  const state = stale
    ? 'STALE'
    : !exactHeadMatch
      ? 'BLOCKED'
      : mappedState;
  const buildingProven = state === 'RUNNING' && activeExecutionIdentityComplete;

  let blocker = '';
  if (stale) blocker = 'MISSION_WORKER_HEARTBEAT_STALE';
  else if (!exactHeadMatch) blocker = 'MISSION_WORKER_HEAD_MISMATCH';
  else if (state === 'UNKNOWN') blocker = 'MISSION_WORKER_STATE_UNKNOWN';
  else if (state === 'BLOCKED') blocker = text(record.blocker || rawState, 180);
  else if (state === 'RUNNING' && !activeExecutionIdentityComplete) blocker = 'MISSION_WORKER_ACTIVE_RECEIPT_UNPROVEN';

  return Object.freeze({
    schemaVersion: MISSION_WORKER_BEACON_STATE_SCHEMA,
    state,
    rawState,
    observedAtUtc: timestampUtc,
    ageMs,
    head,
    expectedHead: normalizedExpectedHead,
    exactHeadMatch,
    activeTaskId,
    activeReceiptId,
    executionPhase,
    activeExecutionIdentityComplete,
    buildingProven,
    blocker,
    falseBuildingRejected: state !== 'RUNNING' || !buildingProven,
  });
}
