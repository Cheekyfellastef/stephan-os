const DEFAULT_ROLLBACK_STEPS = Object.freeze([
  'keep execution disabled',
  'preserve previous permission envelope',
  'retain audit evidence',
  'revert proposed permission increase',
  're-run readonly validation',
  're-run capability trial report',
]);

export function buildOpenClawRollbackPlan({ rollbackAvailable = true, missingRollbackElements = [] } = {}) {
  const missing = Array.isArray(missingRollbackElements) ? missingRollbackElements : [];
  return {
    rollbackStatus: rollbackAvailable && missing.length === 0 ? 'preview_ready' : 'incomplete',
    rollbackMode: 'preview_only',
    required: true,
    rollbackAvailable: rollbackAvailable && missing.length === 0,
    rollbackSteps: [...DEFAULT_ROLLBACK_STEPS],
    missingRollbackElements: [...missing],
    executionAllowed: false,
    operatorApprovalRequired: true,
    nextAction: missing.length === 0
      ? 'Include rollback preview in operator review package.'
      : 'Fill missing rollback elements before future-stage approval review.',
  };
}
