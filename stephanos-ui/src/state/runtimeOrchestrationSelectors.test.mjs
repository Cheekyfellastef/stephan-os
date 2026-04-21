import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRuntimeOrchestrationSelectors } from './runtimeOrchestrationSelectors.js';

test('selectors remain null-safe with sparse orchestration truth', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({});
  assert.equal(selectors.currentMissionState.intentSource, 'unknown');
  assert.equal(selectors.continuityLoopState.strength, 'unknown');
  assert.equal(selectors.buildAssistanceReadiness.state, 'analysis-ready');
  assert.equal(selectors.blockageExplanation, '');
});

test('selectors preserve inferred intent labeling and explicit blockage explanation', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({
    canonicalMemoryContext: { sparseData: true, activeMissionContinuity: { continuityLoopState: 'live' } },
    canonicalCurrentIntent: { operatorIntent: { label: 'build-runtime', source: 'inferred' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { missionTitle: 'Build handoff', currentPhase: 'awaiting-approval', blockers: [] },
  });

  assert.equal(selectors.currentMissionState.inferredIntent, true);
  assert.equal(selectors.missionBlocked, true);
  assert.match(selectors.blockageExplanation, /inferred while continuity is sparse/i);
});

test('build assistance transitions follow lifecycle without collapsing execution truth', () => {
  const inProgress = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'explicit' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { currentPhase: 'in-progress', approvalExecutionStatus: { accepted: 'yes' } },
  });
  assert.equal(inProgress.buildAssistanceReadiness.state, 'in-progress');

  const completed = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'explicit' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { currentPhase: 'completed', approvalExecutionStatus: { accepted: 'yes' } },
  });
  assert.equal(completed.buildAssistanceReadiness.state, 'completed');
});


test('selector command readiness follows lifecycle gating truth', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'explicit' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { currentPhase: 'execution-ready', approvalExecutionStatus: { accepted: 'yes' } },
  });

  assert.equal(selectors.commandReadiness['start-mission'].allowed, true);
  assert.equal(selectors.commandReadiness['complete-mission'].allowed, false);
});

test('codex pipeline selectors expose applied->validation gating and summaries', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'explicit' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: {
      currentPhase: 'in-progress',
      approvalExecutionStatus: { accepted: 'yes' },
      codexExecution: { status: 'applied', validationStatus: 'not-run', lastOperatorAction: 'mark-handoff-applied' },
    },
  });

  assert.equal(selectors.codexExecutionState, 'applied');
  assert.equal(selectors.codexHandoffReadiness, 'awaiting-validation');
  assert.equal(selectors.commandReadiness['confirm-validation-passed'].allowed, true);
  assert.equal(selectors.currentMissionState.lastHandoffAction, 'mark-handoff-applied');
  assert.match(selectors.nextRecommendedAction, /awaiting validation/i);
});


test('selectors expose resumability and prompt builder snapshot from mission lineage', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'explicit' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { currentPhase: 'execution-ready', packetKey: 'self-build::mission-3', approvalExecutionStatus: { accepted: 'yes' } },
    missionLineage: {
      activeMissionId: 'mission-3',
      missions: [{
        missionId: 'mission-3',
        packetKey: 'self-build::mission-3',
        title: 'Mission Three',
        lifecycleState: 'execution-ready',
        resumableState: true,
        continuityStrength: 'strong',
        nextRecommendedAction: 'Start mission',
        codexHandoff: { lastOperatorAction: 'prepare-codex-handoff' },
      }],
    },
  });

  assert.equal(selectors.missionResumability.hasResumableMission, true);
  assert.equal(selectors.promptBuilderSnapshot.resumableMissionCount, 1);
  assert.match(selectors.promptBuilderSnapshot.activeMissionSummary, /Mission Three/);
});

test('selectors expose hosted-safe mission console mode when local authority is unavailable', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'explicit' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { currentPhase: 'awaiting-approval', blockers: ['local execution required'] },
    finalRouteTruth: { sessionKind: 'hosted-web', backendReachable: false, routeUsable: true, selectedRouteKind: 'cloud' },
  });

  assert.equal(selectors.missionConsoleMode.posture, 'hosted-safe-orchestration-mode');
  assert.equal(selectors.missionConsoleMode.localAuthorityAvailable, false);
  assert.equal(selectors.missionConsoleMode.executionDeferredToBattleBridge, true);
  assert.match(selectors.missionConsoleMode.reason, /Hosted-safe cloud cognition remains online|Hosted surface detected/i);
});

test('selectors expose degraded-but-operational capability posture when battle bridge is unavailable and cloud cognition is available', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'explicit' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { currentPhase: 'awaiting-approval', blockers: [] },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      backendReachable: false,
      routeKind: 'cloud',
      routeUsable: true,
      selectedProvider: 'groq',
      executedProvider: 'groq',
    },
  });

  assert.equal(selectors.capabilityPosture.mode, 'hosted-safe-cloud-cognition');
  assert.equal(selectors.capabilityPosture.localAuthorityAvailable, false);
  assert.equal(selectors.capabilityPosture.cloudCognitionAvailable, true);
  assert.equal(selectors.capabilityPosture.executionDeferred, true);
  assert.equal(selectors.capabilityPosture.hostedSafePlanningAvailable, true);
  assert.match(selectors.capabilityPosture.operatorSummary, /Execution deferred; planning and mission capture available/i);
});

test('selectors expose provider execution summary and operator action ladder when route is down and intent unknown', () => {
  const selectors = deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: 'unknown' }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket: { currentPhase: 'awaiting-approval', blockers: [] },
    finalRouteTruth: {
      sessionKind: 'hosted-web',
      backendReachable: false,
      selectedProvider: 'groq',
      executedProvider: 'none',
    },
  });

  assert.match(selectors.providerExecutionSummary, /selected, but no executable route exists/i);
  assert.equal(selectors.operatorActionLadder.length, 4);
  assert.match(selectors.operatorActionLadder[0], /establish intent/i);
  assert.match(selectors.operatorActionLadder[2], /retry remembered bridge validation/i);
});
