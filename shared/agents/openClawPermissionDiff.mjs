import { BLOCKED_CAPABILITIES } from './openClawPermissionEnvelope.mjs';

function asSet(value) {
  return new Set(Array.isArray(value) ? value : []);
}

export function buildOpenClawPermissionDiff({ currentEnvelope = {}, requestedEnvelope = {} } = {}) {
  const currentAllowed = asSet(currentEnvelope.allowedCapabilities);
  const requestedAllowed = asSet(requestedEnvelope.allowedCapabilities);
  const addedCapabilities = [...requestedAllowed].filter((cap) => !currentAllowed.has(cap));
  const removedCapabilities = [...currentAllowed].filter((cap) => !requestedAllowed.has(cap));
  const unchangedCapabilities = [...requestedAllowed].filter((cap) => currentAllowed.has(cap));
  const requestedBlocked = asSet(requestedEnvelope.blockedCapabilities || BLOCKED_CAPABILITIES);
  const newlyBlockedCapabilities = [...requestedBlocked].filter((cap) => !(currentEnvelope.blockedCapabilities || []).includes(cap));
  const highRiskAdded = addedCapabilities.filter((cap) => ['execute_command', 'edit_file', 'write_git', 'control_browser', 'autonomous_action'].includes(cap));
  return {
    diffStatus: highRiskAdded.length > 0 ? 'future_gated_increase_blocked' : 'preview_ready',
    diffMode: 'preview_only',
    addedCapabilities,
    removedCapabilities,
    unchangedCapabilities,
    newlyBlockedCapabilities,
    riskIncrease: highRiskAdded.length > 0 ? 'high' : (addedCapabilities.length > 0 ? 'medium' : 'none'),
    requiresOperatorApproval: true,
    approvalEligible: false,
    executionAllowed: false,
    nextAction: highRiskAdded.length > 0
      ? 'Requested increase includes future-gated capabilities and remains blocked in preview mode.'
      : 'Operator may review preview diff; no permission changes can be applied.',
  };
}
