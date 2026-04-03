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
