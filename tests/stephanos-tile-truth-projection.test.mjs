import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStephanosTileTruthProjection } from '../modules/command-deck/stephanosTileTruthProjection.mjs';

function createProject(overrides = {}) {
  return {
    id: 'stephanos',
    folder: 'stephanos',
    name: 'Stephanos OS',
    dependencyState: 'ready',
    runtimeStatusModel: {
      appLaunchState: 'ready',
      canonicalRouteRuntimeTruth: {
        appLaunchState: 'ready',
        winningRoute: 'cloud',
        routeReachable: true,
        routeUsable: true,
        executedProvider: 'groq',
        fallbackActive: false,
        blockingIssueCodes: [],
      },
    },
    ...overrides,
  };
}

test('healthy hosted cloud truth projects ready launch state on landing tile', () => {
  const projection = buildStephanosTileTruthProjection(createProject());
  assert.equal(projection.launchState, 'ready');
  assert.equal(projection.tone, 'ready');
  assert.equal(projection.routeKind, 'cloud');
  assert.equal(projection.selectedRouteReachable, 'yes');
  assert.equal(projection.selectedRouteUsable, 'yes');
  assert.equal(projection.blockingIssues.length, 0);
});

test('hosted cloud unresolved backend-target informational issues do not degrade tile status', () => {
  const projection = buildStephanosTileTruthProjection(createProject({
    runtimeStatusModel: {
      appLaunchState: 'ready',
      canonicalRouteRuntimeTruth: {
        appLaunchState: 'ready',
        winningRoute: 'cloud',
        routeReachable: true,
        routeUsable: true,
        executedProvider: 'groq',
        fallbackActive: false,
        blockingIssueCodes: [],
        operatorSummary: 'Backend target unresolved: Saved backend target was loopback and rejected for hosted session.',
      },
    },
  }));

  assert.equal(projection.launchState, 'ready');
  assert.equal(projection.tone, 'ready');
  assert.match(projection.summary, /blockingIssues n\/a/);
});

test('hosted cloud with executable groq and no fallback projects cloud/groq truth', () => {
  const projection = buildStephanosTileTruthProjection(createProject());
  assert.equal(projection.routeKind, 'cloud');
  assert.equal(projection.executableProvider, 'groq');
  assert.equal(projection.fallbackActive, 'no');
  assert.equal(projection.routeOperational, true);
});

test('blocking and unavailable canonical truth still projects unavailable tone', () => {
  const projection = buildStephanosTileTruthProjection(createProject({
    runtimeStatusModel: {
      appLaunchState: 'unavailable',
      canonicalRouteRuntimeTruth: {
        appLaunchState: 'unavailable',
        winningRoute: 'unavailable',
        routeReachable: false,
        routeUsable: false,
        executedProvider: '',
        fallbackActive: false,
        blockingIssueCodes: ['route-unusable'],
      },
    },
    dependencyState: 'ready',
  }));

  assert.equal(projection.launchState, 'unavailable');
  assert.equal(projection.tone, 'unavailable');
  assert.deepEqual(projection.blockingIssues, ['route-unusable']);
});

test('tile projection uses executable provider truth over requested provider intent', () => {
  const projection = buildStephanosTileTruthProjection(createProject({
    runtimeStatusModel: {
      appLaunchState: 'ready',
      canonicalRouteRuntimeTruth: {
        appLaunchState: 'ready',
        winningRoute: 'cloud',
        routeReachable: true,
        routeUsable: true,
        requestedProvider: 'ollama',
        selectedProvider: 'ollama',
        executedProvider: 'groq',
        fallbackActive: false,
        blockingIssueCodes: [],
      },
    },
  }));

  assert.equal(projection.executableProvider, 'groq');
  assert.match(projection.summary, /executable provider groq/);
});
