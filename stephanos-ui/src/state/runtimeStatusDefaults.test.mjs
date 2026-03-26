import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureRuntimeStatusModel } from './runtimeStatusDefaults.js';

test('ensureRuntimeStatusModel keeps finalRoute as authoritative for top-level route projections', () => {
  const normalized = ensureRuntimeStatusModel({
    routeKind: 'cloud',
    preferredTarget: 'https://wrong.example',
    actualTargetUsed: 'https://wrong.example/api',
    nodeAddressSource: 'wrong-source',
    finalRoute: {
      routeKind: 'home-node',
      preferredTarget: 'http://192.168.0.198:8787',
      actualTarget: 'http://192.168.0.198:8787',
      source: 'manual',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
  });

  assert.equal(normalized.routeKind, 'home-node');
  assert.equal(normalized.preferredTarget, 'http://192.168.0.198:8787');
  assert.equal(normalized.actualTargetUsed, 'http://192.168.0.198:8787');
  assert.equal(normalized.nodeAddressSource, 'manual');
});

test('ensureRuntimeStatusModel projects requested/selected provider truth without inferring executable provider', () => {
  const normalized = ensureRuntimeStatusModel({
    selectedProvider: 'ollama',
    routeSelectedProvider: 'groq',
    activeProvider: 'groq',
    fallbackActive: true,
    finalRoute: {
      routeKind: 'local-desktop',
      preferredTarget: 'http://localhost:8787',
      actualTarget: 'http://localhost:8787',
      source: 'local-backend-session',
      reachability: { selectedRouteReachable: true },
      providerEligibility: {},
    },
  });

  assert.equal(normalized.finalRouteTruth.requestedProvider, 'ollama');
  assert.equal(normalized.finalRouteTruth.selectedProvider, 'groq');
  assert.equal(normalized.finalRouteTruth.executedProvider, '');
  assert.equal(normalized.finalRouteTruth.fallbackActive, true);
});

test('ensureRuntimeStatusModel keeps ui reachability tri-state compatible with legacy boolean', () => {
  const fromTriState = ensureRuntimeStatusModel({
    finalRouteTruth: {
      uiReachabilityState: 'reachable',
      uiReachable: false,
    },
  });
  const fromLegacy = ensureRuntimeStatusModel({
    finalRouteTruth: {
      uiReachable: true,
    },
  });

  assert.equal(fromTriState.finalRouteTruth.uiReachabilityState, 'reachable');
  assert.equal(fromLegacy.finalRouteTruth.uiReachabilityState, 'reachable');
});
