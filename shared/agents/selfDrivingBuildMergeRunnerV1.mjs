export const SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES = Object.freeze({
  READY_FOR_PROOF: 'READY_FOR_PROOF',
  PROOF_FAILED: 'PROOF_FAILED',
  READY_TO_MERGE: 'READY_TO_MERGE',
  MERGED: 'MERGED',
  DUPLICATE_ALREADY_ON_MAIN: 'DUPLICATE_ALREADY_ON_MAIN',
  DIRTY_TREE_BLOCKED: 'DIRTY_TREE_BLOCKED',
  MERGE_CONFLICT_BLOCKED: 'MERGE_CONFLICT_BLOCKED',
  BLOCKED_WITH_EXACT_UNBLOCK_ACTION: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
});

export const SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS = Object.freeze({
  RUN_PROOF: 'RUN_PROOF',
  MERGE_PR: 'MERGE_PR',
  NOOP: 'NOOP',
  STOP: 'STOP',
});

const BLOCKED_STATES = new Set([
  SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.PROOF_FAILED,
  SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.DIRTY_TREE_BLOCKED,
  SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.MERGE_CONFLICT_BLOCKED,
  SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
]);

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeProofStatus(value) {
  return cleanString(value).toUpperCase();
}

function hasExactHeadEvidence(exactHeadEvidence = {}) {
  const expectedHeadSha = cleanString(exactHeadEvidence.expectedHeadSha);
  const actualHeadSha = cleanString(exactHeadEvidence.actualHeadSha);
  const source = cleanString(exactHeadEvidence.source);
  return Boolean(expectedHeadSha && actualHeadSha && source && expectedHeadSha === actualHeadSha);
}

function buildResult({ state, action, canMerge = false, reason, unblockAction = null, mergeHeadSha = null }) {
  if (canMerge && state !== SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.READY_TO_MERGE) {
    throw new Error('Self-driving merge runner invariant violated: only READY_TO_MERGE may merge.');
  }
  if (BLOCKED_STATES.has(state) && !cleanString(unblockAction)) {
    throw new Error(`Self-driving merge runner invariant violated: ${state} requires an exact unblock action.`);
  }
  return {
    state,
    action,
    canMerge,
    reason,
    unblockAction,
    mergeHeadSha,
  };
}

export function classifySelfDrivingBuildMergeRunnerV1({
  workingTreeClean = false,
  mergeConflict = false,
  merged = false,
  duplicateAlreadyOnMain = false,
  exactHeadEvidence = {},
  proof = {},
} = {}) {
  if (!workingTreeClean) {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.DIRTY_TREE_BLOCKED,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.STOP,
      reason: 'The merge runner cannot act while the repository has uncommitted or untracked changes.',
      unblockAction: 'Run `git status --short`, commit or discard every listed file, then rerun the merge runner with workingTreeClean=true.',
    });
  }

  if (mergeConflict) {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.MERGE_CONFLICT_BLOCKED,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.STOP,
      reason: 'The pull request cannot be merged automatically because merge conflict evidence is present.',
      unblockAction: 'Resolve the merge conflicts against main, push the resolved PR head, then rerun proof for the new exact head SHA.',
    });
  }

  if (merged) {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.MERGED,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.NOOP,
      reason: 'The pull request is already merged.',
    });
  }

  if (duplicateAlreadyOnMain) {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.DUPLICATE_ALREADY_ON_MAIN,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.NOOP,
      reason: 'The requested change is already present on main, so another merge would be duplicate work.',
    });
  }

  if (!hasExactHeadEvidence(exactHeadEvidence)) {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.STOP,
      reason: 'Exact PR head evidence is missing or does not match the expected head SHA.',
      unblockAction: 'Fetch the PR head from the provider, record matching exactHeadEvidence.expectedHeadSha and exactHeadEvidence.actualHeadSha plus source, then rerun.',
    });
  }

  const proofStatus = normalizeProofStatus(proof.status);
  const proofHeadSha = cleanString(proof.headSha);
  const actualHeadSha = cleanString(exactHeadEvidence.actualHeadSha);

  if (!proofStatus || proofStatus === 'NOT_RUN') {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.READY_FOR_PROOF,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.RUN_PROOF,
      reason: 'The repository is clean and exact head evidence is present, but proof has not passed yet.',
    });
  }

  if (proofStatus !== 'PASS') {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.PROOF_FAILED,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.STOP,
      reason: 'Proof did not pass, so merge is forbidden.',
      unblockAction: 'Fix the failing proof, rerun proof successfully, and provide proof.status=PASS for the same exact head SHA.',
    });
  }

  if (proofHeadSha !== actualHeadSha) {
    return buildResult({
      state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
      action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.STOP,
      reason: 'Proof passed for a different head SHA than the current exact PR head evidence.',
      unblockAction: 'Rerun proof on exactHeadEvidence.actualHeadSha and provide proof.headSha matching that SHA before merge.',
    });
  }

  return buildResult({
    state: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.READY_TO_MERGE,
    action: SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.MERGE_PR,
    canMerge: true,
    reason: 'The tree is clean, there are no merge conflicts, exact head evidence matches, and proof passed for that exact head.',
    mergeHeadSha: actualHeadSha,
  });
}
