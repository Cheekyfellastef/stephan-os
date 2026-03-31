import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinalRouteTruthView } from './finalRouteTruthView.js';
import { summarizeHomeNodeUsabilityTruth } from './homeNodeUsabilityTruth.js';

test('buildFinalRouteTruthView uses canonicalRouteRuntimeTruth over stale top-level projections', () => {
  const view = buildFinalRouteTruthView({
    routeKind: 'cloud',
    preferredTarget: 'https://wrong.example',
    actualTargetUsed: 'https://wrong.example/api',
    selectedProvider: 'mock',
    routeSelectedProvider: 'mock',
    activeProvider: 'mock',
    canonicalRouteRuntimeTruth: {
      winningRoute: 'home-node',
      preferredTarget: 'http://192.168.0.88:8787',
      actualTarget: 'http://192.168.0.88:8787',
      requestedProvider: 'ollama',
      selectedProvider: 'groq',
      executedProvider: 'gemini',
      backendReachable: true,
      uiReachabilityState: 'unreachable',
      routeUsable: false,
      routeReachable: false,
      routeSource: 'manual',
    },
  });

  assert.equal(view.routeKind, 'home-node');
  assert.equal(view.preferredTarget, 'http://192.168.0.88:8787');
  assert.equal(view.actualTarget, 'http://192.168.0.88:8787');
  assert.equal(view.requestedProvider, 'ollama');
  assert.equal(view.selectedProvider, 'groq');
  assert.equal(view.executedProvider, 'gemini');
});

test('buildFinalRouteTruthView keeps provider stages unknown when canonical provider truth is missing', () => {
  const view = buildFinalRouteTruthView({
    selectedProvider: 'mock',
    activeProvider: 'mock',
    routeKind: 'cloud',
  });

  assert.equal(view.requestedProvider, 'unknown');
  assert.equal(view.selectedProvider, 'unknown');
  assert.equal(view.executedProvider, 'unknown');
  assert.equal(view.routeKind, 'unavailable');
});

test('buildFinalRouteTruthView prefers adjudicated executable provider over selected provider', () => {
  const view = buildFinalRouteTruthView({
    canonicalRouteRuntimeTruth: {
      winningRoute: 'cloud',
      requestedProvider: 'ollama',
      selectedProvider: 'groq',
      executedProvider: '',
    },
  });

  assert.equal(view.requestedProvider, 'ollama');
  assert.equal(view.selectedProvider, 'groq');
  assert.equal(view.executedProvider, 'unknown');
});

test('buildFinalRouteTruthView marks uiReachable and route usability unknown while pending', () => {
  const view = buildFinalRouteTruthView({
    appLaunchState: 'pending',
    canonicalRouteRuntimeTruth: {
      winningRoute: 'unavailable',
    },
  });

  assert.equal(view.uiReachableState, 'unknown');
  assert.equal(view.routeUsableState, 'unknown');
});

test('buildFinalRouteTruthView prefers tri-state ui reachability from canonicalRouteRuntimeTruth', () => {
  const view = buildFinalRouteTruthView({
    appLaunchState: 'ready',
    canonicalRouteRuntimeTruth: {
      winningRoute: 'home-node',
      uiReachabilityState: 'unreachable',
      uiReachable: true,
    },
  });

  assert.equal(view.uiReachableState, 'no');
});

test('summarizeHomeNodeUsabilityTruth prevents backend-only availability inflation', () => {
  const truth = summarizeHomeNodeUsabilityTruth({
    backendReachable: true,
    uiReachable: null,
  });

  assert.equal(truth.usable, false);
  assert.equal(truth.fallbackActive, true);
  assert.match(truth.routeReason, /UI\/client reachability is still unknown/);
});
