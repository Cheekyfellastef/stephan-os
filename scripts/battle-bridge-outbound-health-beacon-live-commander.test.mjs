import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBattleBridgeOutboundBeacon,
  buildBattleBridgeOutboundBeaconBody,
  projectSovereignCommanderBeaconFacts,
  runObservedBattleBridgeOutboundHealthBeacon,
} from './battle-bridge-outbound-health-beacon.mjs';
import {
  COMMANDER_LOCAL_HEALTH_URL,
  projectLocalCommanderHealth,
  readSovereignCommanderStatus,
} from '../stephanos-server/services/sovereignCommanderStatusTool.js';

const NOW = Date.parse('2026-10-30T20:40:00.000Z');
const HEAD = 'a'.repeat(40);
const MAINTENANCE_HEAD = 'b'.repeat(40);
const AUTHORITY_FIELDS = [
  'commanderMcpAccessGranted', 'executionProven', 'coreAwakeProven',
  'physicalWorkerPickupProven', 'sourceMutationAllowed', 'arbitraryShellAllowed',
  'mergeAuthority',
];

function health(guardian = {}, overrides = {}) {
  return {
    service: 'stephanos-sovereign-commander', transport: 'authenticated-http-jsonrpc',
    ok: true, observedAtUtc: new Date(NOW - 1000).toISOString(),
    capabilityVersion: 'current-health-contract',
    continuousRepairGuardian: {
      enabled: true, running: false, scheduled: true,
      maintenanceInFlight: false, timeoutCustodyHeld: false,
      persistentCustody: { held: false },
      cycleCount: 4, successCount: 1, failureCount: 3, consecutiveFailureCount: 2,
      currentCycleId: '', lastCycleId: 'guardian-cycle-4',
      lastStartedAtUtc: new Date(NOW - 20_000).toISOString(),
      lastCompletedAtUtc: new Date(NOW - 10_000).toISOString(),
      lastOk: false, lastBlocker: 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN',
      lastFinalVerdict: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED',
      lastActionId: 'repair-goal-builder-flow', lastActionOk: false,
      lastReportOk: true, lastReportOutcome: 'BLOCKED', lastReportStatus: 'ATTENTION_REQUIRED',
      lastReportBlocker: '', lastSourceHead: MAINTENANCE_HEAD, nextDelayMs: 120_000,
      ...guardian,
    },
    ...overrides,
  };
}

function observation(guardian = {}, overrides = {}) {
  return projectLocalCommanderHealth(health(guardian, overrides), NOW);
}

test('live guardian state is separate from historical repair and source adoption', () => {
  const beacon = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD, now: new Date(NOW), sovereignCommanderObservation: observation(),
  });
  const status = beacon.sovereignCommander;
  assert.equal(status.available, true);
  assert.equal(status.state, 'SERVICE_REACHABLE');
  assert.equal(status.guardian.operationalState, 'WAITING');
  assert.equal(status.guardian.lastOk, false);
  assert.equal(status.guardian.lastBlocker, 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN');
  assert.equal(status.guardian.lastReportOutcome, 'BLOCKED');
  assert.equal(status.guardian.configuredRetryDelayMs, 120_000);
  assert.equal(status.guardian.lastCompletedAgeMs, 10_000);
  assert.equal(status.guardian.lastSourceHead, MAINTENANCE_HEAD);
  assert.equal(beacon.sourceHead, HEAD);
  assert.equal(Object.hasOwn(status, 'sourceHead'), false);
  assert.equal(Object.hasOwn(status, 'runtimeHead'), false);
  assert.equal(Object.hasOwn(status.guardian, 'nextAttemptAtUtc'), false);
  assert.equal(beacon.sovereignRepairContinuity.twoDistinctMaintenanceCompletionsObserved, false);
  for (const field of AUTHORITY_FIELDS) assert.equal(status[field], false, field);
});

test('current custody, missing next cycle and active work remain distinct', () => {
  const cases = [
    [{ timeoutCustodyHeld: true, running: true }, 'HELD'],
    [{ persistentCustody: { held: true }, scheduled: false }, 'HELD'],
    [{ running: true, maintenanceInFlight: true, persistentCustody: { held: true } }, 'WORKING'],
    [{ enabled: false, scheduled: false }, 'DISABLED'],
    [{ scheduled: false }, 'NO_NEXT_CYCLE'],
    [{ maintenanceInFlight: undefined }, 'UNKNOWN'],
  ];
  for (const [guardian, expected] of cases) {
    const projected = projectSovereignCommanderBeaconFacts(observation(guardian), NOW);
    assert.equal(projected.guardian.operationalState, expected);
    assert.equal(projected.executionProven, false);
  }
});

test('publication rechecks heartbeat freshness and recalculates ages', () => {
  const status = observation();
  const current = projectSovereignCommanderBeaconFacts({ ...status, heartbeatAgeMs: 0 }, NOW + 5000);
  assert.equal(current.heartbeatAgeMs, 6000);
  assert.equal(current.guardian.lastCompletedAgeMs, 15_000);
  for (const value of [
    status,
    { ...status, observedAtUtc: new Date(NOW + 120_000).toISOString() },
  ]) {
    const rejected = projectSovereignCommanderBeaconFacts(value, NOW + 61_000);
    assert.equal(rejected.state, 'UNKNOWN');
    assert.equal(rejected.available, false);
    assert.equal(rejected.guardian, null);
    assert.equal(rejected.blocker, 'COMMANDER_HEALTH_TIMESTAMP_NOT_CURRENT');
  }
});

test('public projection removes unknown fields and recomputes a forged guardian state', () => {
  const status = observation({ scheduled: false });
  const projected = projectSovereignCommanderBeaconFacts({
    ...status, privatePath: 'PRIVATE_SENTINEL', rawLogs: 'PRIVATE_SENTINEL',
    state: 'ALL_REPAIR_COMPLETE',
    guardian: {
      ...status.guardian, operationalState: 'WORKING',
      privateToken: 'PRIVATE_SENTINEL', nextAttemptAtUtc: 'PRIVATE_SENTINEL',
      lastBlocker: 'C:\\Private\\secret', lastSourceHead: `${HEAD}-private-suffix`,
    },
  }, NOW);
  assert.equal(projected.state, 'SERVICE_REACHABLE');
  assert.equal(projected.guardian.operationalState, 'NO_NEXT_CYCLE');
  assert.equal(projected.guardian.lastBlocker, '');
  assert.equal(projected.guardian.lastSourceHead, '');
  const body = buildBattleBridgeOutboundBeaconBody(buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD, now: new Date(NOW), sovereignCommanderObservation: projected,
  }));
  assert.doesNotMatch(body, /PRIVATE_SENTINEL|private-suffix|ALL_REPAIR_COMPLETE/);
});

test('missing, malformed and authority-bearing observations cannot become healthy', () => {
  const status = observation();
  assert.equal(projectSovereignCommanderBeaconFacts(null, NOW).blocker, 'COMMANDER_HEALTH_NOT_OBSERVED');
  for (const value of [
    [], {}, { ...status, schemaVersion: 'other' }, { ...status, localLoopbackOnly: false },
    { ...status, readOnly: false }, { ...status, healthy: 'true' },
    ...AUTHORITY_FIELDS.map(field => ({ ...status, [field]: true })),
  ]) {
    const result = projectSovereignCommanderBeaconFacts(value, NOW);
    assert.equal(result.available, false);
    assert.equal(result.guardian, null);
    for (const field of AUTHORITY_FIELDS) assert.equal(result[field], false, field);
  }
});

test('unreachable fixed health stays explicit and does not prevent the beacon', async () => {
  let reads = 0;
  const record = await runObservedBattleBridgeOutboundHealthBeacon({
    sourceHead: HEAD, now: new Date(NOW),
    sovereignCommanderObservation: observation(),
  }, {
    readCommanderStatus: () => readSovereignCommanderStatus({
      fetchFn: async (url, init) => {
        reads++;
        assert.equal(url, COMMANDER_LOCAL_HEALTH_URL);
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        throw new Error('PRIVATE_SENTINEL');
      }, nowMs: () => NOW,
    }),
    runBeacon: options => buildBattleBridgeOutboundBeacon(options),
  });
  assert.equal(reads, 1);
  assert.equal(record.sovereignCommander.blocker, 'COMMANDER_HEALTH_UNREACHABLE');
  assert.equal(record.sovereignCommander.healthy, false);
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE_SENTINEL/);
  const failure = { ...record.sovereignCommander, blocker: 'PRIVATE_SENTINEL' };
  assert.equal(projectSovereignCommanderBeaconFacts(failure, NOW).blocker, 'COMMANDER_HEALTH_UNVERIFIED');
});

test('asynchronous collection finishes once before the synchronous publisher runs', async () => {
  const events = [];
  const fresh = observation();
  const originalOptions = { sentinel: true, sovereignCommanderObservation: null };
  const result = await runObservedBattleBridgeOutboundHealthBeacon(originalOptions, {
    readCommanderStatus: async () => {
      events.push('read');
      await Promise.resolve();
      events.push('observed');
      return fresh;
    },
    runBeacon: options => {
      events.push('publish');
      assert.equal(options.sovereignCommanderObservation, fresh);
      assert.equal(options.sentinel, true);
      return { ok: true, publication: 'TEST_PUBLISHED' };
    },
  });
  assert.deepEqual(events, ['read', 'observed', 'publish']);
  assert.deepEqual(result, { ok: true, publication: 'TEST_PUBLISHED' });
  assert.equal(originalOptions.sovereignCommanderObservation, null);
});
