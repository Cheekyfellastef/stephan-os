const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeRequirement(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasDeterministicProof(receipt = {}) {
  return SHA256_PATTERN.test(text(receipt.sha256))
    || SHA256_PATTERN.test(text(receipt.commandOutputHash))
    || receipt.exitCode === 0
    || /^(?:proof|proofs|receipts|evidence\/receipts)\//.test(text(receipt.receiptPath).replace(/\\/g, '/'));
}

export function judgeMissionEvidence(action = {}) {
  if (action.actionKind !== 'evidence-judgment') {
    return {
      success: false,
      missingRequirements: [],
      acceptedReceipts: [],
      error: 'Unsupported evidence judgment action.',
      finalVerdict: 'MISSION_EVIDENCE_JUDGMENT_BLOCKED',
    };
  }

  const required = [...new Set((action.requiredEvidence || []).map(text).filter(Boolean))];
  const acceptedReceipts = (action.receipts || []).filter((receipt) => (
    receipt
    && typeof receipt === 'object'
    && receipt.verified === true
    && normalizeRequirement(receipt.requirement)
    && text(receipt.source)
    && text(receipt.evidenceType)
    && hasDeterministicProof(receipt)
  ));
  const satisfied = new Set(acceptedReceipts.map((receipt) => normalizeRequirement(receipt.requirement)));
  const missingRequirements = required.filter((requirement) => !satisfied.has(normalizeRequirement(requirement)));
  const success = required.length > 0 && missingRequirements.length === 0;

  return {
    success,
    missingRequirements,
    acceptedReceipts,
    error: success ? '' : `Missing deterministic evidence: ${missingRequirements.join(', ') || 'required evidence declaration'}.`,
    finalVerdict: success ? 'MISSION_EVIDENCE_JUDGMENT_PASS' : 'MISSION_EVIDENCE_JUDGMENT_BLOCKED',
  };
}
