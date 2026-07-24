const EXECUTION_STATES = new Set([
  'ACCEPTED',
  'QUEUED',
  'BUILDING',
  'LOCAL_BUILD_COMPLETE',
  'REMOTE_HEAD_PUBLISHED',
  'CI_RUNNING',
  'VERIFYING',
  'BLOCKED',
  'STALE',
  'STATE_DIVERGENCE',
  'COMPLETE',
  'UNKNOWN',
]);

const TERMINAL_STATES = new Set(['BLOCKED', 'STALE', 'STATE_DIVERGENCE', 'COMPLETE']);
const ACTIVE_STATES = new Set(['ACCEPTED', 'QUEUED', 'BUILDING', 'LOCAL_BUILD_COMPLETE', 'REMOTE_HEAD_PUBLISHED', 'CI_RUNNING', 'VERIFYING']);
const EXACT_SHA = /^[a-f0-9]{40}$/;
const TASK_ID = /^[a-z0-9][a-z0-9._:/#-]{0,127}$/i;

function freeze(value) {
  return Object.freeze(value);
}

function text(value, fallback = 'unknown') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function exactSha(value) {
  const normalized = text(value, '').toLowerCase();
  return EXACT_SHA.test(normalized) ? normalized : null;
}

function taskIdentity(value) {
  const normalized = text(value, '');
  return TASK_ID.test(normalized) ? normalized : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function state(value) {
  const normalized = text(value, 'UNKNOWN').toUpperCase();
  return EXECUTION_STATES.has(normalized) ? normalized : 'UNKNOWN';
}

function normalizeReceipt(receipt = {}, nowMs, heartbeatTtlMs) {
  const safe = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
  const claimedState = state(safe.state);
  const heartbeatAtMs = timestamp(safe.heartbeatAt ?? safe.timestampUtc);
  const heartbeatAgeMs = heartbeatAtMs === null ? null : nowMs - heartbeatAtMs;
  const heartbeatCurrent = heartbeatAgeMs !== null && heartbeatAgeMs >= 0 && heartbeatAgeMs <= heartbeatTtlMs;
  const activeClaim = ACTIVE_STATES.has(claimedState);
  const effectiveState = activeClaim && !heartbeatCurrent ? 'STALE' : claimedState;
  const sourceHead = exactSha(safe.sourceHead ?? safe.headSha);
  const remoteHead = exactSha(safe.remoteHead);
  const localOnly = claimedState === 'LOCAL_BUILD_COMPLETE' || (sourceHead !== null && remoteHead === null && activeClaim);

  return freeze({
    receiptId: taskIdentity(safe.receiptId),
    taskId: taskIdentity(safe.taskId),
    goal: text(safe.goal, 'untracked'),
    pr: Number.isSafeInteger(Number(safe.pr)) && Number(safe.pr) > 0 ? Number(safe.pr) : null,
    owner: text(safe.owner),
    provider: text(safe.provider),
    phase: text(safe.phase),
    claimedState,
    effectiveState,
    sourceHead,
    remoteHead,
    localOnly,
    heartbeatAt: heartbeatAtMs === null ? null : new Date(heartbeatAtMs).toISOString(),
    heartbeatAgeMs,
    heartbeatCurrent,
    blocker: text(safe.blocker, ''),
    nextAction: text(safe.nextAction, 'Await a fresh authoritative execution receipt.'),
    terminal: TERMINAL_STATES.has(effectiveState),
  });
}

function identityKey(receipt) {
  return receipt.taskId || [receipt.goal, receipt.pr, receipt.owner].join('|');
}

export const LIVE_EXECUTION_HEARTBEAT_TTL_MS = 5 * 60 * 1000;

export function buildLiveExecutionTelemetryProjection(input = {}) {
  const requestedNow = typeof input.now === 'number' ? input.now : Date.parse(text(input.now, ''));
  const nowMs = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const requestedTtl = Number(input.heartbeatTtlMs);
  const heartbeatTtlMs = Number.isFinite(requestedTtl) && requestedTtl > 0
    ? Math.min(requestedTtl, LIVE_EXECUTION_HEARTBEAT_TTL_MS)
    : LIVE_EXECUTION_HEARTBEAT_TTL_MS;
  const sourceVerified = input.source?.verified === true;
  const receipts = sourceVerified && Array.isArray(input.receipts)
    ? input.receipts.map((receipt) => normalizeReceipt(receipt, nowMs, heartbeatTtlMs))
    : [];

  const active = receipts.filter((receipt) => ACTIVE_STATES.has(receipt.effectiveState));
  const stale = receipts.filter((receipt) => receipt.effectiveState === 'STALE');
  const identities = new Map();
  for (const receipt of active) {
    const key = identityKey(receipt);
    identities.set(key, (identities.get(key) || 0) + 1);
  }
  const duplicateActiveClaims = [...identities.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const explicitDivergence = receipts.some((receipt) => receipt.effectiveState === 'STATE_DIVERGENCE');
  const stateDivergence = explicitDivergence || duplicateActiveClaims.length > 0;
  const authoritative = sourceVerified && !stateDivergence;

  return freeze({
    schemaVersion: 'stephanos.live-execution-telemetry.v1',
    readOnly: true,
    sourceVerified,
    authoritative,
    heartbeatTtlMs,
    stateDivergence,
    duplicateActiveClaims: freeze(duplicateActiveClaims),
    activeBuilderCount: authoritative ? active.length : 0,
    staleBuilderCount: stale.length,
    activeBuilders: freeze(authoritative ? active : []),
    receipts: freeze(receipts),
    answer: !sourceVerified
      ? 'NO_ACTIVE_BUILD_PROVEN'
      : stateDivergence
        ? 'STATE_DIVERGENCE'
        : active.length > 0
          ? 'ACTIVE_BUILD_PROVEN'
          : 'NO_ACTIVE_BUILD_PROVEN',
    nextAction: !sourceVerified
      ? 'Connect and verify the authoritative Shared Workspace execution-receipt source.'
      : stateDivergence
        ? 'Reconcile conflicting active-lane claims before reporting a builder as active.'
        : stale.length > 0
          ? 'Classify expired heartbeats as stalled or blocked and select the next safe action.'
          : active.length > 0
            ? 'Continue observing receipt-backed heartbeats and exact source-head transitions.'
            : 'Select and dispatch one eligible implementation lane.',
  });
}
