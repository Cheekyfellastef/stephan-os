import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStephanosTileTruthProjection } from './stephanosTileTruthProjection.mjs';

test('Stephanos launcher tile includes compact OpenClaw policy summary from agent task projection truth', () => {
  const projection = buildStephanosTileTruthProjection({
    runtimeStatusModel: {
      canonicalRouteRuntimeTruth: {
        appLaunchState: 'ready',
        selectedRouteKind: 'cloud',
        executedProvider: 'openai',
        fallbackActive: false,
        routeReachable: true,
        routeUsable: true,
      },
      agentTaskReadinessSummary: {
        agentTaskLayerStatus: 'in_progress',
        codexReadiness: 'manual_handoff_only',
        openClawReadiness: 'needs_policy',
        openClawIntegrationMode: 'policy_only',
        openClawSafeToUse: false,
        openClawKillSwitchState: 'missing',
        openClawHighestPriorityBlocker: 'Kill switch must be wired and operator-reachable.',
        openClawNextAction: 'Wire kill-switch lifecycle + adapter contract.',
        openClawAdapterMode: 'design_only',
        openClawAdapterReadiness: 'needs_contract',
        nextAgentTaskAction: 'Wire OpenClaw kill switch + adapter contract',
      },
    },
  });

  assert.match(projection.summary, /openclawMode policy_only/i);
  assert.match(projection.summary, /openclawSafe no/i);
  assert.match(projection.summary, /killSwitch missing/i);
  assert.match(projection.summary, /killSwitchMode unavailable/i);
  assert.match(projection.summary, /openclawExecution no/i);
  assert.match(projection.summary, /openclawAdapterMode design_only/i);
});
