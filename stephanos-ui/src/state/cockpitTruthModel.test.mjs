import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCockpitModel, deriveConnectionState, NODE_LAYOUT } from './cockpitTruthModel.js';

test('cockpit layout places memory halfway between backend and operator', () => {
  const midpointY = (NODE_LAYOUT.backend.y + NODE_LAYOUT.operator.y) / 2;
  assert.equal(NODE_LAYOUT.memory.y, midpointY);
  assert.equal(NODE_LAYOUT.memory.x, NODE_LAYOUT.backend.x);
});

test('cockpit continuity mapping keeps backend-memory trace inactive without real recent activity', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'ready',
      localAvailable: true,
      cloudAvailable: true,
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        tile: { ready: true },
        reachabilityTruth: { localAvailable: true, cloudAvailable: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      uiReachableState: 'yes',
      executedProvider: 'groq',
      selectedProvider: 'groq',
    },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.equal(model.connectionStates['backend-memory'], 'degraded');
  assert.deepEqual(model.animatedConnectionIds, []);
});

test('deriveConnectionState marks backend-memory trace active when continuity activity is recent', () => {
  const state = deriveConnectionState({
    connection: { id: 'backend-memory', from: 'backend', to: 'memory' },
    nodeStates: { backend: 'active', memory: 'active' },
    activeSurface: 'localSurface',
    fallbackActive: false,
    routeUsableState: 'yes',
    routeReachableState: 'yes',
    uiReachableState: 'yes',
    executionActive: false,
    continuitySnapshot: { recentActivityActive: true, continuityLoopState: 'live' },
  });

  assert.equal(state, 'active');
});

test('cockpit model only animates traces with real recent activity or active execution', () => {
  const recentTimestamp = new Date().toISOString();
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'ready',
      executionTruth: 'idle',
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        tile: { ready: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      uiReachableState: 'yes',
      executedProvider: 'groq',
      selectedProvider: 'groq',
    },
    commandHistory: [],
    telemetryEntries: [{
      id: 'evt-1',
      subsystem: 'MEMORY',
      change: 'continuity memory write observed',
      timestamp: recentTimestamp,
    }],
  });

  assert.deepEqual(model.animatedConnectionIds, ['backend-aiProviders', 'backend-memory', 'backend-execution']);
  assert.deepEqual(model.animatedNodeIds, ['memory', 'execution', 'aiProviders']);
});

test('cockpit model animates backend-memory trace when telemetry memory transition is recent', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'idle',
      executionTruth: 'idle',
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        tile: { ready: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      uiReachableState: 'yes',
      executedProvider: 'groq',
      selectedProvider: 'groq',
    },
    commandHistory: [],
    telemetryEntries: [{
      id: 'evt-1',
      subsystem: 'MEMORY',
      change: 'degraded → live',
      timestamp: new Date().toISOString(),
    }],
  });

  assert.equal(model.connectionStates['backend-memory'], 'active');
  assert.ok(model.animatedConnectionIds.includes('backend-memory'));
});

test('cockpit model keeps non-selected surface inactive instead of degraded', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'degraded',
      localAvailable: true,
      cloudAvailable: true,
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        reachabilityTruth: { localAvailable: true, cloudAvailable: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'no',
      uiReachableState: 'yes',
      executedProvider: 'ollama',
      selectedProvider: 'ollama',
    },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.equal(model.nodeStates.localSurface, 'degraded');
  assert.equal(model.nodeStates.hostedSurface, 'inactive');
  assert.equal(model.connectionStates['operator-localSurface'], 'degraded');
  assert.equal(model.connectionStates['operator-hostedSurface'], 'inactive');
});

test('cockpit model degrades provider path when selected and executed providers mismatch', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'ready',
      localAvailable: true,
      cloudAvailable: true,
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        reachabilityTruth: { localAvailable: true, cloudAvailable: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      uiReachableState: 'yes',
      selectedProvider: 'ollama',
      executedProvider: 'groq',
      providerMismatch: true,
    },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.equal(model.nodeStates.aiProviders, 'degraded');
  assert.equal(model.connectionStates['backend-aiProviders'], 'degraded');
});

test('cockpit model marks route contradiction as inconsistent (amber) instead of degraded', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'ready',
      localAvailable: true,
      cloudAvailable: true,
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        reachabilityTruth: { localAvailable: true, cloudAvailable: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      truthInconsistent: true,
      uiReachableState: 'yes',
      executedProvider: 'ollama',
      selectedProvider: 'ollama',
    },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.equal(model.nodeStates.localSurface, 'inconsistent');
  assert.equal(model.connectionStates['operator-localSurface'], 'inconsistent');
});

test('cockpit model treats retrieval-active continuity mode as active memory flow', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'ready',
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      uiReachableState: 'yes',
      executedProvider: 'groq',
      selectedProvider: 'groq',
    },
    commandHistory: [{
      id: 'cmd-1',
      continuity_mode: 'retrieval-active',
      timestamp: new Date().toISOString(),
    }],
    telemetryEntries: [],
  });

  assert.equal(model.nodeStates.memory, 'active');
  assert.ok(model.animatedNodeIds.includes('memory'));
});
