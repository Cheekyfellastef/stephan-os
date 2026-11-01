import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBattleBridgeOutboundBeaconMaterialBody } from './battle-bridge-outbound-health-beacon-core.mjs';
import {
  buildBattleBridgeOutboundBeacon,
  buildBattleBridgeOutboundBeaconBody,
} from './battle-bridge-outbound-health-beacon.mjs';
import { projectLocalCommanderHealth } from '../stephanos-server/services/sovereignCommanderStatusTool.js';

test('health beacon material digest ignores volatile timestamps and ages but preserves state changes', () => {
  const first = JSON.stringify({
    observedAtUtc: '2026-09-28T15:00:00.000Z',
    surfaces: [{ state: 'GREEN', ageMs: 1000, heartbeatAtUtc: '2026-09-28T14:59:59.000Z' }],
  });
  const second = JSON.stringify({
    observedAtUtc: '2026-09-28T15:01:00.000Z',
    surfaces: [{ state: 'GREEN', ageMs: 61000, heartbeatAtUtc: '2026-09-28T14:59:59.000Z' }],
  });
  const changed = JSON.stringify({
    observedAtUtc: '2026-09-28T15:01:00.000Z',
    surfaces: [{ state: 'BLOCKED', ageMs: 61000, heartbeatAtUtc: '2026-09-28T14:59:59.000Z' }],
  });
  assert.equal(buildBattleBridgeOutboundBeaconMaterialBody(first), buildBattleBridgeOutboundBeaconMaterialBody(second));
  assert.notEqual(buildBattleBridgeOutboundBeaconMaterialBody(first), buildBattleBridgeOutboundBeaconMaterialBody(changed));
});

const NOW = Date.parse('2026-10-30T20:40:00.000Z');

function guardianBeacon(nowMs = NOW, guardianChanges = {}) {
  const sovereignCommanderObservation = projectLocalCommanderHealth({
    service: 'stephanos-sovereign-commander',
    transport: 'authenticated-http-jsonrpc',
    ok: true,
    observedAtUtc: new Date(nowMs).toISOString(),
    continuousRepairGuardian: {
      enabled: true,
      running: false,
      scheduled: true,
      maintenanceInFlight: false,
      timeoutCustodyHeld: false,
      persistentCustody: { held: false },
      cycleCount: 4,
      lastCycleId: 'guardian-cycle-4',
      lastStartedAtUtc: new Date(NOW - 20_000).toISOString(),
      lastCompletedAtUtc: new Date(NOW - 10_000).toISOString(),
      lastReportOutcome: 'BLOCKED',
      nextDelayMs: 120_000,
      ...guardianChanges,
    },
  }, nowMs);
  return buildBattleBridgeOutboundBeacon({
    sourceHead: 'a'.repeat(40),
    now: new Date(nowMs),
    sovereignCommanderObservation,
  });
}

function material(record) {
  return buildBattleBridgeOutboundBeaconMaterialBody(buildBattleBridgeOutboundBeaconBody(record));
}

test('live guardian completion-age changes alone preserve beacon publication material', () => {
  const first = guardianBeacon();
  const nextTick = guardianBeacon(NOW + 60_000);

  assert.equal(first.sovereignCommander.guardian.lastCompletedAgeMs, 10_000);
  assert.equal(nextTick.sovereignCommander.guardian.lastCompletedAgeMs, 70_000);
  assert.notEqual(buildBattleBridgeOutboundBeaconBody(first), buildBattleBridgeOutboundBeaconBody(nextTick));
  assert.equal(material(first), material(nextTick));
});

for (const [label, change, field, expected] of [
  ['cycle identity', { lastCycleId: 'guardian-cycle-5' }, 'lastCycleId', 'guardian-cycle-5'],
  ['completion timestamp', { lastCompletedAtUtc: new Date(NOW - 5_000).toISOString() }, 'lastCompletedAtUtc', new Date(NOW - 5_000).toISOString()],
  ['outcome', { lastReportOutcome: 'MAINTENANCE_COMPLETED' }, 'lastReportOutcome', 'MAINTENANCE_COMPLETED'],
  ['operational state', { scheduled: false }, 'operationalState', 'NO_NEXT_CYCLE'],
]) {
  test(`live guardian ${label} changes remain material for publication`, () => {
    const first = guardianBeacon();
    const changed = guardianBeacon(NOW + 60_000, change);

    assert.equal(changed.sovereignCommander.guardian[field], expected);
    assert.notEqual(first.sovereignCommander.guardian[field], expected);
    assert.notEqual(material(first), material(changed));
  });
}
