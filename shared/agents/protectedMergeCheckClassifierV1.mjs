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
  let skippedPrPages = false;
  let successfulPrBuild = false;

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
      if (workflow === 'Build Stephanos UI' && check?.event === 'pull_request') successfulPrBuild = true;
      successfulRequiredWorkflows.add(workflow);
      continue;
    }
    if (state === 'SKIPPED' && PROTECTED_MERGE_NEUTRAL_SKIPPED_CHECKS.has(identity)
      && (identity !== 'Build Stephanos UI\0pages-deploy' || check?.event === 'pull_request')) {
      if (identity === 'Build Stephanos UI\0pages-deploy') skippedPrPages = true;
      continue;
    }
    return false;
  }

  // A successful workflow_dispatch/push Build cannot substitute for the
  // missing PR source/test jobs when neutralising a pull_request Pages skip.
  if (skippedPrPages && !successfulPrBuild) return false;
  return PROTECTED_MERGE_REQUIRED_WORKFLOWS.every((workflow) => (
    successfulRequiredWorkflows.has(workflow)
  ));
}
