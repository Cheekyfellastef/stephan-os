import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionIntelligenceLayer } from './missionIntelligenceLayer.mjs';

const baseInput = {
  finalRouteTruth: { runtimeHealth: 'healthy' },
  missionBridgeState: { state: 'in_progress' },
  compactVerificationSummary: {
    openClawHealthValidationStatus: 'succeeded',
    openClawProposalPacketStatus: 'ready_for_review',
    openClawOperatorReviewQueueStatus: 'ready_for_review',
    openClawCodexProposalExportStatus: 'generated',
    openClawCodexReviewResultStatus: 'not_received',
    openClawControlledExecutionStatus: 'future_gated',
  },
  agentTaskProjection: { operatorSurface: { openClawEvidenceRequest: { requestStatus: 'satisfied', missingEvidence: [] }, openClawOperatorReviewQueue: { queueStatus: 'ready_for_review', reviewDecision: 'ready_for_codex_review' } } },
};

test('Battle Bridge unhealthy recommends repair', () => {
  const output = buildMissionIntelligenceLayer({ ...baseInput, finalRouteTruth: { runtimeHealth: 'unhealthy' } });
  assert.equal(output.missionPhase, 'battle_bridge_repair');
  assert.equal(output.recommendedNextAction, 'Run Battle Bridge repair.');
});

test('OpenClaw validated + packet ready + no Codex result -> codex_review_result_needed', () => {
  const output = buildMissionIntelligenceLayer(baseInput);
  assert.equal(output.missionPhase, 'codex_review_result_needed');
  assert.match(output.recommendedNextAction, /Copy Codex prompt/);
});

test('Evidence missing -> evidence_needed phase', () => {
  const output = buildMissionIntelligenceLayer({ ...baseInput, agentTaskProjection: { operatorSurface: { openClawEvidenceRequest: { requestStatus: 'missing', missingEvidence: ['operator note'] }, openClawOperatorReviewQueue: { queueStatus: 'needs_more_evidence' } } } });
  assert.equal(output.missionPhase, 'evidence_needed');
});

test('Controlled execution future gate stays disabled', () => {
  const output = buildMissionIntelligenceLayer({ ...baseInput, compactVerificationSummary: { ...baseInput.compactVerificationSummary, openClawProposalPacketStatus: 'completed', openClawCodexReviewResultStatus: 'received', openClawControlledExecutionStatus: 'future_gated' }, agentTaskProjection: { operatorSurface: { openClawEvidenceRequest: { requestStatus: 'satisfied', missingEvidence: [] }, openClawOperatorReviewQueue: { queueStatus: 'completed' } } } });
  assert.equal(output.executionPosture, 'proposal_only_execution_disabled');
  assert.equal(output.missionPhase, 'future_execution_gated');
});

test('Contradictions are surfaced', () => {
  const output = buildMissionIntelligenceLayer({ ...baseInput, finalRouteTruth: { runtimeHealth: 'unhealthy' }, compactVerificationSummary: { ...baseInput.compactVerificationSummary, openClawAdapterConnectionState: 'connected' }, agentTaskProjection: { operatorSurface: { openClawEvidenceRequest: { requestStatus: 'missing', missingEvidence: [] }, openClawOperatorReviewQueue: { queueStatus: 'needs_more_evidence', reviewDecision: 'not_reviewed' } } } });
  assert.equal(output.contradictionSignals.length > 0, true);
});

test('Suggested actions never enable execution', () => {
  const output = buildMissionIntelligenceLayer(baseInput);
  const combined = output.suggestedOperatorActions.join(' ').toLowerCase();
  ['execute', 'commit', 'deploy', 'browse', 'edit files'].forEach((token) => assert.equal(combined.includes(token), false));
});
