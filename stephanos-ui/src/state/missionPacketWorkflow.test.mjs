import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMissionPacketAction,
  createDefaultMissionPacketWorkflow,
  deriveMissionPacketActionState,
  normalizeMissionPacketTruth,
  normalizeMissionPacketWorkflow,
} from './missionPacketWorkflow.js';

test('normalizeMissionPacketTruth renders partial packet truth safely', () => {
  const normalized = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposed_move_id: 'proposal-execution-bridge',
    proposed_move_title: 'Proposal execution bridge',
  });

  assert.equal(normalized.active, true);
  assert.equal(normalized.moveId, 'proposal-execution-bridge');
  assert.equal(normalized.moveTitle, 'Proposal execution bridge');
  assert.equal(normalized.approvalRequired, true);
  assert.equal(normalized.executionEligible, false);
  assert.deepEqual(normalized.warnings, []);
});

test('deterministic action gating preserves explicit approval and blocks promote-before-accept', () => {
  const packet = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposal_packet_mode: 'self-build-mission-synthesis',
    proposed_move_id: 'build-test-run-mission-packets',
    codex_handoff_available: true,
    codex_handoff_payload: '{"ok":true}',
    operator_approval_required: true,
    execution_eligible: false,
  });

  const initialGate = deriveMissionPacketActionState(createDefaultMissionPacketWorkflow(), packet);
  assert.equal(initialGate.canAccept, true);
  assert.equal(initialGate.canPromote, false);
  assert.equal(initialGate.executionEligible, false);

  const accepted = applyMissionPacketAction(createDefaultMissionPacketWorkflow(), {
    action: 'accept',
    packetTruth: packet,
    now: '2026-04-09T00:00:00.000Z',
  });
  const acceptedGate = deriveMissionPacketActionState(accepted, packet);
  assert.equal(acceptedGate.decision, 'accept');
  assert.equal(acceptedGate.lifecycleStatus, 'execution-ready');
  assert.equal(acceptedGate.canPromote, true);
  assert.equal(acceptedGate.executionEligible, false);
});

test('mission packet decisions persist through normalization and preserve no-auto-execution truth', () => {
  const packet = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposed_move_id: 'codex-handoff-generator',
    proposed_move_title: 'Codex handoff generator',
    operator_approval_required: true,
    execution_eligible: false,
  });

  const deferred = applyMissionPacketAction(createDefaultMissionPacketWorkflow(), {
    action: 'defer',
    packetTruth: packet,
    now: '2026-04-09T00:02:00.000Z',
  });
  const restored = normalizeMissionPacketWorkflow(deferred);

  assert.equal(restored.decisions[0].decision, 'defer');
  assert.equal(restored.decisions[0].approvalRequired, true);
  assert.equal(restored.decisions[0].executionEligible, false);
  assert.equal(restored.decisions[0].lifecycleStatus, 'awaiting-approval');
});

test('promotion adds packet to proposal and roadmap queues only after accept decision', () => {
  const packet = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposal_packet_mode: 'self-build-mission-synthesis',
    proposed_move_id: 'proposal-execution-bridge',
    proposed_move_title: 'Proposal execution bridge',
    operator_approval_required: true,
    execution_eligible: false,
  });

  const unacceptedPromotion = applyMissionPacketAction(createDefaultMissionPacketWorkflow(), {
    action: 'promote',
    packetTruth: packet,
    now: '2026-04-09T00:03:00.000Z',
  });
  assert.equal(unacceptedPromotion.proposalQueue.length, 0);

  const accepted = applyMissionPacketAction(createDefaultMissionPacketWorkflow(), {
    action: 'accept',
    packetTruth: packet,
    now: '2026-04-09T00:04:00.000Z',
  });
  const promoted = applyMissionPacketAction(accepted, {
    action: 'promote',
    packetTruth: packet,
    now: '2026-04-09T00:05:00.000Z',
  });

  assert.equal(promoted.proposalQueue.length, 1);
  assert.equal(promoted.roadmapQueue.length, 1);
  assert.equal(promoted.proposalQueue[0].moveId, 'proposal-execution-bridge');
});

test('lifecycle actions track in-progress to completed without claiming auto execution', () => {
  const packet = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposed_move_id: 'mission-synthesis-layer',
    operator_approval_required: true,
    execution_eligible: false,
  });

  const accepted = applyMissionPacketAction(createDefaultMissionPacketWorkflow(), {
    action: 'accept',
    packetTruth: packet,
    now: '2026-04-09T00:06:00.000Z',
  });
  const started = applyMissionPacketAction(accepted, {
    action: 'start',
    packetTruth: packet,
    now: '2026-04-09T00:07:00.000Z',
  });
  const completed = applyMissionPacketAction(started, {
    action: 'complete',
    packetTruth: packet,
    now: '2026-04-09T00:08:00.000Z',
  });
  const gate = deriveMissionPacketActionState(completed, packet);
  assert.equal(gate.lifecycleStatus, 'completed');
  assert.equal(gate.executionEligible, false);
});

test('codex handoff pipeline tracks generated -> applied -> validated deterministically', () => {
  const packet = normalizeMissionPacketTruth({
    proposal_packet_active: true,
    proposal_packet_mode: 'self-build-mission-synthesis',
    proposed_move_id: 'codex-pipeline',
    proposed_move_title: 'Codex pipeline',
    proposed_move_rationale: 'Track handoff truth explicitly',
    codex_handoff_payload: '{"patchMetadata":{"files":["a.js"],"estimatedChanges":"small"}}',
    operator_approval_required: true,
    execution_eligible: false,
  });

  const accepted = applyMissionPacketAction(createDefaultMissionPacketWorkflow(), {
    action: 'accept',
    packetTruth: packet,
    now: '2026-04-10T00:00:00.000Z',
  });
  const generated = applyMissionPacketAction(accepted, {
    action: 'prepare-codex-handoff',
    packetTruth: packet,
    now: '2026-04-10T00:01:00.000Z',
  });
  assert.equal(generated.codexHandoffs[0].status, 'generated');

  const applied = applyMissionPacketAction(generated, {
    action: 'mark-handoff-applied',
    packetTruth: packet,
    now: '2026-04-10T00:02:00.000Z',
  });
  const appliedGate = deriveMissionPacketActionState(applied, packet);
  assert.equal(appliedGate.lifecycleStatus, 'in-progress');
  assert.equal(appliedGate.codexHandoffStatus, 'applied');

  const validated = applyMissionPacketAction(applied, {
    action: 'confirm-validation-passed',
    packetTruth: packet,
    now: '2026-04-10T00:03:00.000Z',
  });
  const validatedGate = deriveMissionPacketActionState(validated, packet);
  assert.equal(validatedGate.lifecycleStatus, 'completed');
  assert.equal(validatedGate.codexHandoffStatus, 'validated');
  assert.equal(validatedGate.validationStatus, 'passed');
});
