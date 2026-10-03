import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_HANDOFF_FAST_RELAY_HEARTBEAT_MAX_AGE_MS,
  projectChatHandoffContinuity,
} from './chatHandoffContinuityV1.mjs';

const NOW = Date.parse('2026-10-03T18:50:00.000Z');

function relay(overrides = {}) {
  return {
    daemonHealthy: true,
    carrierHealthy: true,
    heartbeatAtUtc: new Date(NOW - 5_000).toISOString(),
    deliveryState: 'FAST_ACTIVE',
    scheduledMailboxFallbackExpected: true,
    ...overrides,
  };
}

function project(sovereignRelay) {
  return projectChatHandoffContinuity({
    directHandoffStatus: 'REJECTED',
    localSovereignCommanderAvailable: false,
    scheduledMailboxAvailable: true,
    tailscalePrivateAvailable: true,
    sovereignRelay,
  }, { nowMs: NOW });
}

test('fresh healthy Sovereign Relay fast evidence wins over slower fallbacks', () => {
  const result = project(relay());
  assert.equal(result.selectedRoute, 'SOVEREIGN_RELAY_FAST_CARRIER');
  assert.equal(result.relayHeartbeatCurrent, true);
  assert.equal(result.relayCarrierHealthy, true);
  assert.equal(result.relayHeartbeatAgeMs, 5_000);
});

test('stale relay heartbeat cannot suppress the scheduled mailbox fallback', () => {
  const result = project(relay({
    heartbeatAtUtc: new Date(NOW - CHAT_HANDOFF_FAST_RELAY_HEARTBEAT_MAX_AGE_MS - 1).toISOString(),
  }));
  assert.equal(result.selectedRoute, 'SCHEDULED_GITHUB_MAILBOX');
  assert.equal(result.relayHeartbeatCurrent, false);
});

test('FAST_CHECKING requires proven carrier health before it is selected', () => {
  const blocked = project(relay({ deliveryState: 'FAST_CHECKING', carrierHealthy: false }));
  assert.equal(blocked.selectedRoute, 'SCHEDULED_GITHUB_MAILBOX');
  assert.equal(blocked.relayCarrierHealthy, false);

  const ready = project(relay({ deliveryState: 'FAST_CHECKING', carrierHealthy: true }));
  assert.equal(ready.selectedRoute, 'SOVEREIGN_RELAY_FAST_CARRIER');
});

test('missing or future-dated heartbeat evidence fails closed to a proven fallback', () => {
  for (const heartbeatAtUtc of ['', new Date(NOW + 1).toISOString()]) {
    const result = project(relay({ heartbeatAtUtc }));
    assert.equal(result.selectedRoute, 'SCHEDULED_GITHUB_MAILBOX');
    assert.equal(result.relayHeartbeatCurrent, false);
  }
});
