import { OPENCLAW_CATASTROPHIC_ACTIONS } from './openclawTilePolicy.js';

const BLOCKED_ACTION_SET = new Set(OPENCLAW_CATASTROPHIC_ACTIONS);

export function isOpenClawActionBlocked(actionId = '') {
  return BLOCKED_ACTION_SET.has(String(actionId || '').trim());
}

export function buildOpenClawGuardrailSnapshot() {
  return {
    mode: 'shadow',
    zeroCostPosture: 'active',
    paidPathsAllowed: false,
    directExecutionAllowed: false,
    blockedActions: [...BLOCKED_ACTION_SET],
    blockedActionCount: BLOCKED_ACTION_SET.size,
  };
}
