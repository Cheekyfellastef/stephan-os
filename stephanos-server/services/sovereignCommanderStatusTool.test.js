import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDER_LOCAL_HEALTH_URL,
  COMMANDER_HEALTH_PROJECTION_SCHEMA,
  projectLocalCommanderHealth,
  readSovereignCommanderStatus,
} from './sovereignCommanderStatusTool.js';

const NOW = Date.parse('2026-10-12T20:50:00.000Z');
const HEALTH = Object.freeze({
  ok: true,
  service: 'stephanos-sovereign-commander',
  transport: 'authenticated-http-jsonrpc',
  capabilityVersion: '2026-10-20-starfield-vr-archive-v6',
  observedAtUtc: new Date(NOW - 1000).toISOString(),
  continuousRepairGuardian: {
    enabled: true, running: false, scheduled: true,
    cycleCount: 8, successCount: 2, failureCount: 6,
    lastOk: false, lastBlocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
    lastFinalVerdict: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED',
    lastCompletedAtUtc: new Date(NOW - 8000).toISOString(),
  },
  dangerousSecret: 'never-publish-this',
});

function response(value, overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() { return JSON.stringify(value); },
    ...overrides,
  };
}

test('fixed loopback Commander probe produces sanitized service-only truth', async () => {
  let observed = null;
  const result = await readSovereignCommanderStatus({
    fetchFn: async (url, init) => {
      observed = { url, init };
      return response(HEALTH);
    },
    nowMs: () => NOW,
  });
  assert.equal(observed.url, COMMANDER_LOCAL_HEALTH_URL);
  assert.equal(observed.init.method, 'GET');
  assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.init.cache, 'no-store');
  assert.equal(result.schemaVersion, COMMANDER_HEALTH_PROJECTION_SCHEMA);
  assert.equal(result.healthy, true);
  assert.equal(result.state, 'SERVICE_REACHABLE');
  assert.equal(result.guardian.cycleCount, 8);
  assert.equal(result.guardian.lastOk, false);
  assert.equal(result.coreAwakeProven, false);
  assert.equal(result.physicalWorkerPickupProven, false);
  assert.equal(result.executionProven, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.commanderMcpAccessGranted, false);
  assert.equal(JSON.stringify(result).includes('dangerousSecret'), false);
  assert.equal(JSON.stringify(result).includes('never-publish-this'), false);
});

test('unknown service, invalid timestamp, raw secret fields and forged green remain held', () => {
  const bogus = projectLocalCommanderHealth({ ...HEALTH, service: 'wrong', ok: true }, NOW);
  assert.equal(bogus.healthy, false);
  assert.equal(bogus.state, 'UNKNOWN');
  const stale = projectLocalCommanderHealth({
    ...HEALTH, observedAtUtc: new Date(NOW - 600_000).toISOString(),
  }, NOW);
  assert.equal(stale.healthy, false);
  assert.equal(stale.blocker, 'COMMANDER_HEALTH_TIMESTAMP_NOT_CURRENT');
  const future = projectLocalCommanderHealth({
    ...HEALTH, observedAtUtc: new Date(NOW + 600_000).toISOString(),
  }, NOW);
  assert.equal(future.healthy, false);
});

test('offline and HTTP error cannot be narrated as completed maintenance', async () => {
  const offline = await readSovereignCommanderStatus({
    fetchFn: async () => { throw new Error('secret path C:\\Users\\Example\\private'); },
    nowMs: () => NOW,
  });
  assert.equal(offline.available, false);
  assert.equal(offline.blocker, 'COMMANDER_HEALTH_UNREACHABLE');
  assert.equal(JSON.stringify(offline).includes('secret path'), false);
  const httpError = await readSovereignCommanderStatus({
    fetchFn: async () => response(HEALTH, { ok: false, status: 401 }),
    nowMs: () => NOW,
  });
  assert.equal(httpError.healthy, false);
  assert.equal(httpError.blocker, 'COMMANDER_HEALTH_HTTP_NOT_READY');
});

test('oversized payload and malformed response fail closed without echo', async () => {
  const large = await readSovereignCommanderStatus({
    fetchFn: async () => ({
      ...response(HEALTH),
      headers: { get: () => '1000000' },
    }),
    nowMs: () => NOW,
  });
  assert.equal(large.blocker, 'COMMANDER_HEALTH_RESPONSE_TOO_LARGE');
  const invalid = await readSovereignCommanderStatus({
    fetchFn: async () => ({ ...response(HEALTH), async text() { return '{invalid'; } }),
    nowMs: () => NOW,
  });
  assert.equal(invalid.healthy, false);
  assert.equal(invalid.blocker, 'COMMANDER_HEALTH_IDENTITY_MISMATCH');
});
