import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS,
  buildBattleBridgePublisherLiveSlice,
} from './battleBridgePublisherLifecycle.js';

const NOW = '2026-09-07T22:30:00.000Z';

function freshSupervisor(overrides = {}) {
  return {
    generatedAt: '2026-09-07T22:29:30.000Z',
    trafficLight: 'green',
    services: {
      backend8787: { state: 'ready', ready: true },
      openClaw18789: { state: 'ready', ready: true },
      stephanosUi4173: { state: 'ready', ready: true },
    },
    ...overrides,
  };
}

function freshWorker(overrides = {}) {
  return {
    heartbeatAt: '2026-09-07T22:29:45.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    ...overrides,
  };
}

test('fresh canonical supervisor and worker evidence produce a ready live publisher slice', () => {
  const slice = buildBattleBridgePublisherLiveSlice({
    supervisor: freshSupervisor(),
    worker: freshWorker(),
    timestampUtc: NOW,
  });
  assert.equal(slice.status, 'READY');
  assert.equal(slice.finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_READY');
  assert.deepEqual(slice.services.map((entry) => [entry.serviceId, entry.status]), [
    ['backend', 'READY'],
    ['battle-bridge-supervisor', 'READY'],
    ['mission-worker', 'READY'],
    ['openclaw-gateway', 'READY'],
  ]);
});

test('stale supervisor evidence is never repainted current by the minute publisher tick', () => {
  const staleAt = new Date(Date.parse(NOW) - BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS - 1).toISOString();
  const slice = buildBattleBridgePublisherLiveSlice({
    supervisor: freshSupervisor({ generatedAt: staleAt }),
    worker: freshWorker(),
    timestampUtc: NOW,
  });
  assert.equal(slice.status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'backend').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'battle-bridge-supervisor').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'openclaw-gateway').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'mission-worker').status, 'READY');
});

test('fresh negative supervisor state is degraded rather than falsely ready', () => {
  const slice = buildBattleBridgePublisherLiveSlice({
    supervisor: freshSupervisor({
      trafficLight: 'amber',
      services: {
        backend8787: { state: 'blocked', ready: false },
        openClaw18789: { state: 'ready', ready: true },
      },
    }),
    worker: freshWorker(),
    timestampUtc: NOW,
  });
  assert.equal(slice.status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'backend').status, 'DEGRADED');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'battle-bridge-supervisor').status, 'DEGRADED');
});

test('stale or unhealthy worker heartbeat cannot be promoted to ready', () => {
  const staleAt = new Date(Date.parse(NOW) - BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS - 1).toISOString();
  const stale = buildBattleBridgePublisherLiveSlice({
    supervisor: freshSupervisor(),
    worker: freshWorker({ heartbeatAt: staleAt }),
    timestampUtc: NOW,
  });
  assert.equal(stale.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');

  const unhealthy = buildBattleBridgePublisherLiveSlice({
    supervisor: freshSupervisor(),
    worker: freshWorker({ lastTickVerdict: 'MISSION_WORKER_TICK_FAILED' }),
    timestampUtc: NOW,
  });
  assert.equal(unhealthy.services.find((entry) => entry.serviceId === 'mission-worker').status, 'DEGRADED');
});