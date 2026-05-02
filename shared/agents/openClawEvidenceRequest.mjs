const STATUSES = new Set(['none','requested','partially_satisfied','satisfied','blocked','archived']);
const EVIDENCE_TYPES = new Set(['readonly_validation','capability_report','permission_diff','rollback_plan','audit_preview','risk_classification','operator_note','codex_review_note','test_evidence','implementation_scope','blocked_action_reason','other']);

function asArray(v){return Array.isArray(v)?v:[];}

export function buildOpenClawEvidenceRequest(input = {}, { reviewDecision = 'not_reviewed', packetId = 'none', attachments = [] } = {}) {
  const evidenceNeeded = asArray(input.evidenceNeeded).length ? asArray(input.evidenceNeeded) : [input.requestedEvidenceType || 'operator_note'];
  const evidenceProvided = asArray(input.evidenceProvided).length ? asArray(input.evidenceProvided) : asArray(attachments).map((a) => a.evidenceType).filter(Boolean);
  const missingEvidence = evidenceNeeded.filter((item) => !evidenceProvided.includes(item));
  const requestedEvidenceType = EVIDENCE_TYPES.has(input.requestedEvidenceType) ? input.requestedEvidenceType : (evidenceNeeded[0] || 'other');
  const archived = ['rejected', 'archived'].includes(String(reviewDecision));
  const status = archived ? 'archived' : (STATUSES.has(input.requestStatus) ? input.requestStatus : (reviewDecision === 'needs_more_evidence'
    ? (missingEvidence.length === 0 ? 'satisfied' : (evidenceProvided.length > 0 ? 'partially_satisfied' : 'requested'))
    : 'none'));
  return {
    requestId: input.requestId || `openclaw-evidence-${packetId}`,
    packetId: input.packetId || packetId,
    requestStatus: status,
    requestMode: 'review_evidence_only',
    requestedEvidenceType,
    title: input.title || `Evidence request: ${requestedEvidenceType}`,
    reason: input.reason || 'Operator requested additional evidence for review.',
    requiredForCodexReview: input.requiredForCodexReview !== false,
    requestedBy: input.requestedBy || 'operator',
    requestedFrom: input.requestedFrom || 'openclaw',
    priority: input.priority || 'normal',
    blocking: input.blocking !== false,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidenceNeeded,
    evidenceProvided,
    missingEvidence,
    blockers: asArray(input.blockers),
    warnings: asArray(input.warnings),
    executionAllowed: false,
    selfModificationAllowed: false,
    operatorApprovalRequired: true,
    nextAction: status === 'satisfied' ? 'Mark ready for Codex review.' : 'Add requested OpenClaw proposal evidence',
  };
}
