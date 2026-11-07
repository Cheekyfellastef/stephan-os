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
  capabilityVersion: '2026-10-18-island-action-contract-v6',
  observedAtUtc: new Date(NOW - 1000).toISOString(),
  continuousRepairGuardian: {
    enabled: true, running: false, scheduled: true,
    maintenanceInFlight: false, timeoutCustodyHeld: false,
    persistentCustody: { held: false },
    cycleCount: 8, successCount: 2, failureCount: 6,
    consecutiveFailureCount: 3, currentCycleId: '', lastCycleId: 'repair-cycle-8',
    lastStartedAtUtc: new Date(NOW - 10_000).toISOString(),
    lastOk: false, lastBlocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
    lastFinalVerdict: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED',
    lastCompletedAtUtc: new Date(NOW - 8000).toISOString(),
    lastActionId: 'repair-goal-builder-flow', lastActionOk: false,
    lastReportOk: true, lastReportOutcome: 'BLOCKED', lastReportStatus: 'ATTENTION_REQUIRED',
    lastReportBlocker: '', lastSourceHead: 'a'.repeat(40), nextDelayMs: 240_000,
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
  assert.equal(result.heartbeatAgeMs, 1000);
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

test('existing guardian diagnostics preserve action, report and custody distinctions', () => {
  const result = projectLocalCommanderHealth({
    ...HEALTH,
    continuousRepairGuardian: {
      ...HEALTH.continuousRepairGuardian,
      lastActionOk: true,
      lastReportOk: false,
      lastReportOutcome: 'MAINTENANCE_COMPLETED',
      lastReportStatus: 'OBSERVED',
      lastReportBlocker: 'SOVEREIGN_COMMANDER_REPAIR_STATUS_PUBLICATION_FAILED',
    },
  }, NOW);
  assert.equal(result.guardian.operationalState, 'WAITING');
  assert.equal(result.guardian.maintenanceInFlight, false);
  assert.equal(result.guardian.timeoutCustodyHeld, false);
  assert.equal(result.guardian.custodyHeld, false);
  assert.equal(result.guardian.currentCycleId, '');
  assert.equal(result.guardian.lastCycleId, 'repair-cycle-8');
  assert.equal(result.guardian.lastStartedAtUtc, new Date(NOW - 10_000).toISOString());
  assert.equal(result.guardian.lastCompletedAgeMs, 8000);
  assert.equal(result.guardian.lastActionId, 'repair-goal-builder-flow');
  assert.equal(result.guardian.lastActionOk, true);
  assert.equal(result.guardian.lastReportOk, false);
  assert.equal(result.guardian.lastReportOutcome, 'MAINTENANCE_COMPLETED');
  assert.equal(result.guardian.lastReportStatus, 'OBSERVED');
  assert.equal(result.guardian.lastReportBlocker, 'SOVEREIGN_COMMANDER_REPAIR_STATUS_PUBLICATION_FAILED');
  assert.equal(result.guardian.lastOk, false);
  assert.equal(result.guardian.lastSourceHead, 'a'.repeat(40));
  assert.equal(result.guardian.consecutiveFailureCount, 3);
  assert.equal(result.guardian.configuredRetryDelayMs, 240_000);
  assert.equal(result.state, 'SERVICE_REACHABLE');
  assert.equal(result.executionProven, false);
  assert.equal(result.physicalWorkerPickupProven, false);
  assert.equal(result.coreAwakeProven, false);
  assert.equal(Object.hasOwn(result.guardian, 'installedSourceHead'), false);
  assert.equal(Object.hasOwn(result.guardian, 'runtimeSourceHead'), false);
});

test('guardian observations distinguish active work, waiting, holds and a missing next cycle', () => {
  const cases = [
    [{ running: true, maintenanceInFlight: true, scheduled: false, persistentCustody: { held: true } }, 'WORKING'],
    [{ running: false, maintenanceInFlight: true, scheduled: false, persistentCustody: { held: true } }, 'WORKING'],
    [{ timeoutCustodyHeld: true }, 'HELD'],
    [{ persistentCustody: { held: true }, scheduled: false }, 'HELD'],
    [{ scheduled: true }, 'WAITING'],
    [{ scheduled: false }, 'NO_NEXT_CYCLE'],
    [{ enabled: false, scheduled: false }, 'DISABLED'],
    [{ scheduled: 'true' }, 'UNKNOWN'],
    [{ persistentCustody: undefined }, 'UNKNOWN'],
    [{ maintenanceInFlight: undefined }, 'UNKNOWN'],
    [{ timeoutCustodyHeld: undefined }, 'UNKNOWN'],
  ];
  for (const [changes, expected] of cases) {
    const result = projectLocalCommanderHealth({
      ...HEALTH, continuousRepairGuardian: { ...HEALTH.continuousRepairGuardian, ...changes },
    }, NOW);
    assert.equal(result.guardian.operationalState, expected, JSON.stringify(changes));
    assert.equal(result.executionProven, false);
    if (changes.scheduled === false) assert.equal(result.guardian.configuredRetryDelayMs, null);
  }
});

test('old completion stays visibly old and the configured delay never becomes a countdown', () => {
  const oldCompletion = {
    ...HEALTH,
    continuousRepairGuardian: {
      ...HEALTH.continuousRepairGuardian,
      lastOk: true,
      lastCompletedAtUtc: new Date(NOW - 3_600_000).toISOString(),
    },
  };
  const first = projectLocalCommanderHealth(oldCompletion, NOW);
  const later = projectLocalCommanderHealth(oldCompletion, NOW + 10_000);
  assert.equal(first.heartbeatAgeMs, 1000);
  assert.equal(first.guardian.lastCompletedAgeMs, 3_600_000);
  assert.equal(later.guardian.lastCompletedAgeMs, 3_610_000);
  assert.equal(first.guardian.configuredRetryDelayMs, 240_000);
  assert.equal(later.guardian.configuredRetryDelayMs, 240_000);
  assert.equal(Object.hasOwn(later.guardian, 'nextAttemptAtUtc'), false);
  assert.equal(Object.hasOwn(later.guardian, 'nextDelayMs'), false);
  assert.equal(later.executionProven, false);
});

test('malformed guardian fields cannot expose paths, secrets or coercible identities', () => {
  const poison = { toString() { throw new Error('must not coerce'); } };
  const result = projectLocalCommanderHealth({
    ...HEALTH,
    continuousRepairGuardian: {
      enabled: 'true', running: 1, scheduled: true, maintenanceInFlight: 'false',
      timeoutCustodyHeld: 'false',
      persistentCustody: { held: 'false', signingKey: 'never-publish-this', path: 'C:\\private' },
      cycleCount: '8', successCount: -1, failureCount: 1.5, consecutiveFailureCount: 1_000_001,
      currentCycleId: '../secret-path', lastCycleId: 'x'.repeat(81),
      lastSourceHead: poison, lastOk: 'true', lastActionOk: 1, lastReportOk: 'false',
      lastActionId: 'C:\\private\\repair', lastReportOutcome: 'secret with spaces',
      lastReportStatus: '<script>secret</script>', lastReportBlocker: 'Authorization: Bearer secret',
      lastBlocker: 'private/path', lastFinalVerdict: poison,
      lastStartedAtUtc: 'invalid', lastCompletedAtUtc: 'invalid', nextDelayMs: '60000',
      arbitrarySecret: 'never-publish-this', nextAttemptAtUtc: new Date(NOW + 60_000).toISOString(),
      installedSourceHead: 'b'.repeat(40), fullStephanosRepairProven: true,
    },
  }, NOW);
  for (const name of ['enabled', 'running', 'maintenanceInFlight', 'timeoutCustodyHeld',
    'custodyHeld', 'cycleCount', 'successCount', 'failureCount', 'consecutiveFailureCount',
    'lastOk', 'lastActionOk', 'lastReportOk', 'lastCompletedAgeMs', 'configuredRetryDelayMs']) {
    assert.equal(result.guardian[name], null, name);
  }
  for (const name of ['currentCycleId', 'lastCycleId', 'lastSourceHead', 'lastActionId',
    'lastReportOutcome', 'lastReportStatus', 'lastReportBlocker', 'lastBlocker',
    'lastFinalVerdict', 'lastStartedAtUtc', 'lastCompletedAtUtc']) {
    assert.equal(result.guardian[name], '', name);
  }
  assert.equal(result.guardian.operationalState, 'UNKNOWN');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /never-publish-this|private|signingKey|Authorization|<script>/);
  assert.equal(Object.hasOwn(result.guardian, 'nextAttemptAtUtc'), false);
  assert.equal(Object.hasOwn(result.guardian, 'fullStephanosRepairProven'), false);
  assert.equal(result.executionProven, false);
});

test('future cycle evidence and invalid clock or retry values remain unknown', () => {
  for (const lastSourceHead of ['a'.repeat(39), 'a'.repeat(41), ' ' + 'a'.repeat(40), 'g'.repeat(40)]) {
    const result = projectLocalCommanderHealth({
      ...HEALTH, continuousRepairGuardian: { ...HEALTH.continuousRepairGuardian, lastSourceHead },
    }, NOW);
    assert.equal(result.guardian.lastSourceHead, '');
  }
  for (const nextDelayMs of [-1, 0.5, Infinity, 24 * 60 * 60_000 + 1]) {
    const result = projectLocalCommanderHealth({
      ...HEALTH,
      continuousRepairGuardian: {
        ...HEALTH.continuousRepairGuardian, nextDelayMs,
        lastStartedAtUtc: new Date(NOW + 1000).toISOString(),
        lastCompletedAtUtc: new Date(NOW + 1000).toISOString(),
      },
    }, NOW);
    assert.equal(result.guardian.configuredRetryDelayMs, null);
    assert.equal(result.guardian.lastStartedAtUtc, '');
    assert.equal(result.guardian.lastCompletedAtUtc, '');
    assert.equal(result.guardian.lastCompletedAgeMs, null);
  }
  for (const nowMs of [NaN, Infinity, '2026-10-12']) {
    const result = projectLocalCommanderHealth(HEALTH, nowMs);
    assert.equal(result.blocker, 'COMMANDER_HEALTH_TIMESTAMP_NOT_CURRENT');
    assert.equal(result.guardian, null);
    assert.equal(result.heartbeatAgeMs, null);
  }
  const stale = projectLocalCommanderHealth(HEALTH, NOW + 60_000);
  assert.equal(stale.guardian, null);
  assert.equal(stale.heartbeatAgeMs, null);
});
