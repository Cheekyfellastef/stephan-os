import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOpenClawCodexProposalExport } from './openClawCodexProposalExport.mjs';

test('codex export unavailable without ready proposal packet', () => {
  const missing = buildOpenClawCodexProposalExport();
  assert.equal(missing.exportStatus, 'missing_packet');

  const unavailable = buildOpenClawCodexProposalExport({
    proposalPacket: { packetId: 'pkt-1', packetStatus: 'draft' },
  });
  assert.equal(unavailable.exportStatus, 'unavailable');
});

test('codex export generated when packet ready_for_operator_review', () => {
  const exportModel = buildOpenClawCodexProposalExport({
    proposalPacket: {
      packetId: 'pkt-ready',
      packetStatus: 'ready_for_operator_review',
      proposalTitle: 'Ready Packet',
      proposalSummary: 'Summary',
      requiredTests: ['node --test shared/agents/*.test.mjs'],
      rollbackPreview: { rollbackSummary: 'Rollback by revert.' },
      approvalRequirements: { requiredApprovals: ['approve_openclaw_operator_review'] },
      blockedActions: ['execute_commands'],
      forbiddenSelfActions: ['approve_own_proposal'],
    },
    risk: { riskLevel: 'guarded', riskSummary: 'Guarded risk.' },
  });

  assert.equal(exportModel.exportStatus, 'generated');
  assert.equal(exportModel.exportMode, 'manual_prompt');
  assert.equal(exportModel.sourcePacketId, 'pkt-ready');
  assert.equal(exportModel.executionAllowed, false);
  assert.equal(exportModel.openClawExecutionAllowed, false);
  assert.equal(exportModel.operatorApprovalRequired, true);
});

test('generated prompt includes risk rollback approvals forbidden actions and required tests', () => {
  const exportModel = buildOpenClawCodexProposalExport({
    proposalPacket: {
      packetId: 'pkt-2',
      packetStatus: 'ready_for_operator_review',
      approvalRequirements: { requiredApprovals: ['approve_openclaw_operator_review'] },
      requiredTests: ['node --test shared/agents/*.test.mjs'],
      blockedActions: ['edit_repository'],
      forbiddenSelfActions: ['approve_own_proposal'],
      rollbackPreview: { rollbackSummary: 'Rollback by git revert.' },
    },
    risk: { riskLevel: 'guarded' },
  });

  assert.match(exportModel.codexPrompt, /Risk classification:/i);
  assert.match(exportModel.codexPrompt, /Rollback plan:/i);
  assert.match(exportModel.codexPrompt, /Approval requirements:/i);
  assert.match(exportModel.codexPrompt, /Forbidden self-actions:/i);
  assert.match(exportModel.codexPrompt, /Required checks:/i);
  assert.match(exportModel.codexPrompt, /Do not enable OpenClaw execution/i);
  assert.match(exportModel.codexPrompt, /OpenClaw cannot approve itself/i);
});
