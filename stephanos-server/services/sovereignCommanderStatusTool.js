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

function held(reason = 'COMMANDER_HEALTH_UNVERIFIED') {
  return Object.freeze({
    schemaVersion: COMMANDER_HEALTH_PROJECTION_SCHEMA,
    available: false,
    healthy: false,
    state: 'UNKNOWN',
    blocker: reason,
    observedAtUtc: '',
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
  if (!observedAtUtc || observedAtMs > nowMs + MAX_FUTURE_SKEW_MS
    || nowMs - observedAtMs > MAX_HEALTH_AGE_MS) {
    return held('COMMANDER_HEALTH_TIMESTAMP_NOT_CURRENT');
  }
  const guardian = payload.continuousRepairGuardian;
  const safeGuardian = guardian && typeof guardian === 'object' && !Array.isArray(guardian)
    ? Object.freeze({
      enabled: guardian.enabled === true,
      running: guardian.running === true,
      scheduled: guardian.scheduled === true,
      cycleCount: safeInteger(guardian.cycleCount),
      successCount: safeInteger(guardian.successCount),
      failureCount: safeInteger(guardian.failureCount),
      lastOk: guardian.lastOk === true ? true : guardian.lastOk === false ? false : null,
      lastFinalVerdict: safeToken(guardian.lastFinalVerdict),
      lastBlocker: safeToken(guardian.lastBlocker),
      lastCompletedAtUtc: isoTimestamp(guardian.lastCompletedAtUtc),
    })
    : null;
  return Object.freeze({
    schemaVersion: COMMANDER_HEALTH_PROJECTION_SCHEMA,
    available: true,
    healthy: payload.ok === true,
    state: payload.ok === true ? 'SERVICE_REACHABLE' : 'SERVICE_DEGRADED',
    blocker: payload.ok === true ? '' : 'COMMANDER_HEALTH_NOT_READY',
    observedAtUtc,
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
