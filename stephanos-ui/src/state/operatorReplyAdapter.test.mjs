import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperatorGuidanceProjection } from './operatorGuidanceRendering.js';
import { buildOperatorReplyPayload, resolveOperatorReplyPromptKey } from './operatorReplyAdapter.js';

test('resolveOperatorReplyPromptKey maps supported mission-console prompts', () => {
  assert.equal(resolveOperatorReplyPromptKey('what is my current intent?'), 'current-intent');
  assert.equal(resolveOperatorReplyPromptKey('show mission packet'), 'show-mission-packet');
  assert.equal(resolveOperatorReplyPromptKey('prepare codex handoff'), 'prepare-codex-handoff');
  assert.equal(resolveOperatorReplyPromptKey('resume mission'), 'resume-mission');
  assert.equal(resolveOperatorReplyPromptKey('unknown'), 'unsupported');
});

test('buildOperatorReplyPayload keeps blocked and next-step parity with guidance projection', () => {
  const orchestrationTruth = {
    selectors: {
      missionBlocked: true,
      blockageExplanation: 'Operator approval is required before mission start.',
      nextRecommendedAction: 'Accept mission packet first.',
      currentMissionState: { missionTitle: 'Parity lock', missionPhase: 'awaiting-approval', intentSource: 'explicit' },
      commandReadiness: {
        'start-mission': { allowed: false, reason: 'approval-required', message: 'Start blocked pending acceptance.', approvalRequired: true },
      },
    },
  };
  const guidance = buildOperatorGuidanceProjection({ orchestrationTruth });
  const reply = buildOperatorReplyPayload({ promptKey: 'why-blocked', orchestrationTruth });

  assert.match(reply.text, /Operator approval is required/);
  assert.match(reply.text, /Accept mission packet first\./);
  assert.equal(reply.guidance.nextStepSummary, guidance.nextStepSummary);
  assert.equal(reply.guidance.missionLifecycleSummary.blockageReason, guidance.missionLifecycleSummary.blockageReason);
});

test('buildOperatorReplyPayload renders latest envelope outcome and remains null-safe for sparse continuity', () => {
  const orchestrationTruth = {
    selectors: {
      nextRecommendedAction: 'Confirm explicit objective before transition.',
      currentMissionState: {
        missionTitle: 'Sparse continuity mission',
        missionPhase: 'awaiting-approval',
        intentSource: 'inferred',
      },
      continuityLoopState: { sparse: true, strength: 'sparse', state: 'degraded' },
      buildAssistanceReadiness: { state: 'ready' },
      commandReadiness: {
        'accept-mission': { allowed: true, message: 'Ready now.' },
      },
      codexHandoffReadiness: 'ready',
    },
  };
  const latestResponseEnvelope = {
    actionRequested: 'accept-mission',
    actionAllowed: true,
    actionApplied: true,
    resultingLifecycleState: 'execution-ready',
    resultingBuildAssistanceState: 'ready',
    blockageReason: '',
    nextRecommendedAction: 'Start mission when operator confirms.',
    truthWarnings: ['Sparse continuity; require explicit confirmation.'],
    approvalRequired: false,
  };

  const envelopeReply = buildOperatorReplyPayload({
    promptKey: 'accept-mission',
    orchestrationTruth,
    latestResponseEnvelope,
  });
  const intentReply = buildOperatorReplyPayload({ promptKey: 'current-intent', orchestrationTruth });

  assert.match(envelopeReply.text, /Action accept-mission/);
  assert.match(envelopeReply.text, /lifecycle=execution-ready/);
  assert.match(envelopeReply.text, /warnings=Sparse continuity/);
  assert.match(intentReply.text, /Source: inferred/);
  assert.equal(intentReply.guidance.operatorCautionSummary.inferredIntent, true);
});


test('buildOperatorReplyPayload renders resume mission guidance', () => {
  const reply = buildOperatorReplyPayload({
    promptKey: 'resume-mission',
    orchestrationTruth: {
      selectors: {
        missionResumability: {
          hasResumableMission: true,
          missionSummary: 'Mission Resume (execution-ready)',
          lastExternalAction: 'mark-handoff-applied',
          nextRecommendedAction: 'Start mission',
        },
      },
    },
  });

  assert.match(reply.text, /You can resume this mission/);
  assert.match(reply.text, /Mission Resume/);
});
