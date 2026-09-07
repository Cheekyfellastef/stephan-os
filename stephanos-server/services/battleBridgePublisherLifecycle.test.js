import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS,
  buildBattleBridgePublisherLiveSlice,
} from './battleBridgePublisherLifecycle.js';
import {
  DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
  MISSION_WORKER_HEARTBEAT_SCHEMA,
  MISSION_WORKER_TASK_NAME,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';

const NOW = '2026-09-07T22:30:00.000Z';
const REPOSITORY_ROOT = '/repo/stephan-os';
const HEAD_SHA = 'ae72c8d00a5b3ae971bac1e1e527f19320b26987';

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
    schemaVersion: MISSION_WORKER_HEARTBEAT_SCHEMA,
    timestampUtc: '2026-09-07T22:29:45.000Z',
    repositoryRoot: REPOSITORY_ROOT,
    branch: 'main',
    headSha: HEAD_SHA,
    taskName: MISSION_WORKER_TASK_NAME,
    pid: 4242,
    launchIdentityId: 'a'.repeat(64),
    workerStartedAtUtc: '2026-09-07T22:20:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    ...overrides,
  };
}

function liveSlice({ supervisor = freshSupervisor(), worker = freshWorker() } = {}) {
  return buildBattleBridgePublisherLiveSlice({
    supervisor,
    worker,
    timestampUtc: NOW,
    expectedRepositoryRoot: REPOSITORY_ROOT,
    expectedHeadSha: HEAD_SHA,
  });
}

test('fresh canonical supervisor and exact-head worker evidence produce a ready live publisher slice', () => {
  const slice = liveSlice();
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
  const slice = liveSlice({ supervisor: freshSupervisor({ generatedAt: staleAt }) });
  assert.equal(slice.status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'backend').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'battle-bridge-supervisor').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'openclaw-gateway').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'mission-worker').status, 'READY');
});

test('fresh negative supervisor state is degraded rather than falsely ready', () => {
  const slice = liveSlice({
    supervisor: freshSupervisor({
      trafficLight: 'amber',
      services: {
        backend8787: { state: 'blocked', ready: false },
        openClaw18789: { state: 'ready', ready: true },
      },
    }),
  });
  assert.equal(slice.status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'backend').status, 'DEGRADED');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'battle-bridge-supervisor').status, 'DEGRADED');
});

test('worker heartbeat older than the canonical 120-second deadline is unknown even inside supervisor freshness', () => {
  const staleAt = new Date(Date.parse(NOW) - DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS - 1).toISOString();
  const slice = liveSlice({
    worker: freshWorker({
      timestampUtc: staleAt,
      workerStartedAtUtc: new Date(Date.parse(staleAt) - 60_000).toISOString(),
    }),
  });
  assert.equal(slice.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.equal(slice.status, 'UNKNOWN');
});

test('wrong-head or structurally invalid worker heartbeat can never publish ready', () => {
  const wrongHead = liveSlice({ worker: freshWorker({ headSha: 'b'.repeat(40) }) });
  assert.equal(wrongHead.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.equal(wrongHead.status, 'UNKNOWN');

  const invalid = liveSlice({ worker: freshWorker({ schemaVersion: 'wrong.schema' }) });
  assert.equal(invalid.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.equal(invalid.status, 'UNKNOWN');
});

test('non-affirmative worker verdict remains fail closed through canonical validation', () => {
  const slice = liveSlice({ worker: freshWorker({ lastTickVerdict: 'MISSION_WORKER_TICK_FAILED' }) });
  assert.equal(slice.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.equal(slice.status, 'UNKNOWN');
});