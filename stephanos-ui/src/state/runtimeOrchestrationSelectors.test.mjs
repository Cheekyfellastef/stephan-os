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
