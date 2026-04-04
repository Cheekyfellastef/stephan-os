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
