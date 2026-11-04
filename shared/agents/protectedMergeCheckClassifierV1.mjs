import { REQUIRED_EXACT_HEAD_WORKFLOWS } from './operatorMergeApprovalGate.mjs';

export const PROTECTED_MERGE_REQUIRED_WORKFLOWS = Object.freeze([
  ...REQUIRED_EXACT_HEAD_WORKFLOWS,
]);

const PROTECTED_MERGE_NEUTRAL_SKIPPED_CHECKS = new Set([
  // Pages deployment is intentionally excluded from pull_request. The same
  // workflow's required source/test jobs must still include a SUCCESS.
  // This skip requires an explicitly proved pull_request event. A push or
  // workflow_dispatch on the same commit is NOT a neutral PR Pages skip.
  'Build Stephanos UI\0pages-deploy',
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

    // A same-head workflow_dispatch/push Build can NEVER satisfy required
    // pull_request Build CI, regardless of whether Pages emitted a SKIPPED row.
    // Ignore other-trigger Build rows instead of letting their successes or
    // conclusions influence the genuine PR build evaluation.
    if (workflow === 'Build Stephanos UI' && check?.event !== 'pull_request') {
      // Ignore a non-PR success, but never silently accept an unexpected
      // skipped/failed required Build check or forged Pages skip.
      if (state === 'SUCCESS') continue;
      return false;
    }

    const identity = `${workflow}\0${name}`;
    if (state === 'SUCCESS') {
      successfulRequiredWorkflows.add(workflow);
      continue;
    }
    if (state === 'SKIPPED' && PROTECTED_MERGE_NEUTRAL_SKIPPED_CHECKS.has(identity)
      && (identity !== 'Build Stephanos UI\0pages-deploy' || check?.event === 'pull_request')) {
      continue;
    }
    return false;
  }

  return PROTECTED_MERGE_REQUIRED_WORKFLOWS.every((workflow) => (
    successfulRequiredWorkflows.has(workflow)
  ));
}
