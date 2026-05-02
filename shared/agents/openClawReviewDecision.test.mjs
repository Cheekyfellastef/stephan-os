import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenClawReviewDecision } from './openClawReviewDecision.mjs';

test('decisions preserve execution/safety flags', () => {
  for (const d of ['not_reviewed','needs_more_evidence','ready_for_codex_review','rejected','archived']) {
    const result = normalizeOpenClawReviewDecision({ reviewDecision: d }, { packetId: 'p1' });
    assert.equal(result.executionAllowed, false);
    assert.equal(result.openClawSelfApprovalAllowed, false);
    assert.equal(result.actionExecutionEligible, false);
  }
});

test('unknown decision falls back safely', () => {
  const result = normalizeOpenClawReviewDecision({ reviewDecision: 'weird' }, { packetId: 'p1' });
  assert.equal(result.reviewDecision, 'not_reviewed');
});
