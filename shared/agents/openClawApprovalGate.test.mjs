import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawApprovalGate } from './openClawApprovalGate.mjs';

test('approval gate remains operator review only and never approval eligible in v1', () => {
  const gate = buildOpenClawApprovalGate({ readonlyValidated: true, capabilityReportReady: true, permissionDiffReady: true, auditPreviewReady: true, rollbackReady: true, riskPresent: true });
  assert.equal(gate.gateMode, 'operator_review_only');
  assert.equal(gate.approvalEligible, false);
  assert.equal(gate.executionAllowed, false);
  assert.equal(gate.selfModificationAllowed, false);
});
