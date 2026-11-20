/**
 * Read-only, fixed loopback Sovereign Commander observation for Stephanos AI.
 * The health endpoint is public ONLY on the existing loopback listener.
 * This file NEVER calls /mcp or /ignite, never accepts a caller URL/path,
 * and does not grant local process or source-mutation authority.
 */
export const COMMANDER_LOCAL_HEALTH_URL = 'http://127.0.0.1:18791/health';
export const COMMANDER_HEALTH_PROJECTION_SCHEMA = 'stephanos.ai-sovereign-commander-health.v1';
const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_HEALTH_AGE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 5_000;
const TIMEOUT_MS = 2_500;
const MAX_CONFIGURED_DELAY_MS = 24 * 60 * 60_000;

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

function safeToken(value, max = 160) {
  const str = typeof value === 'string' ? value.trim() : '';
  return str.length <= max && /^[a-zA-Z0-9._:-]*$/.test(str) ? str : '';
}

function isoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function observedEventTimestamp(value, observedAtMs, nowMs) {
  const timestamp = isoTimestamp(value);
  const time = Date.parse(timestamp);
  return timestamp && time <= observedAtMs && time <= nowMs ? timestamp : '';
}

function safeCycleId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)
    ? value : '';
}

function safeSourceHead(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : '';
}

function guardianOperationalState(guardian) {
  if (guardian.timeoutCustodyHeld === true) return 'HELD';
  // A running maintenance operation legitimately holds its reservation.
  if (guardian.running === true || guardian.maintenanceInFlight === true) return 'WORKING';
  if (guardian.custodyHeld === true) return 'HELD';
  if (guardian.enabled === false) return 'DISABLED';
  if (guardian.enabled !== true || guardian.running !== false
    || guardian.maintenanceInFlight !== false || guardian.timeoutCustodyHeld !== false
    || guardian.custodyHeld !== false) return 'UNKNOWN';
  if (guardian.scheduled === true) return 'WAITING';
  return guardian.scheduled === false ? 'NO_NEXT_CYCLE' : 'UNKNOWN';
}

function projectGuardian(guardian, observedAtMs, nowMs) {
  if (!guardian || typeof guardian !== 'object' || Array.isArray(guardian)) return null;
  const lastCompletedAtUtc = observedEventTimestamp(guardian.lastCompletedAtUtc, observedAtMs, nowMs);
  const custody = guardian.persistentCustody;
  const projected = {
    enabled: safeBoolean(guardian.enabled),
    running: safeBoolean(guardian.running),
    scheduled: safeBoolean(guardian.scheduled),
    maintenanceInFlight: safeBoolean(guardian.maintenanceInFlight),
    timeoutCustodyHeld: safeBoolean(guardian.timeoutCustodyHeld),
    custodyHeld: custody && typeof custody === 'object' && !Array.isArray(custody)
      ? safeBoolean(custody.held) : null,
    cycleCount: safeInteger(guardian.cycleCount),
    successCount: safeInteger(guardian.successCount),
    failureCount: safeInteger(guardian.failureCount),
    consecutiveFailureCount: safeInteger(guardian.consecutiveFailureCount),
    currentCycleId: safeCycleId(guardian.currentCycleId),
    lastCycleId: safeCycleId(guardian.lastCycleId),
    lastStartedAtUtc: observedEventTimestamp(guardian.lastStartedAtUtc, observedAtMs, nowMs),
    lastCompletedAtUtc,
    lastCompletedAgeMs: lastCompletedAtUtc ? nowMs - Date.parse(lastCompletedAtUtc) : null,
    lastOk: safeBoolean(guardian.lastOk),
    lastFinalVerdict: safeToken(guardian.lastFinalVerdict),
    lastBlocker: safeToken(guardian.lastBlocker),
    lastActionId: safeToken(guardian.lastActionId, 96),
    lastActionOk: safeBoolean(guardian.lastActionOk),
    lastReportOk: safeBoolean(guardian.lastReportOk),
    lastReportOutcome: safeToken(guardian.lastReportOutcome, 64),
    lastReportStatus: safeToken(guardian.lastReportStatus, 64),
    lastReportBlocker: safeToken(guardian.lastReportBlocker),
    // This identifies the last qualified maintenance operation, not the
    // currently installed helper or the source loaded by this daemon.
    lastSourceHead: safeSourceHead(guardian.lastSourceHead),
    // The original delay passed to the existing timer is not a countdown or
    // a proven next-attempt timestamp. Never infer a due time from a fresh GET.
    configuredRetryDelayMs: guardian.scheduled === true
      && Number.isSafeInteger(guardian.nextDelayMs) && guardian.nextDelayMs >= 0
      && guardian.nextDelayMs <= MAX_CONFIGURED_DELAY_MS ? guardian.nextDelayMs : null,
  };
  return Object.freeze({ ...projected, operationalState: guardianOperationalState(projected) });
}

function held(reason = 'COMMANDER_HEALTH_UNVERIFIED') {
  return Object.freeze({
    schemaVersion: COMMANDER_HEALTH_PROJECTION_SCHEMA,
    available: false,
    healthy: false,
    state: 'UNKNOWN',
    blocker: reason,
    observedAtUtc: '',
    heartbeatAgeMs: null,
    capabilityVersion: '',
    guardian: null,
    localLoopbackOnly: true,
    readOnly: true,
    commanderMcpAccessGranted: false,
    executionProven: false,
    coreAwakeProven: false,
    physicalWorkerPickupProven: false,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
  });
}

export function projectLocalCommanderHealth(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.service !== 'stephanos-sovereign-commander'
    || payload.transport !== 'authenticated-http-jsonrpc') {
    return held('COMMANDER_HEALTH_IDENTITY_MISMATCH');
  }
  const observedAtUtc = isoTimestamp(payload.observedAtUtc);
  const observedAtMs = Date.parse(observedAtUtc);
  if (!Number.isFinite(nowMs) || !observedAtUtc || observedAtMs > nowMs + MAX_FUTURE_SKEW_MS
    || nowMs - observedAtMs > MAX_HEALTH_AGE_MS) {
    return held('COMMANDER_HEALTH_TIMESTAMP_NOT_CURRENT');
  }
  const safeGuardian = projectGuardian(payload.continuousRepairGuardian, observedAtMs, nowMs);
  return Object.freeze({
    schemaVersion: COMMANDER_HEALTH_PROJECTION_SCHEMA,
    available: true,
    healthy: payload.ok === true,
    state: payload.ok === true ? 'SERVICE_REACHABLE' : 'SERVICE_DEGRADED',
    blocker: payload.ok === true ? '' : 'COMMANDER_HEALTH_NOT_READY',
    observedAtUtc,
    heartbeatAgeMs: observedAtMs <= nowMs ? nowMs - observedAtMs : null,
    capabilityVersion: safeToken(payload.capabilityVersion, 100),
    guardian: safeGuardian,
    localLoopbackOnly: true,
    readOnly: true,
    commanderMcpAccessGranted: false,
    executionProven: false,
    coreAwakeProven: false,
    physicalWorkerPickupProven: false,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
  });
}

/** All options other than test-only injected fetch/clock are intentionally ignored. */
export async function readSovereignCommanderStatus({
  fetchFn = fetch,
  nowMs = Date.now,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetchFn(COMMANDER_LOCAL_HEALTH_URL, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response || response.ok !== true || response.status !== 200) {
      return held('COMMANDER_HEALTH_HTTP_NOT_READY');
    }
    const contentLength = response.headers?.get?.('content-length');
    if (contentLength !== null && contentLength !== undefined
      && (!/^\d+$/.test(String(contentLength)) || Number(contentLength) > MAX_RESPONSE_BYTES)) {
      return held('COMMANDER_HEALTH_RESPONSE_TOO_LARGE');
    }
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
      return held('COMMANDER_HEALTH_RESPONSE_TOO_LARGE');
    }
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    return projectLocalCommanderHealth(parsed, nowMs());
  } catch {
    return held('COMMANDER_HEALTH_UNREACHABLE');
  } finally {
    clearTimeout(timeout);
  }
}
