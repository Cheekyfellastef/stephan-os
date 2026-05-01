import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawRollbackPlan } from './openClawRollbackPlan.mjs';

test('rollback plan stays preview-only and execution disabled', () => {
  const plan = buildOpenClawRollbackPlan();
  assert.equal(plan.rollbackMode, 'preview_only');
  assert.equal(plan.executionAllowed, false);
  assert.equal(plan.operatorApprovalRequired, true);
  assert.equal(plan.rollbackAvailable, true);
});
