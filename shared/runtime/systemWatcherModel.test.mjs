import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemWatcherModel } from './systemWatcherModel.mjs';

test('detects protocol-boundary-mismatch for hosted https to http backend', () => {
  const model = buildSystemWatcherModel({
    runtimeTruth: {
      session: { sessionKind: 'hosted-web', nonLocalSession: true },
      route: { selectedRouteKind: 'home-node', actualTarget: 'http://100.88.0.2:8787' },
      reachabilityTruth: { selectedRouteReachable: true, selectedRouteUsable: false, uiReachableState: 'unreachable' },
      provider: { selectedProvider: 'groq', executableProvider: 'groq' },
    },
    canonicalRouteRuntimeTruth: {},
    runtimeContext: { frontendOrigin: 'https://stephanos.example.com' },
  });

  assert.equal(model.mode, 'observer-only');
  assert.ok(model.failureFamilies.includes('protocol-boundary-mismatch'));
  assert.ok(model.patternMatches.some((entry) => entry.patternId === 'protocol-boundary-mismatch'));
  assert.equal(model.rootCauseCandidates[0].failingLayer, 'transport-protocol-boundary');
});

test('detects provider intent vs execution drift', () => {
  const model = buildSystemWatcherModel({
    runtimeTruth: {
      session: { sessionKind: 'local-desktop', nonLocalSession: false },
      route: { selectedRouteKind: 'cloud', actualTarget: 'https://api.example.com' },
      reachabilityTruth: { selectedRouteReachable: true, selectedRouteUsable: true, uiReachableState: 'reachable' },
      provider: { selectedProvider: 'openai', executableProvider: 'groq', fallbackProviderUsed: true },
    },
    canonicalRouteRuntimeTruth: {},
    runtimeContext: {},
  });

  assert.ok(model.failureFamilies.includes('provider-intent-vs-execution-drift'));
  assert.ok(model.patternMatches.some((entry) => entry.patternId === 'provider-intent-vs-execution-drift'));
});
