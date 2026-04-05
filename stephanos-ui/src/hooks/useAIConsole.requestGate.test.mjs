import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRequestDispatchGate } from './requestDispatchGate.js';

test('allows local execution when freshness is low and selected route is unusable', () => {
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

  assert.equal(gate.dispatchAllowed, true);
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
