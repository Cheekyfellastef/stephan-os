import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawOperatorReviewQueue } from './openClawOperatorReviewQueue.mjs';

test('operator review queue enforces non-executing safety defaults', () => {
  const queue = buildOpenClawOperatorReviewQueue({});
  assert.equal(queue.executionAllowed, false);
  assert.equal(queue.selfModificationAllowed, false);
  assert.equal(queue.actionExecutionEligible, false);
  assert.equal(queue.openClawSelfApprovalAllowed, false);
});

test('operator review queue classifies packet status from canonical readiness truth', () => {
  const ready = buildOpenClawOperatorReviewQueue({
    openClawProposalPacket: { packetId: 'p1', packetStatus: 'ready_for_operator_review', readonlyEvidence: [{}, {}] },
    openClawProposalEvidence: { status: 'sufficient' },
    openClawProposalRisk: { riskLevel: 'guarded' },
  });
  assert.equal(ready.queueStatus, 'ready_for_operator_review');

  const missingEvidence = buildOpenClawOperatorReviewQueue({
    openClawProposalPacket: { packetId: 'p2', packetStatus: 'ready_for_operator_review' },
    openClawProposalEvidence: { status: 'missing' },
    openClawProposalRisk: { riskLevel: 'guarded' },
  });
  assert.equal(missingEvidence.queueStatus, 'needs_more_evidence');

  const blocked = buildOpenClawOperatorReviewQueue({
    openClawProposalPacket: { packetId: 'p3', packetStatus: 'ready_for_operator_review' },
    openClawProposalEvidence: { status: 'sufficient' },
    openClawProposalRisk: { riskLevel: 'high' },
  });
  assert.equal(blocked.queueStatus, 'blocked_by_risk');
});
