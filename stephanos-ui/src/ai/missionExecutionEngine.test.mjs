import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionExecutionPacket } from './missionExecutionEngine.js';

test('mission execution packet is approval-gated until accept decision', () => {
  const packet = buildMissionExecutionPacket({
    intent: {
      intentType: 'build-runtime',
      confidence: 0.8,
      reason: 'runtime build intent',
      extractedConstraints: ['operator-approval-required-before-mutation'],
      extractedSubsystems: ['runtime'],
      buildRelevant: true,
      warnings: [],
    },
    proposalPacket: { packet_metadata: { proposal_active: true }, recommended_move_summary: { move_id: 'build-runtime' } },
    missionWorkflow: { decisions: [] },
    graphState: { nodes: [] },
  });

  assert.equal(packet.executionMode, 'approval-gated');
  assert.equal(packet.lifecycleState, 'proposed');
  assert.equal(packet.graphPromotionDeferredReason, 'graph-empty-no-nodes-available');
  assert.equal(packet.toolPlan.length > 0, true);
  assert.equal(packet.canonicalLifecycleState, 'PLANNED');
  assert.equal(packet.shadowRoutingOnly, true);
  assert.equal(packet.shadowRoute.executionAuthorized, false);
  assert.equal(packet.proofDeclaredBeforeExecution, true);
});

test('accepted mission becomes execution-ready without claiming completion', () => {
  const packet = buildMissionExecutionPacket({
    operatorIntent: 'Continue the current UI build and get it over the line',
    intent: { intentType: 'build-ui', confidence: 0.7, reason: 'ui build', extractedConstraints: [], extractedSubsystems: [], buildRelevant: true, warnings: [] },
    proposalPacket: { packet_metadata: { proposal_active: true } },
    missionWorkflow: { decisions: [{ decision: 'accept' }] },
    missionLineage: { activeMissionId: 'goal-2643' },
    graphState: { nodes: [{ id: 'ui' }] },
  });

  assert.equal(packet.executionMode, 'execution-ready');
  assert.equal(packet.lifecycleState, 'execution-ready');
  assert.equal(packet.executionTruthPreserved, true);
  assert.equal(packet.canonicalLifecycleState, 'PLANNED');
  assert.equal(packet.missionContinuity.mode, 'continue-existing');
  assert.equal(packet.missionContinuity.activeMissionId, 'goal-2643');
  assert.equal(packet.recoveryPlan.scopeWideningAllowed, false);
});


test('execution packet does not claim Sovereign Commander preference without capability proof', () => {
  const packet = buildMissionExecutionPacket({
    operatorIntent: 'Fix Battle Bridge runtime telemetry',
    intent: {
      intentType: 'build-runtime',
      confidence: 0.9,
      reason: 'runtime repair',
      extractedConstraints: [],
      extractedSubsystems: ['runtime'],
      buildRelevant: true,
      warnings: [],
    },
    missionLineage: { activeMissionId: 'goal-2643' },
    finalRouteTruth: {},
  });
  assert.notEqual(packet.shadowRoute.preferredRouteId, 'sovereign-commander');
  assert.equal(packet.shadowRoute.candidates.find((entry) => entry.routeId === 'sovereign-commander').availability, 'UNKNOWN');
});
