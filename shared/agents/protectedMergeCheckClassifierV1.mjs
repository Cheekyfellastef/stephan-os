import { REQUIRED_EXACT_HEAD_WORKFLOWS } from './operatorMergeApprovalGate.mjs';

export const PROTECTED_MERGE_REQUIRED_WORKFLOWS = Object.freeze([
  ...REQUIRED_EXACT_HEAD_WORKFLOWS,
]);

const PROTECTED_MERGE_NEUTRAL_SKIPPED_CHECKS = new Set([
  'Exact-Head Review Dispatch\0coordinate',
  'Exact-Head Review Dispatch\0retry',
]);

export function validateProtectedMergeCheckRows(checks) {
  if (!Array.isArray(checks) || checks.length < 1) return false;
  const successfulRequiredWorkflows = new Set();
  const requiredWorkflows = new Set(PROTECTED_MERGE_REQUIRED_WORKFLOWS);

  for (const check of checks) {
    const name = String(check?.name || '').trim();
    const workflow = String(check?.workflow || '').trim();
    const state = String(check?.state || '').trim().toUpperCase();
    if (!name || !workflow || !state) return false;

    // Independent review artifacts adjudicate review/escalation workflows. This
    // classifier owns only the canonical CI predicate used by every merge stage.
    if (!requiredWorkflows.has(workflow)) continue;

    const identity = `${workflow}\0${name}`;
    if (state === 'SUCCESS') {
      successfulRequiredWorkflows.add(workflow);
      continue;
    }
    if (state === 'SKIPPED' && PROTECTED_MERGE_NEUTRAL_SKIPPED_CHECKS.has(identity)) continue;
    return false;
  }

  return PROTECTED_MERGE_REQUIRED_WORKFLOWS.every((workflow) => (
    successfulRequiredWorkflows.has(workflow)
  ));
}
