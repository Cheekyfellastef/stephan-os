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

  assert.equal(projection.landingTileSummary.overallStatus, 'Mission systems: Active');
  assert.equal(projection.landingTileSummary.nextAction, 'Wire OpenClaw kill switch + adapter contract');
  assert.equal(projection.landingTileSummary.safetyLabel, 'Policy-only');
  assert.match(projection.summary, /OpenClaw: needs_policy \(policy_only\)/i);
  assert.match(projection.summary, /Next: Wire OpenClaw kill switch \+ adapter contract/i);
  assert.doesNotMatch(projection.summary, /openclawAdapterMode/i);
  assert.doesNotMatch(projection.summary, /killSwitchMode/i);
});
