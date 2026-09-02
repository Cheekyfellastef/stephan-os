const SHA40 = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/;

export const MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_SCHEMA =
  'stephanos.main-movement-tolerant-operator-authorization.v1';

export const MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT = Object.freeze({
  BLOCKED: 'MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_BLOCKED',
  REUSABLE_FRESH_EVIDENCE_REQUIRED: 'AUTHORIZATION_REUSABLE_FRESH_EVIDENCE_REQUIRED',
  READY_FOR_PROTECTED_EXECUTION: 'MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_READY_FOR_PROTECTED_EXECUTION',
});

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function path(value) {
  return text(value).replace(/\\/g, '/');
}

function normalizePaths(values) {
  if (!Array.isArray(values)) return null;
  const normalized = values.map(path);
  if (!normalized.length
    || normalized.some((candidate) => !SAFE_PATH.test(candidate))
    || new Set(normalized).size !== normalized.length) return null;
  return Object.freeze([...normalized].sort());
}

function comparisonPaths(comparison = {}) {
  if (!Array.isArray(comparison.files)) return null;
  return normalizePaths(comparison.files.map((file) => file?.filename ?? file?.path));
}

function equalLists(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function exactForwardComparison(comparison = {}, baseSha, headSha, { allowIdentical = false } = {}) {
  const blockers = [];
  const status = text(comparison.status).toLowerCase();
  const ahead = Number(comparison.ahead_by);
  const behind = Number(comparison.behind_by);
  const observedBase = exactSha(comparison?.base_commit?.sha);
  const mergeBase = exactSha(comparison?.merge_base_commit?.sha);
  const observedHead = exactSha(comparison?.head_commit?.sha);

  if (allowIdentical && baseSha === headSha) {
    if (!['identical', 'ahead'].includes(status)) blockers.push('comparison-status-not-identical');
    if (Number.isFinite(ahead) && ahead !== 0) blockers.push('comparison-ahead-not-zero');
    if (Number.isFinite(behind) && behind !== 0) blockers.push('comparison-behind-not-zero');
  } else {
    if (status !== 'ahead') blockers.push('comparison-status-not-ahead');
    if (!Number.isSafeInteger(ahead) || ahead < 1) blockers.push('comparison-ahead-invalid');
    if (behind !== 0) blockers.push('comparison-behind-not-zero');
  }

  if (observedBase !== baseSha) blockers.push('comparison-base-mismatch');
  if (mergeBase !== baseSha) blockers.push('comparison-merge-base-mismatch');
  if (observedHead !== headSha) blockers.push('comparison-head-mismatch');

  return Object.freeze({ valid: blockers.length === 0, blockers: Object.freeze(blockers) });
}

function blocked(blockers, projection = {}) {
  return Object.freeze({
    schemaVersion: MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_SCHEMA,
    authorizationReusable: false,
    operatorReapprovalRequired: true,
    freshTechnicalEvidenceRequired: true,
    protectedExecutionReady: false,
    reusableAcrossHeads: false,
    reusableAcrossCompatibleBases: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    ...projection,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.BLOCKED,
  });
}

/**
 * Separates immutable operator judgment from refreshable integration evidence.
 *
 * This function grants no merge authority. It only decides whether the original
 * operator judgment may remain attached to the same exact source change while
 * technical evidence is refreshed against a newer descendant of protected main.
 */
export function evaluateMainMovementTolerantOperatorAuthorizationV1(input = {}) {
  const authorization = input.authorization && typeof input.authorization === 'object'
    ? input.authorization
    : {};
  const observed = input.observed && typeof input.observed === 'object'
    ? input.observed
    : {};
  const blockers = [];

  const repository = text(authorization.repository);
  const prNumber = positiveInteger(authorization.prNumber);
  const branch = text(authorization.branch);
  const sourceHead = exactSha(authorization.sourceHead);
  const sourceTree = exactSha(authorization.sourceTree);
  const authorizationBase = exactSha(authorization.authorizationBase);
  const authorityClass = text(authorization.authorityClass);
  const approvedPaths = normalizePaths(authorization.changedPaths);

  if (repository !== REPOSITORY) blockers.push('authorization-repository-not-canonical');
  if (!prNumber) blockers.push('authorization-pr-invalid');
  if (!BRANCH.test(branch) || branch.includes('..')) blockers.push('authorization-branch-invalid');
  if (!sourceHead) blockers.push('authorization-head-invalid');
  if (!sourceTree) blockers.push('authorization-tree-invalid');
  if (!authorizationBase) blockers.push('authorization-base-invalid');
  if (!authorityClass) blockers.push('authorization-class-missing');
  if (!approvedPaths) blockers.push('authorization-changed-paths-invalid');
  if (authorization.reusableAcrossHeads !== false) blockers.push('authorization-must-not-reuse-across-heads');

  const currentBase = exactSha(observed.currentBase);
  if (!currentBase) blockers.push('observed-current-base-invalid');
  if (text(observed.repository) !== repository) blockers.push('observed-repository-mismatch');
  if (positiveInteger(observed.prNumber) !== prNumber) blockers.push('observed-pr-mismatch');
  if (text(observed.branch) !== branch) blockers.push('observed-branch-mismatch');
  if (exactSha(observed.sourceHead) !== sourceHead) blockers.push('observed-head-mismatch');
  if (exactSha(observed.sourceTree) !== sourceTree) blockers.push('observed-tree-mismatch');
  if (text(observed.authorityClass) !== authorityClass) blockers.push('observed-authority-class-mismatch');

  const observedApprovedPaths = normalizePaths(observed.changedPaths);
  if (!observedApprovedPaths || !approvedPaths || !equalLists(observedApprovedPaths, approvedPaths)) {
    blockers.push('observed-changed-path-estate-mismatch');
  }

  if (blockers.length) {
    return blocked(blockers, { repository, prNumber, branch, sourceHead, sourceTree, authorizationBase, currentBase, authorityClass });
  }

  const approvedChangeComparison = exactForwardComparison(
    observed.authorizationBaseToSourceComparison,
    authorizationBase,
    sourceHead,
  );
  if (!approvedChangeComparison.valid) {
    blockers.push(...approvedChangeComparison.blockers.map((blocker) => `approved-change:${blocker}`));
  }
  const approvedComparisonPaths = comparisonPaths(observed.authorizationBaseToSourceComparison);
  if (!approvedComparisonPaths || !equalLists(approvedComparisonPaths, approvedPaths)) {
    blockers.push('approved-change:path-estate-mismatch');
  }

  let movementPaths = Object.freeze([]);
  if (currentBase === authorizationBase) {
    const suppliedMovement = observed.authorizationBaseToCurrentBaseComparison;
    if (suppliedMovement) {
      const noMovement = exactForwardComparison(suppliedMovement, authorizationBase, currentBase, { allowIdentical: true });
      if (!noMovement.valid) blockers.push(...noMovement.blockers.map((blocker) => `main-movement:${blocker}`));
      const suppliedPaths = comparisonPaths(suppliedMovement);
      if (suppliedPaths && suppliedPaths.length) blockers.push('main-movement:unexpected-paths-without-movement');
    }
  } else {
    const mainMovement = exactForwardComparison(
      observed.authorizationBaseToCurrentBaseComparison,
      authorizationBase,
      currentBase,
    );
    if (!mainMovement.valid) {
      blockers.push(...mainMovement.blockers.map((blocker) => `main-movement:${blocker}`));
    }
    const candidateMovementPaths = comparisonPaths(observed.authorizationBaseToCurrentBaseComparison);
    if (!candidateMovementPaths) blockers.push('main-movement:path-estate-invalid');
    else movementPaths = candidateMovementPaths;
  }

  const overlaps = approvedPaths.filter((approvedPath) => movementPaths.includes(approvedPath));
  if (overlaps.length) blockers.push(...overlaps.map((candidate) => `main-movement:approved-path-overlap:${candidate}`));

  if (blockers.length) {
    return blocked(blockers, {
      repository,
      prNumber,
      branch,
      sourceHead,
      sourceTree,
      authorizationBase,
      currentBase,
      authorityClass,
      approvedChangedPaths: approvedPaths,
      interveningMainChangedPaths: movementPaths,
      overlappingPaths: Object.freeze(overlaps),
    });
  }

  const unresolvedThreads = Number(observed.unresolvedReviewThreads);
  const freshEvidenceReady = observed.currentBaseRequiredChecksGreen === true
    && observed.currentBaseIndependentReviewClean === true
    && observed.mergeable === true
    && Number.isSafeInteger(unresolvedThreads)
    && unresolvedThreads === 0;

  return Object.freeze({
    schemaVersion: MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_SCHEMA,
    repository,
    prNumber,
    branch,
    sourceHead,
    sourceTree,
    authorityClass,
    authorizationBase,
    executionBase: currentBase,
    approvedChangedPaths: approvedPaths,
    interveningMainChangedPaths: movementPaths,
    overlappingPaths: Object.freeze([]),
    authorizationReusable: true,
    operatorReapprovalRequired: false,
    freshTechnicalEvidenceRequired: true,
    protectedExecutionReady: freshEvidenceReady,
    reusableAcrossHeads: false,
    reusableAcrossCompatibleBases: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    blockers: Object.freeze(freshEvidenceReady ? [] : ['fresh-current-base-evidence-required']),
    finalVerdict: freshEvidenceReady
      ? MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.READY_FOR_PROTECTED_EXECUTION
      : MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.REUSABLE_FRESH_EVIDENCE_REQUIRED,
  });
}
