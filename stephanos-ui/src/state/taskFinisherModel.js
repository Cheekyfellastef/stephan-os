function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

const BLOCKED_TASKS = Object.freeze([
  'shell_execute_from_ui',
  'git_push',
  'github_merge',
  'delete_files',
  'access_secrets',
  'external_account_action',
  'openclaw_execute',
  'self_authority_escalation',
  'scope_expansion',
]);

export function buildTaskFinisherPlan({
  missionSpec = {},
  verificationJudge = {},
  finishAuthority = {},
  repoArchitectureContext = {},
  memoryLibrarianQueue = {},
  openClawDelegation = {},
  prMetadata = {},
} = {}) {
  const routineTasks = [];
  const requiredOperatorDecisions = [];
  const warnings = [];
  const judgment = asText(verificationJudge.judgment, 'no_return');
  const blockers = Array.isArray(verificationJudge.blockers) ? verificationJudge.blockers : [];
  const pendingMemoryApprovals = Number(memoryLibrarianQueue?.counts?.approvalRequired || 0) > 0;
  const generatedOutputTouched = Array.isArray(repoArchitectureContext.generatedOutputsLikelyTouched) && repoArchitectureContext.generatedOutputsLikelyTouched.length > 0;
  const sourceWarnings = Array.isArray(repoArchitectureContext.sourceTruthWarnings) ? repoArchitectureContext.sourceTruthWarnings : [];

  if (judgment === 'no_return') routineTasks.push('review_verification_return');
  if (judgment === 'insufficient_evidence') routineTasks.push('request_codex_narrow_fix');
  if (judgment === 'needs_fix' || blockers.length > 0) routineTasks.push('request_codex_narrow_fix');
  if (judgment === 'proof_pending') routineTasks.push('prepare_merge_readiness_summary');
  if (['blocked', 'unsafe'].includes(judgment)) requiredOperatorDecisions.push('verification blocked/unsafe: operator decision required');
  if (judgment === 'merge_ready_candidate') routineTasks.push('prepare_merge_readiness_summary');

  const requiredTestsRun = verificationJudge.requiredTestsRun === true;
  const testsLikelyRequired = Array.isArray(repoArchitectureContext.testsLikelyRequired) && repoArchitectureContext.testsLikelyRequired.length > 0;
  if (!requiredTestsRun || testsLikelyRequired) routineTasks.push('rerun_targeted_tests');

  if (generatedOutputTouched || sourceWarnings.length > 0 || prMetadata.distStaleLikely === true) {
    routineTasks.push('rebuild_generated_dist', 'rerun_stephanos_verify');
  }

  if (pendingMemoryApprovals) {
    routineTasks.push('review_memory_librarian_candidates');
    requiredOperatorDecisions.push('memory librarian approval required');
  }

  routineTasks.push('update_support_snapshot_fields');

  const mergeAuthorityIncluded = finishAuthority.mergeAuthorityIncluded === true;
  const routineFinishAllowed = finishAuthority.routineFinishAllowed === true;
  const verificationPass = !['blocked', 'unsafe', 'needs_fix', 'insufficient_evidence', 'no_return', 'proof_pending'].includes(judgment) && blockers.length === 0;

  if (!mergeAuthorityIncluded || !verificationPass) {
    routineTasks.push('request_operator_merge_decision');
  }

  if (openClawDelegation && verificationJudge.openClawBoundarySatisfied === false) {
    requiredOperatorDecisions.push('openclaw boundary review required');
  }
  if (Array.isArray(verificationJudge.warnings) && verificationJudge.warnings.some((w) => /openclaw.*execut/i.test(String(w)))) {
    requiredOperatorDecisions.push('verification claims openclaw execution/mutation; review boundary');
  }

  const uniqueTasks = [...new Set(routineTasks)];
  const codexRepairNeeded = uniqueTasks.includes('request_codex_narrow_fix');
  const rebuildDistNeeded = uniqueTasks.includes('rebuild_generated_dist');
  const rerunTestsNeeded = uniqueTasks.includes('rerun_targeted_tests');
  const proofOfDoneNeeded = judgment === 'proof_pending' || verificationJudge.proofOfDoneStatus === 'pending';
  const memoryReviewNeeded = pendingMemoryApprovals;
  const architectureScopeReviewNeeded = sourceWarnings.length > 0;
  const openClawBoundaryReviewNeeded = requiredOperatorDecisions.some((entry) => /openclaw/i.test(entry));
  const mergeStillOperatorControlled = !mergeAuthorityIncluded || !verificationPass;

  if (!routineFinishAllowed) warnings.push('Routine finish: recommendations only');
  if (mergeStillOperatorControlled) warnings.push('Merge: operator-controlled');
  warnings.push('No shell/GitHub execution is performed by Stephanos UI.');

  const warningLevel = requiredOperatorDecisions.length > 0 ? 'high' : codexRepairNeeded ? 'medium' : 'low';
  const safeToContinueRoutineFinish = requiredOperatorDecisions.length === 0 && judgment !== 'unsafe' && judgment !== 'blocked';
  const nextAction = codexRepairNeeded
    ? 'request Codex narrow fix and rerun verify'
    : rebuildDistNeeded
      ? 'rebuild generated dist and rerun stephanos verify'
      : mergeStillOperatorControlled
        ? 'request operator merge decision'
        : 'prepare merge-readiness summary';

  return {
    missionId: asText(missionSpec.missionId, 'unknown-mission'),
    finishPlanStatus: safeToContinueRoutineFinish ? 'ready_for_routine_finish' : 'operator_decision_required',
    finishPlanLevel: routineFinishAllowed ? 'routine_finish_enabled' : 'recommendations_only',
    routineTasks: uniqueTasks,
    blockedTasks: [...BLOCKED_TASKS],
    requiredOperatorDecisions: [...new Set(requiredOperatorDecisions)],
    safeToContinueRoutineFinish,
    mergeStillOperatorControlled,
    codexRepairNeeded,
    rebuildDistNeeded,
    rerunTestsNeeded,
    proofOfDoneNeeded,
    memoryReviewNeeded,
    architectureScopeReviewNeeded,
    openClawBoundaryReviewNeeded,
    nextAction,
    warningLevel,
    warnings,
  };
}
