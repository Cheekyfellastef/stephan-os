import test from 'node:test';
import assert from 'node:assert/strict';

import { adjudicateRuntimeTruth } from './runtimeAdjudicator.mjs';

function buildBaseInput(overrides = {}) {
  return {
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      nodeAddressSource: 'manual',
    },
    finalRoute: {
      routeKind: 'home-node',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      source: 'manual',
      winnerReason: 'Home PC node is reachable on the LAN',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      routeKind: 'home-node',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      source: 'manual',
      winnerReason: 'Home PC node is reachable on the LAN',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeEvaluations: {
      'home-node': { available: true, usable: true, reason: 'Home PC node is reachable on the LAN' },
      dist: { available: true, usable: true },
    },
    routePreferenceOrder: ['home-node', 'cloud', 'dist'],
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: { groq: { ok: true } },
    fallbackActive: false,
    validationState: 'healthy',
    appLaunchState: 'ready',
    guardrails: { errors: [], warnings: [] },
    ...overrides,
  };
}

test('adjudicator flags loopback contamination for non-local sessions', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    finalRoute: {
      routeKind: 'home-node',
      preferredTarget: 'http://localhost:8787',
      actualTarget: 'http://localhost:8787',
      source: 'manual',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'home-node',
      preferredTarget: 'http://localhost:8787',
      actualTarget: 'http://localhost:8787',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
  }));

  assert.ok(adjudicated.issues.some((issue) => issue.code === 'non-local-loopback-target'));
});

test('adjudicator keeps backend and ui reachability distinct', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'home-node',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      backendReachable: false,
      uiReachabilityState: 'reachable',
    },
  }));

  assert.equal(adjudicated.runtimeTruth.reachabilityTruth.backendReachable, false);
  assert.equal(adjudicated.runtimeTruth.reachabilityTruth.uiReachableState, 'reachable');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.backendReachable, false);
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.uiReachabilityState, 'reachable');
});

test('adjudicator keeps selected route usable when UI reachability is unknown but not explicitly unreachable', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'home-node',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      backendReachable: true,
      uiReachabilityState: 'unknown',
      routeUsable: true,
    },
    routeEvaluations: {
      'home-node': { available: true, usable: true, reason: 'Home PC node is reachable on the LAN' },
      dist: { available: true, usable: true },
    },
  }));

  assert.equal(adjudicated.runtimeTruth.reachabilityTruth.selectedRouteUsable, true);
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.routeUsable, true);
});

test('adjudicator does not promote selected provider to executable when provider is unvalidated', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: { groq: { ok: false, reason: 'quota exceeded' } },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, '');
  assert.ok(adjudicated.issues.some((issue) => issue.code === 'provider-execution-unvalidated'));
});

test('adjudicator does not promote selected provider to executable when health is unknown', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    selectedProvider: 'ollama',
    routeSelectedProvider: 'ollama',
    activeProvider: 'ollama',
    providerHealth: {},
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.selectedProvider, 'ollama');
  assert.equal(adjudicated.runtimeTruth.provider.providerHealthState, 'unknown');
  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, '');
});

test('adjudicator reports hosted backend execution contract mismatch when route is usable but provider health metadata is missing', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: {
      groq: {
        provider: 'groq',
        config: { enabled: true },
      },
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'home-node',
      routeUsable: true,
      backendReachable: true,
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      uiReachabilityState: 'reachable',
    },
    routeEvaluations: {
      'home-node': { available: true, usable: true, blockedReason: '', reason: 'Home bridge reachable via Tailscale' },
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, '');
  assert.match(adjudicated.runtimeTruth.provider.fallbackReason, /backend execution contract metadata is stale or missing/i);
  assert.ok(adjudicated.issues.some((issue) => issue.code === 'backend-execution-contract-mismatch'));
});

test('adjudicator keeps hosted low-freshness local-private ollama executable on usable home-node tailscale route when provider health is unknown', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      bridgeTransportTruth: {
        tailscale: {
          accepted: true,
          reachable: true,
          usable: true,
        },
      },
      providerExecutionIntent: {
        freshnessNeed: 'low',
        answerMode: 'local-private',
      },
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'home-node',
      routeUsable: true,
      selectedRouteReachable: true,
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: '',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routeEvaluations: {
      'home-node': { available: true, usable: true, blockedReason: '', reason: 'Home bridge reachable via Tailscale' },
    },
    selectedProvider: 'ollama',
    routeSelectedProvider: 'ollama',
    activeProvider: '',
    providerHealth: {},
  }));

  assert.equal(adjudicated.runtimeTruth.provider.selectedProvider, 'ollama');
  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'ollama');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.executedProvider, 'ollama');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.routeUsable, true);
});

test('adjudicator does not promote selected provider to executable when provider health is failed/unhealthy', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    selectedProvider: 'ollama',
    routeSelectedProvider: 'ollama',
    activeProvider: 'ollama',
    providerHealth: { ollama: { ok: false, state: 'FAILED', reason: 'probe failed' } },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.providerHealthState, 'unhealthy');
  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, '');
});

test('adjudicator promotes selected provider to executable when health is ok and provider matches', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    selectedProvider: 'ollama',
    routeSelectedProvider: 'ollama',
    activeProvider: 'ollama',
    providerHealth: { ollama: { ok: true, state: 'OK', provider: 'ollama' } },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: '',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'ollama');
  assert.equal(adjudicated.runtimeTruth.requestedProvider, 'ollama');
  assert.equal(adjudicated.runtimeTruth.selectedProvider, 'ollama');
});

test('adjudicator treats hosted cloud provider selection drift from requested intent as non-fallback when executable matches selected provider', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'ollama',
      selectedProvider: 'groq',
      executedProvider: '',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'ollama',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeSelectedProvider: 'groq',
    selectedProvider: 'ollama',
    activeProvider: 'groq',
    providerHealth: {
      groq: { ok: true, provider: 'groq' },
      ollama: { ok: false, reason: 'offline' },
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'groq');
  assert.equal(adjudicated.runtimeTruth.provider.fallbackProviderUsed, false);
  assert.equal(adjudicated.runtimeTruth.provider.fallbackReason, '');
});

test('adjudicator emits blocking issue when shared write target appears before hydration completes', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      nodeAddressSource: 'manual',
      memoryTruth: {
        hydrationCompleted: false,
        sourceUsedOnLoad: 'local-mirror-fallback',
        writeTarget: 'shared-backend',
      },
    },
  }));

  assert.equal(adjudicated.runtimeTruth.memory.hydrationCompleted, false);
  assert.ok(adjudicated.issues.some((issue) => issue.code === 'memory-write-before-hydration'));
});

test('adjudicator canonical truth keeps provider stages and fallback reason in one snapshot', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'ollama',
      selectedProvider: 'groq',
      executedProvider: '',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'ollama',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeSelectedProvider: 'groq',
    selectedProvider: 'ollama',
    activeProvider: 'groq',
    providerHealth: {
      groq: { ok: true, provider: 'groq' },
      ollama: { ok: false, reason: 'offline' },
    },
  }));

  assert.equal(adjudicated.canonicalRouteRuntimeTruth.requestedProvider, 'ollama');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.selectedProvider, 'groq');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.executedProvider, 'groq');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.fallbackActive, false);
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.fallbackReason, '');
});

test('adjudicator marks fallback when executable provider differs from selected provider', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: '',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeSelectedProvider: 'groq',
    selectedProvider: 'groq',
    activeProvider: 'gemini',
    providerHealth: {
      groq: { ok: false, reason: 'rate-limited' },
      gemini: { ok: true, provider: 'gemini' },
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'gemini');
  assert.equal(adjudicated.runtimeTruth.provider.fallbackProviderUsed, true);
  assert.match(adjudicated.runtimeTruth.provider.fallbackReason, /Selected groq, executed gemini/);
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.fallbackActive, true);
});

test('adjudicator keeps local-desktop route truth when provider degrades to mock fallback', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'local-desktop',
      deviceContext: 'pc-local-browser',
      nodeAddressSource: 'local-backend-session',
    },
    finalRoute: {
      routeKind: 'local-desktop',
      preferredTarget: 'http://localhost:8787',
      actualTarget: 'http://localhost:8787',
      source: 'local-backend-session',
      winnerReason: 'Backend online locally; local-desktop stays valid',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
    finalRouteTruth: {
      sessionKind: 'local-desktop',
      deviceContext: 'pc-local-browser',
      routeKind: 'local-desktop',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'local-first',
      preferredTarget: 'http://localhost:8787',
      actualTarget: 'http://localhost:8787',
      source: 'local-backend-session',
      winnerReason: 'Backend online locally; local-desktop stays valid',
      routeUsable: true,
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: 'mock',
      fallbackActive: true,
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'local-first',
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      localAvailable: true,
      cloudAvailable: false,
    },
    routeEvaluations: {
      'local-desktop': { available: true, usable: true, reason: 'Backend online locally; local-desktop stays valid' },
      dist: { available: true, usable: true },
    },
    routePreferenceOrder: ['local-desktop', 'home-node', 'cloud', 'dist'],
    selectedProvider: 'ollama',
    routeSelectedProvider: 'ollama',
    activeProvider: 'mock',
    providerHealth: {
      ollama: { ok: false, reason: 'offline' },
      mock: { ok: true, provider: 'mock' },
    },
    fallbackActive: true,
  }));

  assert.equal(adjudicated.runtimeTruth.route.selectedRouteKind, 'local-desktop');
  assert.equal(adjudicated.runtimeTruth.reachabilityTruth.selectedRouteUsable, true);
  assert.equal(adjudicated.runtimeTruth.route.fallbackActive, true);
  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'mock');
  assert.equal(adjudicated.runtimeTruth.route.winningReason, 'Backend online locally; local-desktop stays valid');
  assert.match(adjudicated.runtimeTruth.provider.fallbackReason, /Selected ollama, executed mock/);
});

test('adjudicator suppresses tile-readiness contradiction warning for hosted cloud canonical ready truth', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      nodeAddressSource: 'route-diagnostics',
      tileTruth: {
        ready: false,
        reason: 'tile registry still hydrating',
        launchSurface: 'mission-console',
      },
    },
    finalRoute: {
      routeKind: 'cloud',
      preferredTarget: 'https://stephanos.example',
      actualTarget: 'https://api.stephanos.example',
      source: 'backend-cloud-session',
      winnerReason: 'A cloud-backed Stephanos route is ready',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      routeKind: 'cloud',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      preferredTarget: 'https://stephanos.example',
      actualTarget: 'https://api.stephanos.example',
      source: 'backend-cloud-session',
      winnerReason: 'A cloud-backed Stephanos route is ready',
      routeUsable: true,
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeEvaluations: {
      cloud: { available: true, usable: true, reason: 'A cloud-backed Stephanos route is ready' },
      dist: { available: true, usable: true },
    },
    routePreferenceOrder: ['cloud', 'dist'],
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: { groq: { ok: true } },
    fallbackActive: false,
    appLaunchState: 'ready',
  }));

  assert.equal(adjudicated.runtimeTruth.diagnostics.invariantWarnings.some((issue) => issue.code === 'tile-not-ready-while-runtime-ready'), false);
});

test('adjudicator keeps tile-readiness contradiction warning when canonical hosted cloud truth is not ready', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      nodeAddressSource: 'route-diagnostics',
      tileTruth: {
        ready: false,
        reason: 'tile registry still hydrating',
        launchSurface: 'mission-console',
      },
    },
    finalRoute: {
      routeKind: 'cloud',
      preferredTarget: 'https://stephanos.example',
      actualTarget: 'https://api.stephanos.example',
      source: 'backend-cloud-session',
      winnerReason: 'A cloud-backed Stephanos route is ready',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      routeKind: 'cloud',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      preferredTarget: 'https://stephanos.example',
      actualTarget: 'https://api.stephanos.example',
      source: 'backend-cloud-session',
      winnerReason: 'A cloud-backed Stephanos route is ready',
      routeUsable: true,
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: '',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeEvaluations: {
      cloud: { available: true, usable: true, reason: 'A cloud-backed Stephanos route is ready' },
      dist: { available: true, usable: true },
    },
    routePreferenceOrder: ['cloud', 'dist'],
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: '',
    providerHealth: { groq: { ok: false } },
    fallbackActive: false,
    appLaunchState: 'ready',
  }));

  assert.equal(adjudicated.runtimeTruth.diagnostics.invariantWarnings.some((issue) => issue.code === 'tile-not-ready-while-runtime-ready'), true);
});

test('adjudicator projects cognitive watcher analysis with protocol-boundary known pattern', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      frontendOrigin: 'https://stephanos.example',
    },
    finalRoute: {
      routeKind: 'home-node',
      preferredTarget: 'https://home.stephanos.example',
      actualTarget: 'http://100.88.0.2:8787',
      source: 'home-bridge-memory',
      winnerReason: 'remembered home bridge target selected',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      routeKind: 'home-node',
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'auto',
      preferredTarget: 'https://home.stephanos.example',
      actualTarget: 'http://100.88.0.2:8787',
      source: 'home-bridge-memory',
      winnerReason: 'remembered home bridge target selected',
      routeUsable: false,
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: 'groq',
      backendReachable: true,
      uiReachabilityState: 'unreachable',
    },
    routePlan: {
      requestedRouteMode: 'auto',
      effectiveRouteMode: 'auto',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeEvaluations: {
      'home-node': { available: true, usable: false, reason: 'blocked on hosted surface policy' },
      cloud: { available: true, usable: true, reason: 'cloud route available' },
    },
    routePreferenceOrder: ['home-node', 'cloud'],
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: { groq: { ok: true } },
    fallbackActive: false,
    appLaunchState: 'degraded',
  }));

  assert.equal(adjudicated.cognitiveAdjudication.mode, 'observer-only');
  assert.equal(adjudicated.cognitiveAdjudication.patternMatches.some((entry) => entry.patternId === 'protocol-boundary-mismatch'), true);
});

test('adjudicator promotes hosted worker to executable provider kind when backend contract cannot validate provider execution', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      hostedCloudConfig: {
        enabled: true,
        selectedProvider: 'groq',
        providers: {
          groq: { enabled: true, baseURL: 'https://worker-groq.example.workers.dev' },
        },
        lastHealth: {
          groq: { status: 'healthy', reachable: true, checkedAt: '2026-04-22T00:00:00.000Z' },
        },
      },
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      backendReachable: true,
      routeUsable: true,
      selectedProvider: 'groq',
      executedProvider: 'groq',
      requestedProvider: 'groq',
    },
    routePlan: {
      requestedRouteMode: 'cloud-first',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeEvaluations: {
      cloud: { available: true, usable: true },
    },
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: {
      groq: { ok: false, state: 'unknown' },
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'hosted-cloud-worker');
  assert.equal(adjudicated.runtimeTruth.provider.actualProviderUsed, 'groq-hosted-cloud');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.providerKind, 'hosted-cloud-worker');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.hostedWorkerReachable, true);
});

test('adjudicator allows hosted takeover to alternate provider when selected hosted worker is not executable', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      hostedCloudConfig: {
        enabled: true,
        selectedProvider: 'groq',
        providers: {
          groq: { enabled: true, baseURL: 'https://worker-groq.example.workers.dev' },
          gemini: { enabled: true, baseURL: 'https://worker-gemini.example.workers.dev' },
        },
        lastHealth: {
          groq: { status: 'unhealthy', reachable: false },
          gemini: { status: 'healthy', reachable: true },
        },
      },
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      backendReachable: true,
      routeUsable: true,
      selectedProvider: 'groq',
      executedProvider: 'groq',
      requestedProvider: 'groq',
    },
    routePlan: {
      requestedRouteMode: 'cloud-first',
      effectiveRouteMode: 'cloud-first',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      localAvailable: false,
      cloudAvailable: true,
    },
    routeEvaluations: {
      cloud: { available: true, usable: true },
    },
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: {
      groq: { ok: false, state: 'unknown' },
      gemini: { ok: true, state: 'healthy' },
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'hosted-cloud-worker');
  assert.equal(adjudicated.runtimeTruth.provider.actualProviderUsed, 'gemini-hosted-cloud');
  assert.equal(adjudicated.runtimeTruth.provider.providerSelectionReason, 'backend-stale-selected-provider-unusable-switched-to-hosted-alternative');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.hostedWorkerReachable, true);
});

test('backend stale + hosted worker valid promotes hosted-cloud-worker executable provider truth', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      hostedCloudConfig: {
        enabled: true,
        selectedProvider: 'groq',
        providers: {
          groq: { enabled: true, baseURL: 'https://worker.example.com', model: 'openai/gpt-oss-20b' },
          gemini: { enabled: true, baseURL: '', model: 'gemini-2.5-flash' },
        },
        lastHealth: {
          groq: { reachable: true, ok: true, status: 'healthy' },
        },
      },
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      routeUsable: true,
      backendReachable: false,
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: '',
      uiReachabilityState: 'reachable',
    },
    routeEvaluations: {
      cloud: { available: true, usable: true, reason: 'Hosted route available' },
      dist: { available: true, usable: true },
    },
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: '',
    providerHealth: {},
  }));

  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'hosted-cloud-worker');
  assert.equal(adjudicated.runtimeTruth.provider.actualProviderUsed, 'groq-hosted-cloud');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.executedProvider, 'hosted-cloud-worker');
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.cloudCognitionAvailable, true);
});

test('canonical caravan mode remains staged-only when local authority unavailable', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    runtimeContext: {
      sessionKind: 'hosted-web',
      deviceContext: 'off-network',
      hostedCloudConfig: {
        enabled: true,
        selectedProvider: 'groq',
        providers: { groq: { enabled: true, baseURL: 'https://worker.example.com', model: 'openai/gpt-oss-20b' } },
        lastHealth: { groq: { reachable: true, ok: true, status: 'healthy' } },
      },
    },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      routeUsable: true,
      backendReachable: false,
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: '',
      uiReachabilityState: 'reachable',
    },
    routeEvaluations: {
      cloud: { available: true, usable: true, reason: 'Hosted route available' },
      dist: { available: true, usable: true },
    },
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: '',
    providerHealth: {},
  }));

  assert.equal(adjudicated.canonicalRouteRuntimeTruth.caravanMode.isActive, true);
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.caravanMode.canonCommitAllowed, false);
  assert.equal(adjudicated.canonicalRouteRuntimeTruth.caravanMode.promotionDeferred, true);
});
