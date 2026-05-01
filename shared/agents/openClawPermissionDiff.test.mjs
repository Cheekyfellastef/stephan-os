import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawPermissionDiff } from './openClawPermissionDiff.mjs';

test('permission diff is preview-only and execution disabled', () => {
  const diff = buildOpenClawPermissionDiff({ currentEnvelope: { allowedCapabilities: [] }, requestedEnvelope: { allowedCapabilities: [] } });
  assert.equal(diff.diffMode, 'preview_only');
  assert.equal(diff.executionAllowed, false);
  assert.equal(diff.requiresOperatorApproval, true);
  assert.equal(diff.approvalEligible, false);
});

test('permission diff blocks high-risk added capabilities as future gated', () => {
  const diff = buildOpenClawPermissionDiff({
    currentEnvelope: { allowedCapabilities: ['health_check'], blockedCapabilities: [] },
    requestedEnvelope: { allowedCapabilities: ['health_check', 'execute_command'], blockedCapabilities: ['execute_command'] },
  });
  assert.equal(diff.diffStatus, 'future_gated_increase_blocked');
  assert.equal(diff.riskIncrease, 'high');
});
