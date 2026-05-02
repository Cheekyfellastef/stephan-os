import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawProposalPacket, OPENCLAW_BLOCKED_ACTIONS, OPENCLAW_FORBIDDEN_SELF_ACTIONS } from './openClawProposalPacket.mjs';

const types = ['observe_capability','generate_oversight_plan','propose_code_change','propose_ui_change','propose_memory_update','propose_permission_change','propose_agent_workflow'];

test('proposal packet safety invariants and types', () => {
  for (const proposalType of types) {
    const packet = buildOpenClawProposalPacket({ proposalType, readonlyEvidence: [] });
    assert.equal(packet.executionAllowed, false);
    assert.equal(packet.selfModificationAllowed, false);
    assert.equal(packet.operatorApprovalRequired, true);
    assert.equal(packet.actionExecutionEligible, false);
    assert.deepEqual(packet.blockedActions, OPENCLAW_BLOCKED_ACTIONS);
    assert.deepEqual(packet.forbiddenSelfActions, OPENCLAW_FORBIDDEN_SELF_ACTIONS);
  }
});


test('proposal packet id is deterministic for identical logical input', () => {
  const input = {
    proposalType: 'generate_oversight_plan',
    requestedOutcome: 'operator_review_for_future_codex_workflow',
    source: 'agent_task_projection',
    proposedActions: ['generate_oversight_plan'],
    readonlyEvidence: [{ evidenceType: 'readonly_validation', evidenceStatus: 'succeeded', source: 'openclaw_validation', summary: 'ok' }],
  };
  const first = buildOpenClawProposalPacket(input);
  const second = buildOpenClawProposalPacket(input);
  assert.equal(first.packetId, second.packetId);
  assert.equal(first.createdAt, second.createdAt);
  assert.equal(first.packetId.includes('Date.now'), false);
});

test('proposal packet id changes only when packet-defining input changes', () => {
  const base = buildOpenClawProposalPacket({ proposedActions: ['generate_oversight_plan'] });
  const changed = buildOpenClawProposalPacket({ proposedActions: ['propose_ui_change'] });
  assert.notEqual(base.packetId, changed.packetId);
});
