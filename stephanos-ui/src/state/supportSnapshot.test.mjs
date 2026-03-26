import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportSnapshot } from './supportSnapshot.js';

test('buildSupportSnapshot prefers canonical truth and labels unavailable fields', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      localAvailable: true,
      homeNodeReachable: false,
      cloudAvailable: true,
      uiVersion: '1.2.3',
      uiBuildTimestamp: '2026-03-25T00:00:00.000Z',
    },
    routeTruthView: {
      routeKind: 'cloud',
      preferredTarget: 'https://stephanos.example',
      actualTarget: 'https://api.stephanos.example',
      winnerReason: 'cloud route won',
      fallbackActive: false,
      backendReachableState: 'yes',
      uiReachableState: 'yes',
      selectedRouteReachableState: 'yes',
      routeUsableState: 'yes',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      operatorReason: 'No blocking route invariants detected.',
    },
    runtimeSessionTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'desktop',
    },
    runtimeRouteTruth: {
      winningReason: 'cloud route won by adjudicator',
    },
    runtimeReachabilityTruth: {
      uiReachableState: 'reachable',
    },
    runtimeProviderTruth: {
      executableProvider: 'groq',
    },
    runtimeDiagnosticsTruth: {
      blockingIssues: [{ code: 'NONE', detail: 'none' }],
      invariantWarnings: [{ code: 'WARN_1', message: 'minor drift detected' }],
    },
    runtimeContext: {
      routeDiagnostics: {
        cloud: { usable: true, reason: 'public route reachable' },
        home: { usable: false, blockedReason: 'home node offline' },
      },
    },
    safeApiStatus: {
      frontendOrigin: 'https://console.stephanos.example',
    },
    statusSummary: {
      healthState: 'healthy',
      healthReason: 'provider online',
    },
    now: { toISOString: () => '2026-03-25T00:00:01.000Z' },
    href: 'https://console.stephanos.example/status',
  });

  assert.match(snapshot, /Stephanos Support Snapshot/);
  assert.match(snapshot, /Requested Route Mode: auto/);
  assert.match(snapshot, /Winning Reason: cloud route won by adjudicator/);
  assert.match(snapshot, /Selected Provider State: healthy/);
  assert.match(snapshot, /routeDiagnosticsSummary:\n- cloud: usable \(public route reachable\)/);
  assert.match(snapshot, /invariantWarnings:\n- minor drift detected/);
});

test('buildSupportSnapshot prints explicit unavailable markers for empty diagnostics', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {},
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {},
    now: { toISOString: () => '2026-03-25T00:00:02.000Z' },
  });

  assert.match(snapshot, /Origin: n\/a/);
  assert.match(snapshot, /Selected Route Kind: n\/a/);
  assert.match(snapshot, /blockingIssues:\n- n\/a/);
  assert.match(snapshot, /routeDiagnosticsSummary:\n- n\/a/);
});

test('buildSupportSnapshot does not promote selected provider to executable when health is unknown', () => {
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'auto',
    },
    routeTruthView: {
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
    },
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {
      executableProvider: '',
    },
    runtimeDiagnosticsTruth: {},
    runtimeContext: {},
    safeApiStatus: {},
    statusSummary: {
      healthState: 'unknown',
    },
    now: { toISOString: () => '2026-03-26T00:00:02.000Z' },
  });

  assert.match(snapshot, /Last Requested Provider: ollama/);
  assert.match(snapshot, /Selected Provider: ollama/);
  assert.match(snapshot, /Executable Provider: none/);
  assert.match(snapshot, /Selected Provider State: unknown/);
  assert.doesNotMatch(snapshot, /Executable Provider: ollama/);
});
