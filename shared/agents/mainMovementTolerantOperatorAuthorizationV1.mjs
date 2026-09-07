const SHA40 = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/;

export const MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_SCHEMA =
  'stephanos.main-movement-tolerant-operator-authorization.v1';

export const MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_MODE = Object.freeze({
  EXACT_HEAD: 'EXACT_HEAD',
  EVIDENCE_EQUIVALENT_PRESERVATION_CONVERGENCE: 'EVIDENCE_EQUIVALENT_PRESERVATION_CONVERGENCE',
});

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

function normalizeChangedFiles(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const normalized = values.map((entry) => Object.freeze({
    path: path(entry?.path ?? entry?.filename),
    afterBlobSha: exactSha(entry?.afterBlobSha ?? entry?.sha),
  }));
  if (normalized.some((entry) => !SAFE_PATH.test(entry.path) || !entry.afterBlobSha)) return null;
  const paths = normalized.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) return null;
  return Object.freeze([...normalized].sort((left, right) => left.path.localeCompare(right.path)));
}

function filePaths(files) {
  return files ? Object.freeze(files.map((file) => file.path)) : null;
}

function comparisonPaths(comparison = {}) {
  if (!Array.isArray(comparison.files)) return null;
  if (comparison.files.length === 0) return Object.freeze([]);
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
    if (status !== 'identical') blockers.push('comparison-status-not-identical');
    if (ahead !== 0) blockers.push('comparison-ahead-not-zero');
    if (behind !== 0) blockers.push('comparison-behind-not-zero');
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
    reusableAcrossArbitraryHeads: false,
    reusableAcrossCompatibleBases: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    ...projection,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.BLOCKED,
  });
}

function validatePreservationConvergence({
  authorization,
  observed,
  approvedFiles,
  approvedPaths,
  currentBase,
  currentHead,
  currentTree,
}) {
  const convergence = observed.preservationConvergence && typeof observed.preservationConvergence === 'object'
    ? observed.preservationConvergence
    : {};
  const blockers = [];
  const parentShas = Array.isArray(convergence.parents)
    ? convergence.parents.map((parent) => exactSha(parent?.sha ?? parent))
    : [];
  const currentFiles = normalizeChangedFiles(convergence.currentChangedFiles);
  const currentPaths = filePaths(currentFiles);

  if (convergence.proven !== true) blockers.push('convergence-not-proven');
  if (convergence.force === true) blockers.push('convergence-force-forbidden');
  if (convergence.rebase === true || convergence.reset === true) blockers.push('convergence-destructive-history-forbidden');
  if (text(convergence.branch) !== text(authorization.branch)) blockers.push('convergence-branch-mismatch');
  if (exactSha(convergence.priorHead) !== exactSha(authorization.sourceHead)) blockers.push('convergence-prior-head-mismatch');
  if (exactSha(convergence.priorTree) !== exactSha(authorization.sourceTree)) blockers.push('convergence-prior-tree-mismatch');
  if (exactSha(convergence.newHead) !== currentHead) blockers.push('convergence-new-head-mismatch');
  if (exactSha(convergence.newTree) !== currentTree) blockers.push('convergence-new-tree-mismatch');
  if (parentShas.length !== 2
    || parentShas[0] !== exactSha(authorization.sourceHead)
    || parentShas[1] !== currentBase) {
    blockers.push('convergence-parent-lineage-not-canonical');
  }
  if (!currentFiles || !equalLists(currentPaths, approvedPaths)) blockers.push('convergence-current-path-estate-mismatch');

  if (currentFiles && approvedFiles) {
    const approvedByPath = new Map(approvedFiles.map((file) => [file.path, file.afterBlobSha]));
    for (const file of currentFiles) {
      if (approvedByPath.get(file.path) !== file.afterBlobSha) {
        blockers.push(`convergence-approved-blob-changed:${file.path}`);
      }
    }
  }

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    currentFiles: currentFiles || Object.freeze([]),
  });
}

/**
 * Decides only whether existing operator judgment may be carried forward.
 * It grants no merge, deployment or runtime authority.
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
  const authorizedHead = exactSha(authorization.sourceHead);
  const authorizedTree = exactSha(authorization.sourceTree);
  const authorizationBase = exactSha(authorization.authorizationBase);
  const authorityClass = text(authorization.authorityClass);
  const approvedFiles = normalizeChangedFiles(authorization.changedFiles);
  const approvedPaths = filePaths(approvedFiles);

  if (repository !== REPOSITORY) blockers.push('authorization-repository-not-canonical');
  if (!prNumber) blockers.push('authorization-pr-invalid');
  if (!BRANCH.test(branch) || branch.includes('..')) blockers.push('authorization-branch-invalid');
  if (!authorizedHead) blockers.push('authorization-head-invalid');
  if (!authorizedTree) blockers.push('authorization-tree-invalid');
  if (!authorizationBase) blockers.push('authorization-base-invalid');
  if (!authorityClass) blockers.push('authorization-class-missing');
  if (!approvedFiles) blockers.push('authorization-changed-files-invalid');

  const currentBase = exactSha(observed.currentBase);
  const currentHead = exactSha(observed.sourceHead);
  const currentTree = exactSha(observed.sourceTree);
  if (!currentBase) blockers.push('observed-current-base-invalid');
  if (!currentHead) blockers.push('observed-head-invalid');
  if (!currentTree) blockers.push('observed-tree-invalid');
  if (text(observed.repository) !== repository) blockers.push('observed-repository-mismatch');
  if (positiveInteger(observed.prNumber) !== prNumber) blockers.push('observed-pr-mismatch');
  if (text(observed.branch) !== branch) blockers.push('observed-branch-mismatch');
  if (text(observed.authorityClass) !== authorityClass) blockers.push('observed-authority-class-mismatch');

  if (blockers.length) {
    return blocked(blockers, {
      repository,
      prNumber,
      branch,
      authorizedHead,
      authorizedTree,
      authorizationBase,
      executionBase: currentBase,
      executionHead: currentHead,
      executionTree: currentTree,
      authorityClass,
    });
  }

  const approvedChangeComparison = exactForwardComparison(
    observed.authorizationBaseToApprovedSourceComparison,
    authorizationBase,
    authorizedHead,
  );
  if (!approvedChangeComparison.valid) {
    blockers.push(...approvedChangeComparison.blockers.map((blocker) => `approved-change:${blocker}`));
  }
  const approvedComparisonPaths = comparisonPaths(observed.authorizationBaseToApprovedSourceComparison);
  if (!approvedComparisonPaths || !equalLists(approvedComparisonPaths, approvedPaths)) {
    blockers.push('approved-change:path-estate-mismatch');
  }

  let movementPaths = Object.freeze([]);
  if (currentBase === authorizationBase) {
    if (observed.authorizationBaseToCurrentBaseComparison) {
      const noMovement = exactForwardComparison(
        observed.authorizationBaseToCurrentBaseComparison,
        authorizationBase,
        currentBase,
        { allowIdentical: true },
      );
      if (!noMovement.valid) blockers.push(...noMovement.blockers.map((blocker) => `main-movement:${blocker}`));
      const paths = comparisonPaths(observed.authorizationBaseToCurrentBaseComparison);
      if (paths && paths.length) blockers.push('main-movement:unexpected-paths-without-movement');
    }
  } else {
    const movement = exactForwardComparison(
      observed.authorizationBaseToCurrentBaseComparison,
      authorizationBase,
      currentBase,
    );
    if (!movement.valid) blockers.push(...movement.blockers.map((blocker) => `main-movement:${blocker}`));
    const paths = comparisonPaths(observed.authorizationBaseToCurrentBaseComparison);
    if (!paths) blockers.push('main-movement:path-estate-invalid');
    else movementPaths = paths;
  }

  const overlaps = approvedPaths.filter((approvedPath) => movementPaths.includes(approvedPath));
  if (overlaps.length) blockers.push(...overlaps.map((candidate) => `main-movement:approved-path-overlap:${candidate}`));

  let authorizationMode = MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_MODE.EXACT_HEAD;
  if (currentHead === authorizedHead && currentTree === authorizedTree) {
    authorizationMode = MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_MODE.EXACT_HEAD;
  } else {
    authorizationMode = MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_MODE.EVIDENCE_EQUIVALENT_PRESERVATION_CONVERGENCE;
    const convergence = validatePreservationConvergence({
      authorization,
      observed,
      approvedFiles,
      approvedPaths,
      currentBase,
      currentHead,
      currentTree,
    });
    if (!convergence.valid) {
      blockers.push(...convergence.blockers.map((blocker) => `preservation:${blocker}`));
    }
  }

  if (blockers.length) {
    return blocked(blockers, {
      repository,
      prNumber,
      branch,
      authorizedHead,
      authorizedTree,
      executionHead: currentHead,
      executionTree: currentTree,
      authorizationBase,
      executionBase: currentBase,
      authorityClass,
      authorizationMode,
      approvedChangedPaths: approvedPaths,
      interveningMainChangedPaths: movementPaths,
      overlappingPaths: Object.freeze(overlaps),
    });
  }

  const unresolvedThreads = Number(observed.unresolvedReviewThreads);
  const freshEvidenceReady = observed.currentHeadBaseRequiredChecksGreen === true
    && observed.currentHeadBaseIndependentReviewClean === true
    && observed.mergeable === true
    && Number.isSafeInteger(unresolvedThreads)
    && unresolvedThreads === 0;

  return Object.freeze({
    schemaVersion: MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_SCHEMA,
    repository,
    prNumber,
    branch,
    authorizedHead,
    authorizedTree,
    executionHead: currentHead,
    executionTree: currentTree,
    authorityClass,
    authorizationBase,
    executionBase: currentBase,
    authorizationMode,
    approvedChangedFiles: approvedFiles,
    approvedChangedPaths: approvedPaths,
    interveningMainChangedPaths: movementPaths,
    overlappingPaths: Object.freeze([]),
    authorizationReusable: true,
    operatorReapprovalRequired: false,
    freshTechnicalEvidenceRequired: true,
    protectedExecutionReady: freshEvidenceReady,
    reusableAcrossArbitraryHeads: false,
    reusableAcrossCompatibleBases: true,
    reusableOnlyAcrossEvidenceEquivalentConvergence: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    blockers: Object.freeze(freshEvidenceReady ? [] : ['fresh-current-head-base-evidence-required']),
    finalVerdict: freshEvidenceReady
      ? MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.READY_FOR_PROTECTED_EXECUTION
      : MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.REUSABLE_FRESH_EVIDENCE_REQUIRED,
  });
}
