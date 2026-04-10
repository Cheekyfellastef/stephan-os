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
});

test('accepted mission becomes execution-ready without claiming completion', () => {
  const packet = buildMissionExecutionPacket({
    intent: { intentType: 'build-ui', confidence: 0.7, reason: 'ui build', extractedConstraints: [], extractedSubsystems: [], buildRelevant: true, warnings: [] },
    proposalPacket: { packet_metadata: { proposal_active: true } },
    missionWorkflow: { decisions: [{ decision: 'accept' }] },
    graphState: { nodes: [{ id: 'ui' }] },
  });

  assert.equal(packet.executionMode, 'execution-ready');
  assert.equal(packet.lifecycleState, 'execution-ready');
  assert.equal(packet.executionTruthPreserved, true);
});
