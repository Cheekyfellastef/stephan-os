import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentUpliftScorecardV1,
  buildFlywheelAgentUpliftPlanV1,
  deriveFlywheelBrainRequestV1,
} from './flywheelAgentUpliftV1.mjs';

test('healthy evidenced execution does not wake a brain unnecessarily', () => {
  const plan = buildFlywheelAgentUpliftPlanV1({
    participantId: 'sovereign-commander',
    missionId: 'mission-green',
    rootCauseState: 'KNOWN',
    executionReceipts: [
      { state: 'completed', proofRefs: ['proof/runtime-green'], phase: 'proved' },
    ],
    calibration: { verdict: 'GROUNDED_PASS', proofRefs: ['proof/calibration-pass'], gaps: [] },
    capabilityGaps: [],
    operatorInterventionCount: 0,
  });
  assert.equal(plan.brainRequest.required, false);
  assert.equal(plan.improvementCandidate, null);
  assert.equal(plan.finalVerdict, 'FLYWHEEL_AGENT_UPLIFT_NO_GAP_EVIDENCED');
});

test('recurring failure wakes model-neutral routed cognition without granting authority', () => {
  const plan = buildFlywheelAgentUpliftPlanV1({
    participantId: 'builder-1',
    missionId: 'mission-stall',
    rootCauseState: 'UNKNOWN',
    recurringFailureCount: 3,
    executionReceipts: [
      { state: 'stalled', proofRefs: ['receipts/stall-1'] },
      { state: 'blocked', proofRefs: ['receipts/stall-2'] },
    ],
    capabilityGaps: [{ kind: 'tool-coverage', summary: 'Missing guarded runtime inspection route.' }],
    operatorInterventionCount: 2,
  });
  assert.equal(plan.brainRequest.required, true);
  assert.equal(plan.brainRequest.router, 'stephanos-model-router');
  assert.equal(plan.brainRequest.fixedModelRequired, false);
  assert.equal(plan.brainRequest.qwen35CanaryCompatible, true);
  assert.equal(plan.brainRequest.reasoningPressure, 'uplift');
  assert.equal(plan.brainRequest.routeDecision.localReasoningTier, 'deep');
  assert.equal(plan.brainRequest.routeDecision.operatorDeepReasoning, true);
  assert.equal(plan.brainRequest.routeDecision.recurringFailureCount, 3);
  assert.equal(plan.brainRequest.routeDecision.rootCauseState, 'UNKNOWN');
  assert.equal(plan.brainRequest.routeDecision.upliftRequired, true);
  assert.equal(plan.improvementCandidate.requiresExistingGoalSearch, true);
  assert.equal(plan.improvementCandidate.repairReplayRequired, true);
  assert.equal(plan.improvementCandidate.executionHandoff.route, 'canonical-flywheel-learning-goal-bridge');
  assert.equal(plan.improvementCandidate.executionHandoff.directDispatchAllowed, false);
  assert.equal(plan.authority.dispatchAllowed, false);
  assert.equal(plan.authority.goalCreationAllowed, false);
  assert.equal(plan.authority.authorityWideningAllowed, false);
  assert.equal(plan.existingGoalSearchRequired, true);
  assert.equal(plan.calibrationReplayRequired, true);
});

test('scorecard preserves unknown rather than inventing agent quality', () => {
  const scorecard = buildAgentUpliftScorecardV1({
    participantId: 'new-agent',
    missionId: 'mission-new',
  });
  assert.equal(scorecard.dimensions.every((dimension) => dimension.status === 'UNKNOWN'), true);
});

test('brain request is deterministic for conflicting evidence and bounded to diagnosis/design', () => {
  const request = deriveFlywheelBrainRequestV1({
    rootCauseState: 'CONFLICTING',
    conflictingEvidence: true,
  });
  assert.equal(request.required, true);
  assert.equal(request.selectionPolicy, 'router-owned-provider-neutral');
  assert.equal(request.allowedOutputs.includes('bounded-improvement-proposal'), true);
  assert.equal(request.forbiddenOutputs.includes('work-dispatch'), true);
  assert.equal(request.forbiddenOutputs.includes('self-granted-authority'), true);
});
