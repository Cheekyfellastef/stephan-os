import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawProposalApprovalRequirements } from './openClawProposalApprovalRequirements.mjs';

test('approval requirements remain non-executing', () => {
  const req = buildOpenClawProposalApprovalRequirements({ evidence: [], risk: { riskLevel: 'guarded' }, rollback: { rollbackStatus: 'preview_ready' } });
  assert.equal(req.operatorApprovalRequired, true);
  assert.equal(req.openClawSelfApprovalAllowed, false);
  assert.equal(req.executionAllowed, false);
  assert.equal(req.approvalAllowsExecution, false);
});
