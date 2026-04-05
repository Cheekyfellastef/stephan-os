const STATUS = new Set(['draft', 'ready', 'blocked', 'completed', 'failed']);

function normalizeStatus(status) {
  return STATUS.has(status) ? status : 'draft';
}

export function normalizeProposalTruthModel(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  return {
    proposalId: String(input.proposalId || '').trim() || 'proposal_unknown',
    intentType: String(input.intentType || 'unknown').trim() || 'unknown',
    proposalCreated: input.proposalCreated === true,
    proposalStatus: normalizeStatus(input.proposalStatus),
    proposalReason: String(input.proposalReason || '').trim(),
    steps,
    proposalStepCount: steps.length,
  };
}
