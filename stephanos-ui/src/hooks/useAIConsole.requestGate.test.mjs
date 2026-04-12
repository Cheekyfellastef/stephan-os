import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRequestDispatchGate } from './requestDispatchGate.js';

test('blocks local execution when canonical selected route is unusable', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'local-private',
      localRouteAvailable: true,
      freshRouteAvailable: false,
      fallbackReasonCode: 'cloud-route-unusable',
    },
    routeTruthView: {
      routeUsableState: 'no',
      backendReachableState: 'yes',
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.reasonCode, 'no-canonical-winning-route');
  assert.equal(gate.localRouteViable, true);
  assert.equal(gate.freshRouteViable, false);
});

test('keeps fallback-stale-risk executable when fresh route is unavailable', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'fallback-stale-risk',
      localRouteAvailable: true,
      freshRouteAvailable: false,
      fallbackReasonCode: 'cloud-route-unusable',
    },
    routeTruthView: {
      backendReachableState: 'yes',
    },
  });

  assert.equal(gate.dispatchAllowed, true);
  assert.equal(gate.localRouteViable, true);
});

test('blocks with route unavailable only when no viable execution path exists', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'fresh-cloud',
      localRouteAvailable: false,
      freshRouteAvailable: false,
      fallbackReasonCode: 'cloud-route-unusable',
    },
    routeTruthView: {
      backendReachableState: 'yes',
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.reasonCode, 'cloud-route-unusable');
});

test('blocks hosted high-freshness route-unavailable mode even when local route exists', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'route-unavailable',
      localRouteAvailable: true,
      freshRouteAvailable: false,
      fallbackReasonCode: 'groq-current-answers-unsupported',
    },
    routeTruthView: {
      backendReachableState: 'yes',
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.reasonCode, 'groq-current-answers-unsupported');
});

test('allows hosted cloud-basic dispatch when cloud route is viable and no local path exists', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'cloud-basic',
      localRouteAvailable: false,
      cloudRouteAvailable: true,
      freshRouteAvailable: false,
    },
    routeTruthView: {
      backendReachableState: 'yes',
    },
  });

  assert.equal(gate.dispatchAllowed, true);
  assert.equal(gate.cloudRouteViable, true);
});

test('returns no-viable-execution-path for hosted cloud-basic when cloud and local are both unavailable', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'cloud-basic',
      localRouteAvailable: false,
      cloudRouteAvailable: false,
      freshRouteAvailable: false,
      fallbackReasonCode: 'no-viable-execution-path',
    },
    routeTruthView: {
      backendReachableState: 'yes',
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.reasonCode, 'no-viable-execution-path');
});

test('promotes stale hosted local-private label to cloud-basic when Groq cloud route is viable', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'local-private',
      selectedProvider: 'groq',
      localRouteAvailable: false,
      cloudRouteAvailable: true,
      freshRouteAvailable: false,
    },
    routeTruthView: {
      backendReachableState: 'yes',
    },
  });

  assert.equal(gate.dispatchAllowed, true);
  assert.equal(gate.selectedAnswerMode, 'cloud-basic');
  assert.equal(gate.reasonCode, null);
});


test('allows hosted Groq cloud-basic dispatch when backend reachability is unknown but cloud route truth is viable', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'cloud-basic',
      selectedProvider: 'groq',
      localRouteAvailable: false,
      cloudRouteAvailable: true,
      freshRouteAvailable: false,
    },
    routeTruthView: {
      backendReachableState: 'unknown',
    },
  });

  assert.equal(gate.dispatchAllowed, true);
  assert.equal(gate.backendReachabilityState, 'unknown');
  assert.equal(gate.reasonCode, null);
});

test('blocks dispatch when backend reachability is explicitly no', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'cloud-basic',
      selectedProvider: 'groq',
      localRouteAvailable: false,
      cloudRouteAvailable: true,
      freshRouteAvailable: false,
    },
    routeTruthView: {
      backendReachableState: 'no',
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.reasonCode, 'backend-unreachable');
  assert.equal(gate.backendReachabilityState, 'no');
});

test('canonical local-desktop winner cannot be overridden by stale home-node route decision at dispatch time', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'local-private',
      localRouteAvailable: true,
      freshRouteAvailable: false,
      requestRouteTruth: {
        routeKind: 'home-node',
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      routeUsableState: 'yes',
      backendReachableState: 'yes',
    },
    runtimeStatus: {
      canonicalRouteRuntimeTruth: {
        winningRoute: 'local-desktop',
        routeUsable: true,
      },
    },
  });

  assert.equal(gate.dispatchAllowed, true);
  assert.equal(gate.selectedRouteKind, 'local-desktop');
});

test('hosted session with no usable home-node is reported truthfully as unavailable', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'local-private',
      selectedProvider: 'gemini',
      localRouteAvailable: true,
      cloudRouteAvailable: false,
      freshRouteAvailable: false,
      fallbackReasonCode: 'backend-unreachable',
      requestRouteTruth: {
        routeKind: 'home-node',
      },
    },
    routeTruthView: {
      routeKind: 'home-node',
      routeUsableState: 'no',
      routeUsabilityVetoReason: 'selected-route-unreachable',
      backendReachableState: 'yes',
    },
    runtimeStatus: {
      canonicalRouteRuntimeTruth: {
        winningRoute: 'home-node',
        routeUsable: false,
        backendReachable: true,
      },
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.selectedRouteKind, 'home-node');
  assert.equal(gate.reasonCode, 'selected-route-unreachable');
  assert.equal(gate.fallbackVetoReason, 'selected-route-unreachable');
});

test('provider intent stays distinct when route is canonically unusable', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'cloud-basic',
      selectedProvider: 'gemini',
      requestedProviderForRequest: 'gemini',
      localRouteAvailable: false,
      cloudRouteAvailable: true,
      freshRouteAvailable: true,
      fallbackReasonCode: 'backend-unreachable',
    },
    routeTruthView: {
      routeKind: 'home-node',
      routeUsableState: 'no',
      routeUsabilityVetoReason: 'backend-unreachable',
      backendReachableState: 'no',
    },
    runtimeStatus: {
      canonicalRouteRuntimeTruth: {
        winningRoute: 'home-node',
        routeUsable: false,
        backendReachable: false,
      },
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.reasonCode, 'backend-unreachable');
  assert.equal(gate.selectedRouteUsable, false);
});

test('stale remembered home-node state cannot override canonical route-unusable veto at send time', () => {
  const gate = evaluateRequestDispatchGate({
    routeDecision: {
      selectedAnswerMode: 'fallback-stale-risk',
      selectedProvider: 'ollama',
      localRouteAvailable: true,
      cloudRouteAvailable: true,
      freshRouteAvailable: true,
      requestRouteTruth: {
        routeKind: 'home-node',
      },
    },
    routeTruthView: {
      routeKind: 'local-desktop',
      routeUsableState: 'no',
      routeUsabilityVetoReason: 'provider-not-ready',
      backendReachableState: 'yes',
    },
    runtimeStatus: {
      canonicalRouteRuntimeTruth: {
        winningRoute: 'local-desktop',
        routeUsable: false,
        backendReachable: true,
      },
    },
  });

  assert.equal(gate.dispatchAllowed, false);
  assert.equal(gate.selectedRouteKind, 'local-desktop');
  assert.equal(gate.reasonCode, 'provider-not-ready');
});
