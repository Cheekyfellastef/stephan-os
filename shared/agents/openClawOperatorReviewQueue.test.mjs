import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawOperatorReviewQueue } from './openClawOperatorReviewQueue.mjs';

test('needs_more_evidence always reports explicit missingEvidence', () => {
  const queue = buildOpenClawOperatorReviewQueue({
    openClawProposalPacket: { packetId: 'p1', packetStatus: 'ready_for_operator_review' },
  });
  assert.equal(queue.queueStatus, 'needs_more_evidence');
  assert.equal(queue.missingEvidence.length > 0, true);
});

test('blocked_by_risk when risk is blocked', () => {
  const queue = buildOpenClawOperatorReviewQueue({
    openClawProposalPacket: { packetId: 'p1', packetStatus: 'ready_for_operator_review' },
    openClawProposalEvidence: { status: 'capability_report_available' },
    openClawProposalApprovalRequirements: { approvalStatus: 'ready_for_operator_review' },
    openClawProposalRollback: { rollbackStatus: 'preview_ready' },
    openClawPermissionDiff: { diffStatus: 'preview_ready' },
    openClawAuditLedgerPreview: [{ id: 1 }],
    openClawProposalRisk: { riskStatus: 'blocked', riskLevel: 'high' },
  });
  assert.equal(queue.queueStatus, 'blocked_by_risk');
});

test('ready_for_codex_review does not report missing operator_note when no evidence request exists', () => {
  const queue = buildOpenClawOperatorReviewQueue({
    openClawProposalPacket: { packetId: 'p1', packetStatus: 'ready_for_operator_review' },
    openClawProposalEvidence: { status: 'capability_report_available' },
    openClawProposalApprovalRequirements: { approvalStatus: 'ready_for_operator_review' },
    openClawProposalRollback: { rollbackStatus: 'preview_ready' },
    openClawPermissionDiff: { diffStatus: 'preview_ready' },
    openClawAuditLedgerPreview: [{ id: 1 }],
    openClawReviewDecision: { reviewDecision: 'ready_for_codex_review' },
    openClawEvidenceRequest: { requestStatus: 'none', missingEvidence: ['operator_note'] },
  });
  assert.equal(queue.missingEvidence.includes('evidence_request:operator_note'), false);
  assert.equal(queue.queueStatus, 'ready_for_operator_review');
});
