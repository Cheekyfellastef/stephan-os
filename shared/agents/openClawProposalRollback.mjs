export function buildOpenClawProposalRollback({ rollbackSteps = [] } = {}) {
  const defaultSteps = [
    'preserve current permission boundary',
    'keep execution disabled',
    'keep prior UI/source behavior recoverable',
    'require Git diff review before merge',
    'require test evidence before operator approval',
    'rerun readonly validation after changes',
    'rerun capability report after changes',
  ];
  const steps = Array.isArray(rollbackSteps) && rollbackSteps.length ? rollbackSteps : defaultSteps;
  const missingRollbackElements = [];
  return {
    rollbackStatus: steps.length > 0 ? 'preview_ready' : 'missing_preview',
    rollbackMode: 'preview_only',
    rollbackRequired: true,
    rollbackSummary: 'Rollback is descriptive-only and requires operator-approved Codex workflow.',
    rollbackSteps: steps,
    missingRollbackElements,
    executionAllowed: false,
    operatorApprovalRequired: true,
    nextAction: 'Review rollback preview before any future implementation approval.',
  };
}
