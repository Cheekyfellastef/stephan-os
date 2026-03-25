import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeStatusModel } from './runtimeStatusModel.mjs';
import { deriveExpectedProviderEligibility, evaluateRuntimeGuardrails } from './runtimeGuardrails.mjs';

test('deriveExpectedProviderEligibility keeps provider truth derived from finalRoute semantics', () => {
  const eligibility = deriveExpectedProviderEligibility({
    routeKind: 'home-node',
    routeEvaluations: {
      'home-node': { available: true },
    },
    backendAvailable: true,
    localAvailable: true,
    cloudAvailable: true,
  });

  assert.deepEqual(eligibility, {
    truthfulBackendRoute: true,
    backendMediatedProviders: true,
    localProviders: true,
    cloudProviders: true,
    distFallbackOnly: false,
    mockFallbackOnly: false,
    selectedRouteAvailable: true,
  });
});

test('createRuntimeStatusModel publishes a clean guardrails report for a healthy home-node route without changing route selection', () => {
  const status = createRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeMode: 'auto',
    providerHealth: {
      ollama: { ok: true },
      groq: { ok: true },
    },
    backendAvailable: true,
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example',
      apiBaseUrl: 'http://192.168.0.198:8787',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTargetUsed: 'http://192.168.0.198:8787',
      nodeAddressSource: 'manual',
      homeNode: {
        host: '192.168.0.198',
        backendPort: 8787,
        source: 'manual',
        reachable: true,
      },
      routeDiagnostics: {
        'home-node': {
          configured: true,
          available: true,
          target: 'http://192.168.0.198:8787',
          actualTarget: 'http://192.168.0.198:8787',
          source: 'manual',
        },
      },
    },
  });

  assert.equal(status.routeKind, 'home-node');
  assert.equal(status.finalRoute.routeKind, 'home-node');
  assert.equal(status.guardrails.ok, true);
  assert.equal(status.guardrails.summary.errors, 0);
  assert.equal(status.guardrails.summary.warnings, 0);
});

test('guardrails catch loopback contamination in non-local sessions', () => {
  const report = evaluateRuntimeGuardrails({
    appLaunchState: 'ready',
    backendAvailable: true,
    localAvailable: false,
    cloudAvailable: true,
    routeKind: 'home-node',
    preferredTarget: 'http://localhost:8787',
    actualTargetUsed: 'http://localhost:8787',
    nodeAddressSource: 'manual',
    runtimeContext: {
      sessionKind: 'hosted-web',
      finalRoute: {
        routeKind: 'home-node',
        source: 'manual',
        preferredTarget: 'http://localhost:8787',
        actualTarget: 'http://localhost:8787',
      },
    },
    finalRoute: {
      routeKind: 'home-node',
      source: 'manual',
      preferredTarget: 'http://localhost:8787',
      actualTarget: 'http://localhost:8787',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {
        truthfulBackendRoute: true,
        backendMediatedProviders: true,
        localProviders: false,
        cloudProviders: true,
        distFallbackOnly: false,
        mockFallbackOnly: false,
        selectedRouteAvailable: true,
      },
    },
    routeEvaluations: {
      'home-node': {
        available: true,
        actualTarget: 'http://localhost:8787',
        target: 'http://localhost:8787',
      },
    },
  });

  assert.equal(report.hasErrors, true);
  assert.ok(report.errors.some((issue) => issue.id === 'loopback-contamination'));
  assert.ok(report.errors.some((issue) => issue.id === 'home-node-loopback-target'));
});

test('guardrails catch truth fragmentation when top-level route fields diverge from finalRoute', () => {
  const report = evaluateRuntimeGuardrails({
    appLaunchState: 'ready',
    backendAvailable: true,
    localAvailable: true,
    cloudAvailable: false,
    routeKind: 'cloud',
    preferredTarget: 'https://stephanos.example',
    actualTargetUsed: 'https://api.stephanos.example',
    nodeAddressSource: 'backend-cloud-session',
    runtimeContext: {
      sessionKind: 'hosted-web',
      finalRoute: {
        routeKind: 'cloud',
        source: 'backend-cloud-session',
        preferredTarget: 'https://stephanos.example',
        actualTarget: 'https://api.stephanos.example',
      },
    },
    finalRoute: {
      routeKind: 'home-node',
      source: 'manual',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {
        truthfulBackendRoute: true,
        backendMediatedProviders: true,
        localProviders: true,
        cloudProviders: false,
        distFallbackOnly: false,
        mockFallbackOnly: false,
        selectedRouteAvailable: true,
      },
    },
    routeEvaluations: {
      'home-node': { available: true },
    },
  });

  assert.equal(report.hasErrors, true);
  assert.ok(report.errors.some((issue) => issue.id === 'single-route-truth-authority'));
  assert.ok(report.errors.some((issue) => issue.id === 'single-route-truth-projection'));
});

test('guardrails catch fallback-only masking when dist is active despite a reachable live route', () => {
  const report = evaluateRuntimeGuardrails({
    appLaunchState: 'ready',
    backendAvailable: true,
    localAvailable: true,
    cloudAvailable: true,
    routeKind: 'dist',
    preferredTarget: 'https://stephanos.example/apps/stephanos/dist/',
    actualTargetUsed: 'https://stephanos.example/apps/stephanos/dist/',
    runtimeContext: {
      sessionKind: 'hosted-web',
      finalRoute: {
        routeKind: 'dist',
        source: 'dist-entry',
        preferredTarget: 'https://stephanos.example/apps/stephanos/dist/',
        actualTarget: 'https://stephanos.example/apps/stephanos/dist/',
      },
    },
    finalRoute: {
      routeKind: 'dist',
      source: 'dist-entry',
      preferredTarget: 'https://stephanos.example/apps/stephanos/dist/',
      actualTarget: 'https://stephanos.example/apps/stephanos/dist/',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {
        truthfulBackendRoute: false,
        backendMediatedProviders: false,
        localProviders: false,
        cloudProviders: false,
        distFallbackOnly: true,
        mockFallbackOnly: true,
        selectedRouteAvailable: true,
      },
    },
    routeEvaluations: {
      'home-node': { available: true },
      dist: { available: true },
    },
  });

  assert.equal(report.hasErrors, true);
  assert.ok(report.errors.some((issue) => issue.id === 'fallback-only-discipline'));
});

test('guardrails emit a warning when local-desktop truth points at a non-loopback target', () => {
  const report = evaluateRuntimeGuardrails({
    appLaunchState: 'ready',
    backendAvailable: true,
    localAvailable: true,
    cloudAvailable: false,
    routeKind: 'local-desktop',
    preferredTarget: 'http://192.168.0.198:8787',
    actualTargetUsed: 'http://192.168.0.198:8787',
    nodeAddressSource: 'local-backend-session',
    runtimeContext: {
      sessionKind: 'local-desktop',
      finalRoute: {
        routeKind: 'local-desktop',
        source: 'local-backend-session',
        preferredTarget: 'http://192.168.0.198:8787',
        actualTarget: 'http://192.168.0.198:8787',
      },
    },
    finalRoute: {
      routeKind: 'local-desktop',
      source: 'local-backend-session',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {
        truthfulBackendRoute: true,
        backendMediatedProviders: true,
        localProviders: true,
        cloudProviders: false,
        distFallbackOnly: false,
        mockFallbackOnly: false,
        selectedRouteAvailable: true,
      },
    },
    routeEvaluations: {
      'local-desktop': { available: true },
    },
  });

  assert.equal(report.hasErrors, false);
  assert.equal(report.hasWarnings, true);
  assert.ok(report.warnings.some((issue) => issue.id === 'local-desktop-non-loopback-suspicious'));
});

test('guardrails catch finalRouteTruth projection drift across route and provider fields', () => {
  const report = evaluateRuntimeGuardrails({
    appLaunchState: 'ready',
    backendAvailable: true,
    localAvailable: true,
    cloudAvailable: true,
    selectedProvider: 'ollama',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    runtimeContext: {
      sessionKind: 'hosted-web',
      finalRoute: {
        routeKind: 'cloud',
        source: 'backend-cloud-session',
        preferredTarget: 'https://stephanos.example',
        actualTarget: 'https://api.stephanos.example',
      },
    },
    finalRoute: {
      routeKind: 'cloud',
      source: 'backend-cloud-session',
      preferredTarget: 'https://stephanos.example',
      actualTarget: 'https://api.stephanos.example',
      reachability: { selectedRouteReachable: true },
      providerEligibility: deriveExpectedProviderEligibility({
        routeKind: 'cloud',
        backendAvailable: true,
        localAvailable: true,
        cloudAvailable: true,
      }),
    },
    finalRouteTruth: {
      routeKind: 'home-node',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      source: 'manual',
      requestedProvider: 'mock',
      selectedProvider: 'mock',
      executedProvider: 'mock',
    },
    routeEvaluations: {
      cloud: { available: true },
    },
  });

  assert.equal(report.hasErrors, true);
  assert.ok(report.errors.some((issue) => issue.id === 'final-route-truth-projection'));
});

test('guardrails reject backend-only home-node claims when uiReachable is false but routeUsable is true', () => {
  const report = evaluateRuntimeGuardrails({
    appLaunchState: 'ready',
    backendAvailable: true,
    localAvailable: true,
    cloudAvailable: false,
    selectedProvider: 'ollama',
    routeSelectedProvider: 'ollama',
    activeProvider: 'ollama',
    runtimeContext: {
      sessionKind: 'hosted-web',
      finalRoute: {
        routeKind: 'home-node',
        source: 'manual',
        preferredTarget: 'http://192.168.0.198:8787',
        actualTarget: 'http://192.168.0.198:8787',
      },
    },
    finalRoute: {
      routeKind: 'home-node',
      source: 'manual',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      reachability: { selectedRouteReachable: true },
      providerEligibility: deriveExpectedProviderEligibility({
        routeKind: 'home-node',
        backendAvailable: true,
        localAvailable: true,
        cloudAvailable: false,
      }),
    },
    finalRouteTruth: {
      routeKind: 'home-node',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      source: 'manual',
      requestedProvider: 'ollama',
      selectedProvider: 'ollama',
      executedProvider: 'ollama',
      uiReachable: false,
      routeUsable: true,
    },
    routeEvaluations: {
      'home-node': { available: true },
    },
  });

  assert.equal(report.hasErrors, true);
  assert.ok(report.errors.some((issue) => issue.id === 'backend-only-home-node-not-usable'));
});
