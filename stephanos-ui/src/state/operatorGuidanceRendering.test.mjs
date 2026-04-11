import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperatorGuidanceProjection } from './operatorGuidanceRendering.js';

test('buildOperatorGuidanceProjection is null-safe and bounded', () => {
  const projection = buildOperatorGuidanceProjection({});
  assert.equal(projection.availableNow.length, 0);
  assert.equal(projection.blockedBecause.length, 0);
  assert.equal(projection.nextStepSummary, 'Await explicit operator guidance.');
  assert.equal(projection.missionLifecycleSummary.missionPhase, 'unknown');
  assert.equal(projection.continuitySummary.strength, 'unknown');
  assert.equal(projection.envelopeProjection, null);
});

test('buildOperatorGuidanceProjection reports sparse continuity + inferred intent cautions', () => {
  const projection = buildOperatorGuidanceProjection({
    orchestrationTruth: {
      selectors: {
        currentMissionState: { missionPhase: 'awaiting-approval', intentSource: 'inferred', missionTitle: 'Lift stack' },
        continuityLoopState: { strength: 'sparse', sparse: true, state: 'degraded' },
        missionBlocked: true,
        blockageExplanation: 'Intent inferred with sparse continuity.',
        nextRecommendedAction: 'Confirm explicit operator objective.',
      },
    },
  });
  assert.match(projection.operatorCautionSummary.inferredIntentCaution, /Intent is inferred/);
  assert.match(projection.operatorCautionSummary.sparseContinuityCaution, /Sparse continuity/);
  assert.equal(projection.missionLifecycleSummary.lifecycleState, 'blocked');
});

test('buildOperatorGuidanceProjection keeps available/blocked commandReadiness consistent', () => {
  const projection = buildOperatorGuidanceProjection({
    orchestrationTruth: {
      selectors: {
        commandReadiness: {
          'accept-mission': { allowed: true, reason: '', message: 'Mission can be accepted.' },
          'start-mission': { allowed: false, reason: 'mission-blocked', message: 'Start blocked.' },
        },
      },
    },
  });
  assert.deepEqual(projection.availableNow.map((entry) => entry.command), ['accept-mission']);
  assert.deepEqual(projection.blockedBecause.map((entry) => entry.command), ['start-mission']);
  assert.match(projection.blockedSummary[0], /start-mission: mission-blocked/);
});

test('buildOperatorGuidanceProjection projects latest response envelope fields', () => {
  const projection = buildOperatorGuidanceProjection({
    orchestrationTruth: { selectors: { currentMissionState: { missionPhase: 'in-progress' }, buildAssistanceReadiness: { state: 'in-progress' } } },
    latestResponseEnvelope: {
      actionRequested: 'start-mission',
      actionAllowed: true,
      actionApplied: true,
      resultingLifecycleState: 'in-progress',
      resultingBuildAssistanceState: 'in-progress',
      nextRecommendedAction: 'Continue execution updates.',
      truthWarnings: ['bounded only'],
      status: 'action-completed',
    },
  });
  assert.equal(projection.envelopeProjection.actionRequested, 'start-mission');
  assert.equal(projection.envelopeProjection.actionAllowed, true);
  assert.equal(projection.envelopeProjection.actionApplied, true);
  assert.equal(projection.envelopeProjection.lifecycleState, 'in-progress');
  assert.equal(projection.envelopeProjection.buildAssistanceState, 'in-progress');
  assert.deepEqual(projection.envelopeProjection.truthWarnings, ['bounded only']);
});

test('buildOperatorGuidanceProjection includes codex pipeline summary fields', () => {
  const projection = buildOperatorGuidanceProjection({
    orchestrationTruth: {
      selectors: {
        currentMissionState: {
          codexHandoffStatus: 'applied',
          validationStatus: 'not-run',
          lastHandoffAction: 'mark-handoff-applied',
        },
      },
    },
  });

  assert.equal(projection.codexPipelineSummary.status, 'applied');
  assert.equal(projection.codexPipelineSummary.validationStatus, 'not-run');
  assert.equal(projection.codexPipelineSummary.lastOperatorAction, 'mark-handoff-applied');
});


test('buildOperatorGuidanceProjection projects mission resumability summary', () => {
  const projection = buildOperatorGuidanceProjection({
    orchestrationTruth: {
      selectors: {
        missionResumability: {
          hasResumableMission: true,
          resumableMissionCount: 2,
          missionSummary: 'Mission Four (execution-ready)',
          lastExternalAction: 'prepare-codex-handoff',
          nextRecommendedAction: 'Start mission',
          warnings: ['none'],
        },
      },
    },
  });

  assert.equal(projection.resumabilitySummary.hasResumableMission, true);
  assert.equal(projection.resumabilitySummary.resumableMissionCount, 2);
  assert.match(projection.resumabilitySummary.missionSummary, /Mission Four/);
});
