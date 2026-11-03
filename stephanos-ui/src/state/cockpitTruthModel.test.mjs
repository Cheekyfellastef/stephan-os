import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCockpitModel, deriveBackendServiceState, deriveCockpitBackendHealthDiagnostics, deriveConnectionState, NODE_LAYOUT } from './cockpitTruthModel.js';

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
  const checkedAt = new Date().toISOString();
  const model = buildCockpitModel({
    apiStatus: {
      backendReachable: true, lastCheckedAt: checkedAt,
      meta: { ok: true, service: 'stephanos-server', schemaVersion: 'stephanos.backend-health.v1', backendIdentity: { runtimeId: 'stephanos-battle-bridge-backend' } },
      runtimeContext: { healthProbeTruth: { lastBackendHealthProbeAt: checkedAt, lastBackendHealthProbeResult: 'ok:true' } },
    },
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

test('cockpit model consumes projected agent truth to animate execution when an agent is acting', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'ready',
      executionTruth: 'idle',
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
    finalAgentView: {
      actingAgentId: 'execution-agent',
      activeAgentIds: ['intent-engine', 'execution-agent'],
    },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.ok(model.animatedConnectionIds.includes('backend-execution'));
  assert.ok(model.animatedNodeIds.includes('execution'));
});


test('hosted cockpit does not report backend dead when only hosted observer reachability is stale', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'degraded',
      localAvailable: true,
      cloudAvailable: true,
      runtimeContext: { sessionKind: 'hosted-web' },
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        reachabilityTruth: { localAvailable: true, cloudAvailable: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'cloud',
      backendReachableState: 'no',
      currentBackendHealthFresh: 'no',
      fallbackActive: false,
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      uiReachableState: 'no',
      executedProvider: 'unknown',
      selectedProvider: 'groq',
    },
    apiStatus: { backendReachable: false },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.equal(model.nodeStates.backend, 'unknown');
  assert.equal(model.connectionStates['hostedSurface-backend'], 'broken');
  assert.notEqual(model.connectionStates['localSurface-backend'], 'broken');
});

test('hosted cockpit reports backend dead only when a fresh backend health proof says it is unreachable', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'degraded',
      runtimeContext: { sessionKind: 'hosted-web' },
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'cloud',
      backendReachableState: 'no',
      currentBackendHealthFresh: 'yes',
      fallbackActive: false,
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      uiReachableState: 'no',
      executedProvider: 'unknown',
      selectedProvider: 'groq',
    },
    apiStatus: { backendReachable: false, lastCheckedAt: new Date().toISOString(), runtimeContext: { healthProbeTruth: { lastBackendHealthProbeAt: new Date().toISOString(), lastBackendHealthProbeResult: 'ok:false:error' } } },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.equal(model.nodeStates.backend, 'dead');
});

test('local cockpit reports failed browser transport separately from backend service health', () => {
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'degraded',
      runtimeContext: { sessionKind: 'local-desktop' },
      runtimeTruth: {
        memory: { sourceUsedOnLoad: 'shared-backend', hydrationCompleted: true },
        provider: { providerHealthState: 'healthy' },
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'no',
      currentBackendHealthFresh: 'no',
      fallbackActive: false,
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      uiReachableState: 'no',
      executedProvider: 'unknown',
      selectedProvider: 'ollama',
    },
    apiStatus: { backendReachable: false },
    commandHistory: [],
    telemetryEntries: [],
  });

  assert.equal(model.nodeStates.backend, 'unknown');
  assert.equal(model.connectionStates['localSurface-backend'], 'broken');
});

test('Cockpit trusts fresh backend identity receipt over a stale negative browser route', () => {
  const checkedAt = new Date().toISOString();
  const model = buildCockpitModel({
    runtimeStatus: {
      appLaunchState: 'degraded',
      runtimeContext: { sessionKind: 'local-desktop' },
      runtimeTruth: { provider: { providerHealthState: 'unknown' } },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      backendReachableState: 'no',
      currentBackendHealthFresh: 'no',
      fallbackActive: false,
      selectedRouteReachableState: 'no',
      routeUsableState: 'no',
      uiReachableState: 'no',
    },
    apiStatus: {
      backendReachable: true,
      lastCheckedAt: checkedAt,
      meta: {
        ok: true,
        service: 'stephanos-server',
        schemaVersion: 'stephanos.backend-health.v1',
        backendIdentity: { runtimeId: 'stephanos-battle-bridge-backend' },
      },
      runtimeContext: {
        healthProbeTruth: {
          lastBackendHealthProbeAt: checkedAt,
          lastBackendHealthProbeResult: 'ok:true',
          currentBackendHealthSource: 'refresh-health-poll',
        },
      },
    },
    telemetryEntries: [],
    commandHistory: [],
  });
  assert.equal(model.nodeStates.backend, 'alive', 'verified service is alive despite a stale route failure');
  assert.equal(model.connectionStates['localSurface-backend'], 'broken', 'browser transport route remains blocked');
});

test('Cockpit does not treat an unverified green API flag as backend identity proof', () => {
  const model = buildCockpitModel({
    runtimeStatus: { appLaunchState: 'pending', runtimeTruth: {} },
    routeTruthView: {
      routeKind: 'local-desktop', backendReachableState: 'unknown',
      currentBackendHealthFresh: 'no', selectedRouteReachableState: 'unknown',
      routeUsableState: 'unknown', uiReachableState: 'unknown',
    },
    apiStatus: { backendReachable: true, meta: null },
  });
  assert.equal(model.nodeStates.backend, 'unknown');
});

test('Cockpit diagnoses fresh verified backend health using its live API receipt', () => {
  const timestamp = '2026-10-08T19:00:00.000Z';
  const apiStatus = {
    backendReachable: true,
    lastCheckedAt: timestamp,
    meta: {
      ok: true,
      service: 'stephanos-server',
      schemaVersion: 'stephanos.backend-health.v1',
      backendIdentity: { runtimeId: 'stephanos-battle-bridge-backend' },
    },
    runtimeContext: {
      healthProbeTruth: {
        lastBackendHealthProbeAt: timestamp,
        lastBackendHealthProbeResult: 'ok:true',
        currentBackendHealthSource: 'refresh-health-poll',
      },
    },
  };
  const fallback = {
    currentBackendHealthFresh: 'no',
    routeTruthHealthSource: 'stale-route-candidate',
  };
  const nowMs = Date.parse(timestamp) + 1000;
  assert.deepEqual(
    deriveCockpitBackendHealthDiagnostics({ apiStatus, routeTruthView: fallback, nowMs }),
    { fresh: 'yes', source: 'refresh-health-poll', checkedAt: timestamp },
  );
  assert.equal(
    deriveCockpitBackendHealthDiagnostics({
      apiStatus: { ...apiStatus, meta: { ...apiStatus.meta, backendIdentity: { runtimeId: 'foreign-service' } } },
      routeTruthView: fallback,
      nowMs,
    }).fresh,
    'no',
  );
  assert.equal(
    deriveCockpitBackendHealthDiagnostics({ apiStatus, routeTruthView: fallback, nowMs: nowMs + 120000 }).fresh,
    'no',
  );
  assert.equal(
    deriveCockpitBackendHealthDiagnostics({
      apiStatus: { ...apiStatus, backendReachable: false },
      routeTruthView: fallback,
      nowMs,
    }).fresh,
    'no',
  );
});

test('Cockpit invalidates a cached verified backend health receipt at the same deadline used by the model', () => {
  const timestamp = '2026-10-12T19:00:00.000Z';
  const initialNow = Date.parse(timestamp) + 1000;
  const apiStatus = {
    backendReachable: true,
    lastCheckedAt: timestamp,
    meta: {
      ok: true, service: 'stephanos-server',
      schemaVersion: 'stephanos.backend-health.v1',
      backendIdentity: { runtimeId: 'stephanos-battle-bridge-backend' },
    },
    runtimeContext: {
      healthProbeTruth: {
        lastBackendHealthProbeAt: timestamp,
        lastBackendHealthProbeResult: 'ok:true',
        currentBackendHealthSource: 'refresh-health-poll',
      },
    },
  };
  const routeTruthView = { backendReachableState: 'no', currentBackendHealthFresh: 'no' };
  assert.equal(deriveBackendServiceState({ apiStatus, routeTruthView, nowMs: initialNow }), 'alive');
  assert.equal(deriveBackendServiceState({ apiStatus, routeTruthView, nowMs: initialNow + 120000 }), 'unknown');

  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../components/CockpitPanel.jsx'), 'utf8');
  assert.match(source, /checkedAt \+ 120_000 \+ 50/);
  assert.match(source, /setBackendHealthExpiryTick\(value => value \+ 1\)/);
  assert.match(source, /telemetryEntries, activityExpiryTick, backendHealthExpiryTick/);
  assert.match(source, /window\.clearTimeout\(timeoutId\)/);
});

test('Cockpit refuses stale negative backend service proof rather than retaining red after standby', () => {
  const at = '2026-10-12T19:00:00.000Z';
  const apiStatus = {
    backendReachable: false,
    lastCheckedAt: at,
    runtimeContext: { healthProbeTruth: { lastBackendHealthProbeAt: at, lastBackendHealthProbeResult: 'ok:false:error' } },
  };
  const routeTruthView = { backendReachableState: 'no', currentBackendHealthFresh: 'yes' };
  assert.equal(deriveBackendServiceState({ apiStatus, routeTruthView, nowMs: Date.parse(at) + 1000 }), 'dead');
  assert.equal(deriveBackendServiceState({ apiStatus, routeTruthView, nowMs: Date.parse(at) + 120100 }), 'unknown');
  const componentSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../components/CockpitPanel.jsx'), 'utf8');
  assert.match(componentSource, /typeof apiStatus\?\.backendReachable !== 'boolean'/);
  assert.doesNotMatch(componentSource, /!apiStatus\?\.backendReachable\) return undefined/);
});

test('Cockpit requires fresh timestamped route proof before displaying Backend alive', () => {
  const at = '2026-10-12T19:00:00.000Z';
  const routeTruthView = { backendReachableState: 'yes', currentBackendHealthFresh: 'yes' };
  const apiStatus = {
    backendReachable: true, lastCheckedAt: at,
    runtimeContext: { healthProbeTruth: { lastBackendHealthProbeAt: at, lastBackendHealthProbeResult: 'ok:true' } },
  };
  assert.equal(deriveBackendServiceState({ routeTruthView, apiStatus, nowMs: Date.parse(at) + 1000 }), 'alive');
  assert.equal(deriveBackendServiceState({ routeTruthView, apiStatus, nowMs: Date.parse(at) + 120100 }), 'unknown');
  assert.equal(deriveBackendServiceState({ routeTruthView, apiStatus: {}, nowMs: Date.parse(at) + 1000 }), 'unknown');
  assert.equal(deriveBackendServiceState({ routeTruthView: { ...routeTruthView, currentBackendHealthFresh: 'no' }, apiStatus, nowMs: Date.parse(at) + 1000 }), 'unknown');
});
