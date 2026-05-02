const STATUSES = new Set(['draft','attached','accepted_for_review','rejected','archived']);
const SOURCES = new Set(['operator','chatgpt','codex','stephanos','openclaw_readonly','unknown']);

export function buildOpenClawEvidenceAttachment(input = {}) {
  return {
    attachmentId: input.attachmentId || `openclaw-attachment-${Date.now()}`,
    requestId: input.requestId || 'none',
    packetId: input.packetId || 'none',
    evidenceType: input.evidenceType || 'operator_note',
    attachmentStatus: STATUSES.has(input.attachmentStatus) ? input.attachmentStatus : 'attached',
    source: SOURCES.has(input.source) ? input.source : 'unknown',
    title: input.title || 'Evidence Attachment',
    summary: input.summary || '',
    content: input.content || '',
    tokens: Array.isArray(input.tokens) ? input.tokens : [],
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    blockers: Array.isArray(input.blockers) ? input.blockers : [],
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trustedForReview: input.trustedForReview === true,
    executionAllowed: false,
    selfModificationAllowed: false,
    openClawSelfApprovalAllowed: false,
  };
}
