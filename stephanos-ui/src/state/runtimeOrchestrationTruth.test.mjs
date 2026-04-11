import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalCurrentIntent,
  buildCanonicalMemoryContext,
  buildCanonicalMissionPacket,
} from './runtimeOrchestrationTruth.js';

test('canonical memory context stays bounded and null-safe when sparse', () => {
  const context = buildCanonicalMemoryContext({});
  assert.equal(context.activeMissionContinuity.continuityLoopState, 'unknown');
  assert.deepEqual(context.recentAcceptedWork, ['none']);
  assert.equal(context.sparseData, true);
});

test('canonical current intent labels inferred intent truthfully', () => {
  const intent = buildCanonicalCurrentIntent({
    intent: { intentDetected: false, intentType: 'build-runtime', confidence: 0.42, reason: 'heuristic match' },
    missionPacket: { active: true, moveTitle: 'Elevate mission packet' },
    proposal: { active: true, moveId: 'proposal-execution-bridge' },
    execution: { status: 'not-executing' },
  });

  assert.equal(intent.operatorIntent.source, 'inferred');
  assert.equal(intent.missionPacketState.status, 'awaiting-approval');
  assert.equal(intent.executionState.status, 'not-executing');
});

test('canonical mission packet keeps lifecycle separate from execution truth', () => {
  const packet = buildCanonicalMissionPacket({
    missionPacketTruth: {
      active: true,
      moveTitle: 'Mission packet elevation',
      rationale: 'Promote packet to orchestration authority',
      executionEligible: false,
      blockers: ['approval pending'],
      evidence: ['intent classified as build-runtime'],
    },
    missionPacketWorkflow: {
      decisions: [{ decision: 'accept' }],
    },
    currentIntent: {
      operatorIntent: { label: 'build-runtime' },
    },
  });

  assert.equal(packet.currentPhase, 'execution-ready');
  assert.equal(packet.approvalExecutionStatus.executing, 'no');
  assert.equal(packet.approvalExecutionStatus.completed, 'no-automatic-completion-claim');
});

test('canonical mission packet maps codex handoff validation to completed without fake execution claims', () => {
  const packet = buildCanonicalMissionPacket({
    missionPacketTruth: { active: true, moveTitle: 'Codex lifecycle bridge', rationale: 'Track validation outcome' },
    missionPacketWorkflow: {
      decisions: [{ decision: 'accept' }],
      codexHandoffs: [{ handoffId: 'h1', status: 'validated', validationStatus: 'passed', lastOperatorAction: 'confirm-validation-passed' }],
    },
  });

  assert.equal(packet.currentPhase, 'completed');
  assert.equal(packet.codexExecution.status, 'validated');
  assert.equal(packet.approvalExecutionStatus.completed, 'operator-validated');
});
