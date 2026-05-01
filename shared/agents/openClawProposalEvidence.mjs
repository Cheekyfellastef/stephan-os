const SUPPORTED_EVIDENCE_TYPES = new Set([
  'readonly_validation',
  'health_handshake',
  'capability_trial',
  'capability_report',
  'oversight_proposal',
  'permission_boundary',
  'risk_note',
  'rollback_note',
  'operator_context',
  'test_evidence',
]);

function toArray(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

export function buildOpenClawProposalEvidence(input = {}) {
  const evidenceType = String(input.evidenceType || '').trim();
  const supported = SUPPORTED_EVIDENCE_TYPES.has(evidenceType);
  const warnings = toArray(input.warnings);
  if (!supported) warnings.push(`unsupported_evidence_type:${evidenceType || 'missing'}`);
  if (!input.summary) warnings.push('missing_summary');
  return {
    evidenceId: String(input.evidenceId || `evidence-${Date.now()}`),
    evidenceType: supported ? evidenceType : 'operator_context',
    evidenceStatus: String(input.evidenceStatus || (supported ? 'provided' : 'blocked')),
    source: String(input.source || 'openclaw'),
    confidence: String(input.confidence || 'medium'),
    summary: String(input.summary || 'No summary provided.'),
    tokens: toArray(input.tokens),
    warnings,
    blockers: toArray(input.blockers),
    timestamp: String(input.timestamp || new Date().toISOString()),
  };
}

export function normalizeOpenClawProposalEvidence(list = []) {
  return toArray(list).map((item) => buildOpenClawProposalEvidence(item));
}


export function buildOpenClawProposalEvidenceProjection({ readonlyTruth = {}, capabilityTrial = {}, capabilityReport = {} } = {}) {
  const readonlyValidated = readonlyTruth.adapterValidated === true;
  const capabilityReportReady = capabilityReport.reportStatus === 'ready';
  const evidenceStatus = readonlyValidated && capabilityReportReady
    ? 'capability_report_available'
    : readonlyValidated
      ? 'readonly_validation_available'
      : 'awaiting_readonly_validation';
  return {
    status: evidenceStatus,
    readonlyValidated,
    capabilityReportReady,
    executionAllowed: false,
    operatorApprovalRequired: true,
    nextAction: evidenceStatus === 'capability_report_available'
      ? 'Review evidence package in operator queue.'
      : readonlyValidated
        ? 'Capture capability report evidence for operator review.'
        : 'Validate readonly health/handshake before evidence review.',
  };
}
