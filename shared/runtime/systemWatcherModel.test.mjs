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

test('detects bridge promotion drift instead of missing bridge when hosted HTTPS bridge is reachable', () => {
  const model = buildSystemWatcherModel({
    runtimeTruth: {
      session: { sessionKind: 'hosted-web', nonLocalSession: true },
      route: { selectedRouteKind: 'home-node', actualTarget: 'http://100.88.0.2:8787' },
      reachabilityTruth: { selectedRouteReachable: true, selectedRouteUsable: false, uiReachableState: 'unreachable' },
      provider: { selectedProvider: 'groq', executableProvider: 'groq' },
    },
    canonicalRouteRuntimeTruth: {},
    runtimeContext: {
      frontendOrigin: 'https://stephanos.example.com',
      bridgeTransportTruth: {
        bridgeHostedExecutionCompatibility: 'compatible',
        bridgeHostedExecutionTarget: 'https://desktop-9flonkj.taild6f215.ts.net',
        bridgeAutoRevalidationState: 'revalidated',
      },
    },
  });

  assert.ok(model.contradictions.some((entry) => entry.id === 'https-bridge-promotion-drift'));
  assert.ok(model.failureFamilies.includes('backend-target-precedence-drift'));
  assert.ok(!model.failureFamilies.includes('protocol-boundary-mismatch'));
  assert.match(model.rootCauseCandidates[0].suspectedRootCause, /Candidate precedence/i);
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

test('detects timeout derivation drift when provider attribution conflicts with route usability truth', () => {
  const model = buildSystemWatcherModel({
    runtimeTruth: {
      session: { sessionKind: 'hosted-web', nonLocalSession: true },
      route: { selectedRouteKind: 'home-node', actualTarget: 'https://bridge.example' },
      reachabilityTruth: {
        selectedRouteReachable: true,
        selectedRouteUsable: false,
        backendReachable: true,
      },
      provider: { selectedProvider: 'openai', executableProvider: 'openai' },
    },
    canonicalRouteRuntimeTruth: {},
    runtimeContext: {
      lastTimeoutPolicySource: 'provider:openai',
      lastTimeoutFailureLayer: 'provider',
      lastTimeoutEffectiveProvider: 'openai',
    },
  });

  assert.ok(model.failureFamilies.includes('timeout-derivation-drift'));
  assert.ok(model.contradictions.some((entry) => entry.id === 'timeout-attribution-provider-vs-route-drift'));
});

test('detects ui truth projection mismatch when provider-focused wording hides transport boundary contradiction', () => {
  const model = buildSystemWatcherModel({
    runtimeTruth: {
      session: { sessionKind: 'hosted-web', nonLocalSession: true },
      route: { selectedRouteKind: 'home-node', actualTarget: 'http://100.88.0.2:8787' },
      reachabilityTruth: { selectedRouteReachable: true, selectedRouteUsable: false, backendReachable: true },
      provider: { selectedProvider: 'groq', executableProvider: 'groq' },
    },
    canonicalRouteRuntimeTruth: {},
    runtimeContext: {
      frontendOrigin: 'https://console.example',
      uiStatusSummary: 'Provider degraded and unavailable in status panel',
    },
  });

  assert.ok(model.failureFamilies.includes('ui-truth-projection-mismatch'));
  assert.ok(model.patternMatches.some((entry) => entry.patternId === 'ui-truth-projection-mismatch'));
});

test('classifies recurring contradictions as persistent with temporal reinforcement', () => {
  const model = buildSystemWatcherModel({
    runtimeTruth: {
      session: { sessionKind: 'hosted-web', nonLocalSession: true },
      route: { selectedRouteKind: 'home-node', actualTarget: 'http://100.88.0.2:8787' },
      reachabilityTruth: { selectedRouteReachable: true, selectedRouteUsable: false, backendReachable: true },
      provider: { selectedProvider: 'groq', executableProvider: 'groq' },
    },
    canonicalRouteRuntimeTruth: {},
    runtimeContext: {
      frontendOrigin: 'https://console.example',
      watcherRecentHistory: [
        { failureFamilies: ['protocol-boundary-mismatch'], routeKind: 'home-node', timeoutLayer: 'provider' },
        { failureFamilies: ['protocol-boundary-mismatch'], routeKind: 'cloud', timeoutLayer: 'route' },
      ],
    },
  });

  assert.equal(model.diagnosisSummary.persistenceClassification, 'persistent-recurring');
  assert.ok(model.temporalSignal.transitionBackedEvidence.oscillationSignals.includes('route-flip'));
  assert.ok(model.rootCauseCandidates[0].recurrenceCount >= 2);
});
