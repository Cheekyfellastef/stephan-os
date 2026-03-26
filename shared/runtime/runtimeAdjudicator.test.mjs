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
  assert.equal(adjudicated.runtimeTruth.provider.selectedProvider, 'groq');
  assert.ok(adjudicated.issues.some((issue) => issue.code === 'provider-execution-unvalidated'));
});

test('adjudicator does not promote selected provider when provider health is unknown', () => {
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
  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, '');
  assert.equal(adjudicated.runtimeTruth.provider.providerHealthState, 'unknown');
});

test('adjudicator promotes selected provider only when provider health is ok', () => {
  const adjudicated = adjudicateRuntimeTruth(buildBaseInput({
    selectedProvider: 'groq',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    providerHealth: { groq: { ok: true } },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      routeKind: 'cloud',
      requestedProvider: 'groq',
      selectedProvider: 'groq',
      executedProvider: '',
      backendReachable: true,
      uiReachabilityState: 'reachable',
    },
  }));

  assert.equal(adjudicated.runtimeTruth.provider.selectedProvider, 'groq');
  assert.equal(adjudicated.runtimeTruth.provider.executableProvider, 'groq');
  assert.equal(adjudicated.runtimeTruth.provider.providerHealthState, 'healthy');
});
