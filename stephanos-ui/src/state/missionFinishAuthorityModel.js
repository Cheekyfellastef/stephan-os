function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

export const MISSION_FINISH_AUTHORITY_LEVELS = Object.freeze([
  'none',
  'plan_only',
  'build_allowed',
  'verify_allowed',
  'routine_finish_allowed',
  'merge_authorized',
]);

const LEVEL_ORDER = Object.freeze({
  none: 0,
  plan_only: 1,
  build_allowed: 2,
  verify_allowed: 3,
  routine_finish_allowed: 4,
  merge_authorized: 5,
});

export function createMissionFinishAuthority(input = {}) {
  const level = MISSION_FINISH_AUTHORITY_LEVELS.includes(input.finishAuthorityLevel)
    ? input.finishAuthorityLevel
    : 'none';
  const merged = asBoolean(input.merged, false);
  const checksStatus = asText(input.checksStatus, 'unknown');
  const verificationStatus = asText(input.verificationStatus, 'unknown');

  return {
    missionId: asText(input.missionId, 'n/a'),
    prNumber: asText(input.prNumber, 'n/a'),
    prUrl: asText(input.prUrl, ''),
    finishAuthorityStatus: asText(input.finishAuthorityStatus, level === 'none' ? 'not_granted' : 'granted'),
    finishAuthorityLevel: level,
    routineFinishAllowed: asBoolean(input.routineFinishAllowed, false),
    retryChecksAllowed: asBoolean(input.retryChecksAllowed, false),
    rebuildDistAllowed: asBoolean(input.rebuildDistAllowed, false),
    updatePrAllowed: asBoolean(input.updatePrAllowed, false),
    mergeAuthorityIncluded: asBoolean(input.mergeAuthorityIncluded, false),
    autoMergeArmed: asText(input.autoMergeArmed, 'unknown'),
    operatorApprovalRecorded: asBoolean(input.operatorApprovalRecorded, false),
    approvedBy: asText(input.approvedBy, ''),
    approvedAt: asText(input.approvedAt, ''),
    merged,
    mergedBy: asText(input.mergedBy, ''),
    mergedAt: asText(input.mergedAt, ''),
    mergeCommitSha: asText(input.mergeCommitSha, ''),
    mergeSource: asText(input.mergeSource, 'unknown'),
    checksStatus,
    verificationStatus,
    scopeStatus: asText(input.scopeStatus, 'in_scope'),
    warningLevel: asText(input.warningLevel, 'info'),
    warnings: Array.isArray(input.warnings) ? input.warnings.map((w) => asText(w)).filter(Boolean) : [],
    nextAction: asText(input.nextAction, 'Record finish authority and rerun verification before merge decisions.'),
  };
}

function levelAtLeast(level = 'none', minimum = 'none') {
  return (LEVEL_ORDER[level] || 0) >= (LEVEL_ORDER[minimum] || 0);
}

export function adjudicateMissionFinishAuthority(input = {}) {
  const model = createMissionFinishAuthority(input);
  const warnings = [...model.warnings];

  const routineFinishAllowed = model.routineFinishAllowed || levelAtLeast(model.finishAuthorityLevel, 'routine_finish_allowed');
  const mergeAuthorityIncluded = model.mergeAuthorityIncluded || levelAtLeast(model.finishAuthorityLevel, 'merge_authorized');
  const checksPassing = ['pass', 'passed', 'ok', 'green'].includes(model.checksStatus.toLowerCase());
  const verificationPassing = ['pass', 'passed', 'verified', 'ok'].includes(model.verificationStatus.toLowerCase());
  const checksKnownGood = checksPassing && verificationPassing;

  if (model.autoMergeArmed === 'unknown') warnings.push('Auto-merge state is unknown.');
  if (!checksKnownGood) warnings.push('Checks failed or unknown; do not treat as merge-ready.');
  if (routineFinishAllowed && !mergeAuthorityIncluded) warnings.push('Routine finish allowed, but merge remains blocked.');
  if (model.rebuildDistAllowed) warnings.push('Dist rebuild is allowed only as generated artifact refresh, not source-truth editing.');
  if (model.merged && !mergeAuthorityIncluded) warnings.push('PR merged but no recorded merge authority was found.');
  if (model.merged && !model.operatorApprovalRecorded) warnings.push('Warning: PR merged without recorded approval');
  if (model.scopeStatus && model.scopeStatus !== 'in_scope') warnings.push('Actual changed/merged state appears outside approved mission scope.');

  const canContinueRoutineFinish = routineFinishAllowed && !model.merged;
  const requiresCodexRepair = !checksKnownGood;
  const mergedWithoutRecordedApproval = model.merged && !model.operatorApprovalRecorded;

  const nextAction = requiresCodexRepair
    ? 'Run Codex repair cycle, rerun checks, and keep merge blocked until verification passes.'
    : mergeAuthorityIncluded
      ? 'Merge may proceed only with recorded operator approval and in-scope changes.'
      : 'Merge is not authorized by this mission.';

  return {
    ...model,
    routineFinishAllowed,
    mergeAuthorityIncluded,
    canContinueRoutineFinish,
    requiresCodexRepair,
    mergedWithoutRecordedApproval,
    checksKnownGood,
    warningLevel: warnings.length ? (warnings.some((w) => /merged|blocked|failed|outside/i.test(w)) ? 'high' : 'medium') : 'none',
    warnings,
    nextAction,
  };
}
