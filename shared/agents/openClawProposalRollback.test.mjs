import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawProposalRollback } from './openClawProposalRollback.mjs';

test('rollback preview is descriptive only', () => {
  const rollback = buildOpenClawProposalRollback();
  assert.equal(rollback.rollbackMode, 'preview_only');
  assert.equal(rollback.executionAllowed, false);
  assert.equal(rollback.operatorApprovalRequired, true);
  assert.ok(rollback.rollbackSteps.length > 0);
});
