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
