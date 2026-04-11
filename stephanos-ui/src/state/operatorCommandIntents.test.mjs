import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOperatorLifecycleIntent, normalizeOperatorLifecycleIntent } from './operatorCommandIntents.js';
import { createDefaultMissionPacketWorkflow, normalizeMissionPacketTruth } from './missionPacketWorkflow.js';
import { buildCanonicalMissionPacket } from './runtimeOrchestrationTruth.js';
import { deriveRuntimeOrchestrationSelectors } from './runtimeOrchestrationSelectors.js';

function buildSelectors(workflow, packetTruth, intentSource = 'explicit') {
  const canonicalMissionPacket = buildCanonicalMissionPacket({ missionPacketTruth: packetTruth, missionPacketWorkflow: workflow });
  return deriveRuntimeOrchestrationSelectors({
    canonicalCurrentIntent: { operatorIntent: { source: intentSource }, executionState: { status: 'not-executing' } },
    canonicalMissionPacket,
    missionPacketWorkflow: workflow,
  });
}

test('normalize lifecycle commands and reject unsupported command', () => {
  assert.equal(normalizeOperatorLifecycleIntent('accept mission'), 'accept-mission');
  assert.equal(normalizeOperatorLifecycleIntent('mark handoff as applied'), 'mark-handoff-applied');
  assert.equal(normalizeOperatorLifecycleIntent('resume mission'), 'resume-mission');
  assert.equal(normalizeOperatorLifecycleIntent('unknown mission'), 'unsupported');
});

test('returns no-active-mission-context envelope when mission is unavailable', () => {
  const envelope = adjudicateOperatorLifecycleIntent({
    commandText: 'start mission',
    selectors: deriveRuntimeOrchestrationSelectors({}),
    missionPacketWorkflow: createDefaultMissionPacketWorkflow(),
    packetTruth: {},
  });

  assert.equal(envelope.status, 'no-active-mission-context');
  assert.equal(envelope.actionApplied, false);
});

test('selector-driven gating allows accept and then start from execution-ready', () => {
  const packetTruth = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposed_move_id: 'mission-ops-v2',
    proposed_move_title: 'Mission Ops v2',
    operator_approval_required: true,
    execution_eligible: false,
  });
  const initialWorkflow = createDefaultMissionPacketWorkflow();
  const selectors = buildSelectors(initialWorkflow, packetTruth);

  const acceptEnvelope = adjudicateOperatorLifecycleIntent({
    commandText: 'accept mission',
    selectors,
    missionPacketWorkflow: initialWorkflow,
    packetTruth,
    now: '2026-04-11T00:00:00.000Z',
  });
  assert.equal(acceptEnvelope.status, 'action-completed');
  assert.equal(acceptEnvelope.actionApplied, true);

  const selectorsAfterAccept = buildSelectors(acceptEnvelope.workflow, packetTruth);
  const startEnvelope = adjudicateOperatorLifecycleIntent({
    commandText: 'start mission',
    selectors: selectorsAfterAccept,
    missionPacketWorkflow: acceptEnvelope.workflow,
    packetTruth,
    now: '2026-04-11T00:01:00.000Z',
  });
  assert.equal(startEnvelope.status, 'action-completed');
  assert.equal(startEnvelope.actionApplied, true);
  assert.equal(startEnvelope.resultingLifecycleState, 'in-progress');
});

test('prepare codex handoff blocked when readiness is unavailable', () => {
  const packetTruth = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposed_move_id: 'handoff-check',
    operator_approval_required: true,
    execution_eligible: false,
  });
  const workflow = createDefaultMissionPacketWorkflow();
  const selectors = buildSelectors(workflow, packetTruth);

  const envelope = adjudicateOperatorLifecycleIntent({
    commandText: 'prepare codex handoff',
    selectors,
    missionPacketWorkflow: workflow,
    packetTruth,
  });

  assert.equal(envelope.status, 'action-not-allowed-in-current-state');
  assert.equal(envelope.blockageReason, 'codex-handoff-not-ready');
});

test('why blocked and what can ai do return structured guidance envelopes', () => {
  const packetTruth = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposed_move_id: 'blocked-guidance',
    planning_blockers: ['Waiting for backend route'],
    operator_approval_required: true,
    execution_eligible: false,
  });
  const workflow = createDefaultMissionPacketWorkflow();
  const selectors = buildSelectors(workflow, packetTruth, 'unknown');

  const blocked = adjudicateOperatorLifecycleIntent({ commandText: 'why is this blocked?', selectors, missionPacketWorkflow: workflow, packetTruth });
  const capability = adjudicateOperatorLifecycleIntent({ commandText: 'what can the ai do right now?', selectors, missionPacketWorkflow: workflow, packetTruth });

  assert.equal(blocked.commandType, 'mission-guidance');
  assert.equal(capability.commandType, 'mission-guidance');
  assert.equal(capability.actionAllowed, true);
});

test('handoff apply and validation confirmations require selector-gated sequence', () => {
  const packetTruth = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposal_packet_mode: 'self-build-mission-synthesis',
    proposed_move_id: 'codex-sequence',
    proposed_move_title: 'Codex sequence',
    codex_handoff_payload: '{"patchMetadata":{"files":["main.js"]}}',
    operator_approval_required: true,
    execution_eligible: false,
  });
  const workflow = createDefaultMissionPacketWorkflow();
  const selectors = buildSelectors(workflow, packetTruth);
  const accepted = adjudicateOperatorLifecycleIntent({
    commandText: 'accept mission',
    selectors,
    missionPacketWorkflow: workflow,
    packetTruth,
    now: '2026-04-11T00:10:00.000Z',
  });
  const afterAcceptSelectors = buildSelectors(accepted.workflow, packetTruth);
  const generated = adjudicateOperatorLifecycleIntent({
    commandText: 'prepare codex handoff',
    selectors: afterAcceptSelectors,
    missionPacketWorkflow: accepted.workflow,
    packetTruth,
    now: '2026-04-11T00:11:00.000Z',
  });
  const blockedValidation = adjudicateOperatorLifecycleIntent({
    commandText: 'validation passed',
    selectors: buildSelectors(generated.workflow, packetTruth),
    missionPacketWorkflow: generated.workflow,
    packetTruth,
    now: '2026-04-11T00:12:00.000Z',
  });
  assert.equal(blockedValidation.status, 'action-not-allowed-in-current-state');

  const applied = adjudicateOperatorLifecycleIntent({
    commandText: 'mark handoff as applied',
    selectors: buildSelectors(generated.workflow, packetTruth),
    missionPacketWorkflow: generated.workflow,
    packetTruth,
    now: '2026-04-11T00:13:00.000Z',
  });
  assert.equal(applied.status, 'action-completed');

  const validated = adjudicateOperatorLifecycleIntent({
    commandText: 'validation passed',
    selectors: buildSelectors(applied.workflow, packetTruth),
    missionPacketWorkflow: applied.workflow,
    packetTruth,
    now: '2026-04-11T00:14:00.000Z',
  });
  assert.equal(validated.status, 'action-completed');
  assert.equal(validated.resultingLifecycleState, 'completed');
});


test('resume mission returns resumability envelope without fabricating execution', () => {
  const envelope = adjudicateOperatorLifecycleIntent({
    commandText: 'resume mission',
    selectors: {
      nextRecommendedAction: 'Start mission',
      missionResumability: {
        hasResumableMission: true,
        missionSummary: 'Mission Ops (execution-ready)',
        lastExternalAction: 'mark-handoff-applied',
        nextRecommendedAction: 'Start mission',
        warnings: ['sparse-continuity'],
      },
    },
    missionPacketWorkflow: createDefaultMissionPacketWorkflow(),
    packetTruth: {},
  });

  assert.equal(envelope.commandType, 'mission-guidance');
  assert.equal(envelope.status, 'action-completed');
  assert.match(envelope.operatorMessage, /Resume mission Mission Ops/);
  assert.deepEqual(envelope.truthWarnings, ['sparse-continuity']);
});
