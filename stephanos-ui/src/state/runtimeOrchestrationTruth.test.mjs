import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjudicateCanonicalBuildTruth,
  buildCanonicalCurrentIntent,
  buildCanonicalMemoryContext,
  buildCanonicalMissionPacket,
  buildCanonicalSourceDistAlignment,
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

test('canonical current intent honors approved intent capture as explicit canonical truth', () => {
  const intent = buildCanonicalCurrentIntent({
    intent: { intentDetected: false, intentType: 'unknown', confidence: 0, reason: 'none' },
    operatorIntentCapture: {
      approved: true,
      intentLabel: 'repair',
      packetSummary: 'Operator-approved hosted-safe repair mission.',
    },
  });

  assert.equal(intent.operatorIntent.label, 'repair');
  assert.equal(intent.operatorIntent.source, 'explicit');
  assert.equal(intent.operatorIntent.confidence, 1);
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

test('canonical source/dist alignment reports aligned when parity is true', () => {
  const alignment = buildCanonicalSourceDistAlignment({
    sourceFingerprint: 'src-fp',
    buildRuntimeMarker: 'marker-1',
    buildCommit: 'abc1234',
    buildTimestamp: '2026-04-11T00:00:00.000Z',
    runtimeTruth: {
      sourceDistParityOk: true,
      servedMarker: 'marker-1',
    },
  });

  assert.equal(alignment.buildAlignmentState, 'aligned');
  assert.equal(alignment.operatorActionRequired, false);
  assert.equal(alignment.blockingSeverity, 'none');
});

test('canonical source/dist alignment reports stale when parity is false', () => {
  const alignment = buildCanonicalSourceDistAlignment({
    sourceFingerprint: 'src-fp',
    buildRuntimeMarker: 'marker-1',
    runtimeTruth: {
      sourceDistParityOk: false,
      servedMarker: 'marker-older',
    },
  });

  assert.equal(alignment.buildAlignmentState, 'stale');
  assert.equal(alignment.operatorActionRequired, true);
  assert.match(alignment.operatorActionText, /stephanos:build/);
  assert.equal(alignment.distFingerprint, 'marker-older');
});

test('canonical source/dist alignment stays null-safe when evidence is missing', () => {
  const alignment = buildCanonicalSourceDistAlignment({});
  assert.equal(alignment.buildAlignmentState, 'missing-build-truth');
  assert.equal(alignment.sourceFingerprint, null);
  assert.equal(alignment.distFingerprint, null);
  assert.equal(alignment.operatorActionRequired, true);
});

test('canonical source/dist alignment reports unknown when served truth is unavailable', () => {
  const alignment = buildCanonicalSourceDistAlignment({
    sourceFingerprint: 'src-fp',
    buildRuntimeMarker: 'marker-1',
    runtimeTruth: {},
  });
  assert.equal(alignment.buildAlignmentState, 'unknown');
  assert.equal(alignment.blockingSeverity, 'caution');
});

test('canonical build truth adjudicator returns match when runtime and served build truths align', () => {
  const adjudication = adjudicateCanonicalBuildTruth({
    runtimeBuild: {
      gitCommit: 'abc1234',
      runtimeMarker: 'marker-1',
      buildTimestamp: '2026-04-11T00:00:00.000Z',
      sourceFingerprint: 'src-fp',
    },
    servedBuild: {
      gitCommit: 'abc1234',
      runtimeMarker: 'marker-1',
      buildTimestamp: '2026-04-11T00:00:00.000Z',
      sourceFingerprint: 'src-fp',
    },
  });

  assert.equal(adjudication.status, 'match');
  assert.equal(adjudication.operatorLabel, 'Current build confirmed');
});

test('canonical build truth adjudicator returns stale when runtime and served build truths diverge', () => {
  const adjudication = adjudicateCanonicalBuildTruth({
    runtimeBuild: {
      gitCommit: 'abc1234',
      runtimeMarker: 'marker-2',
      buildTimestamp: '2026-04-11T00:00:00.000Z',
      sourceFingerprint: 'src-fp',
    },
    servedBuild: {
      gitCommit: 'def9999',
      runtimeMarker: 'marker-1',
      buildTimestamp: '2026-04-10T00:00:00.000Z',
      sourceFingerprint: 'src-fp',
    },
  });

  assert.equal(adjudication.status, 'stale');
  assert.match(adjudication.reason, /differs/i);
});

test('canonical build truth adjudicator returns indeterminate when served build truth is unavailable', () => {
  const adjudication = adjudicateCanonicalBuildTruth({
    runtimeBuild: {
      gitCommit: 'abc1234',
      runtimeMarker: 'marker-1',
      buildTimestamp: '2026-04-11T00:00:00.000Z',
      sourceFingerprint: 'src-fp',
    },
    servedBuild: {},
  });

  assert.equal(adjudication.status, 'indeterminate');
  assert.match(adjudication.reason, /unavailable/i);
});
