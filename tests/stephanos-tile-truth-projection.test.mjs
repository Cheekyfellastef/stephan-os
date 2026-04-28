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
  assert.match(projection.summary, /Mission systems: Active/);
});


test('hosted canonical cloud ready truth is not overridden by compatibility degraded/dist hints', () => {
  const projection = buildStephanosTileTruthProjection(createProject({
    dependencyState: 'degraded',
    runtimeStatusModel: {
      appLaunchState: 'degraded',
      preferredRoute: 'dist',
      selectedRoute: 'dist',
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
  }));

  assert.equal(projection.launchState, 'ready');
  assert.equal(projection.routeKind, 'cloud');
  assert.equal(projection.executableProvider, 'groq');
  assert.equal(projection.fallbackActive, 'no');
  assert.equal(projection.drift, true);
  assert.match(projection.diagnosticLabel, /route:dist->cloud/);
  assert.match(projection.summary, /Mission systems: Active/);
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
  assert.equal(projection.landingTileSummary.overallStatus, 'Mission systems: Active');
});

test('tile projection carries compact agent task layer summary when provided by runtime model', () => {
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
      },
      agentTaskReadinessSummary: {
        agentTaskLayerStatus: 'in_progress',
        codexReadiness: 'manual_handoff_only',
        openClawReadiness: 'needs_policy',
        nextAgentTaskAction: 'Wire existing Agent Tile to Agent Task projection',
        readinessScore: 62,
        agentTaskLayerBlockers: ['approve_handoff gate is pending'],
      },
    },
  }));

  assert.equal(projection.agentTaskSummary.agentTaskLayerStatus, 'in_progress');
  assert.equal(projection.agentTaskSummary.codexReadiness, 'manual_handoff_only');
  assert.equal(projection.agentTaskSummary.openClawReadiness, 'needs_policy');
  assert.equal(projection.landingTileSummary.nextAction, 'Wire existing Agent Tile to Agent Task projection');
  assert.equal(projection.landingTileSummary.topBlocker, 'approve_handoff gate is pending');
});

test('landing tile remains compact and only includes telemetry when it is a top dependency', () => {
  const baseProjection = buildStephanosTileTruthProjection(createProject({
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
      telemetrySummary: {
        status: 'flowing',
        nextActions: ['Bind telemetry summary to agent/task lifecycle'],
      },
      promptBuilderSummary: {
        status: 'ready',
      },
    },
  }));

  assert.equal(baseProjection.landingTileSummary.lines.some((line) => line.startsWith('Telemetry:')), false);

  const telemetryPriorityProjection = buildStephanosTileTruthProjection(createProject({
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
      agentTaskReadinessSummary: {
        nextAgentTaskAction: 'Fix telemetry summary lifecycle binding',
      },
      telemetrySummary: {
        status: 'degraded',
        blockers: ['No recent telemetry lifecycle events'],
      },
    },
  }));

  assert.equal(telemetryPriorityProjection.landingTileSummary.lines.some((line) => line.startsWith('Telemetry:')), true);
});


test('landing tile compact summary excludes verbose adapter diagnostics fields', () => {
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
      },
      agentTaskReadinessSummary: {
        agentTaskLayerStatus: 'in_progress',
        openClawReadiness: 'needs_policy',
        openClawIntegrationMode: 'policy_only',
        openClawAdapterMode: 'design_only',
        openClawKillSwitchMode: 'required',
        nextAgentTaskAction: 'Wire OpenClaw kill switch + adapter contract',
      },
    },
  }));

  assert.equal(projection.landingTileSummary.lines.length <= 7, true);
  assert.doesNotMatch(projection.landingTileSummary.summary, /openclawAdapterMode|killSwitchMode|diagnostic/i);
});
