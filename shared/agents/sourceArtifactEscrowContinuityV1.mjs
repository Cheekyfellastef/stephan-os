import {
  SOURCE_PUBLICATION_BLOCKER,
  SOURCE_PUBLICATION_ROUTE,
  buildSourcePublicationContinuityV1,
} from './sourcePublicationContinuityV1.mjs';

export const SOURCE_ARTIFACT_ESCROW_V1_SCHEMA = 'stephanos.source-artifact-escrow.v1';
export const SOURCE_ARTIFACT_PUBLICATION_RECOVERY_V1_SCHEMA = 'stephanos.source-artifact-publication-recovery.v1';

export const SOURCE_ARTIFACT_KIND = Object.freeze({
  EXACT_COMMIT: 'EXACT_COMMIT',
  GIT_BUNDLE: 'GIT_BUNDLE',
  UNIFIED_PATCH: 'UNIFIED_PATCH',
  COMPLETE_FILE_BUNDLE: 'COMPLETE_FILE_BUNDLE',
});

export const SOURCE_ARTIFACT_RECOVERY_STATE = Object.freeze({
  ESCROW_REQUIRED: 'SOURCE_ARTIFACT_ESCROW_REQUIRED',
  ESCROW_PROVEN: 'SOURCE_ARTIFACT_ESCROW_PROVEN',
  PRIMARY_ROUTE_FAILED: 'PRIMARY_PUBLICATION_ROUTE_FAILED',
  FAILOVER_IN_PROGRESS: 'PUBLICATION_FAILOVER_IN_PROGRESS',
  FAILOVER_PROVEN: 'PUBLICATION_FAILOVER_PROVEN',
  UNRECOVERABLE: 'SOURCE_ARTIFACT_UNRECOVERABLE',
  BRANCH_DRIFTED: 'CANONICAL_BRANCH_DRIFTED',
  ALL_ROUTES_UNAVAILABLE: 'ALL_AUTHORISED_PUBLICATION_ROUTES_UNAVAILABLE',
});

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

function text(value) { return String(value ?? '').trim(); }
function rawSha(value) { return typeof value === 'string' && value === value.trim() && SHA.test(value); }
function rawSha256(value) { return typeof value === 'string' && value === value.trim() && SHA256.test(value); }
function list(value) { return Array.isArray(value) ? value : []; }
function integer(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : 0;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
function canonicalPr(value) { return value === null ? null : integer(value); }
function canonicalOwnerMatches(left = {}, right = {}) {
  const leftPr = canonicalPr(left.canonicalPr);
  const rightPr = canonicalPr(right.canonicalPr);
  if (leftPr !== rightPr) return false;
  const leftIssuePresent = left.canonicalIssue !== null && left.canonicalIssue !== undefined;
  const rightIssuePresent = right.canonicalIssue !== null && right.canonicalIssue !== undefined;
  const leftIssue = integer(left.canonicalIssue);
  const rightIssue = integer(right.canonicalIssue);
  if ((leftIssuePresent && leftIssue < 1) || (rightIssuePresent && rightIssue < 1)) return false;
  if (leftPr === null) return leftIssue > 0 && leftIssue === rightIssue;
  if (leftIssuePresent || rightIssuePresent) return leftIssue === rightIssue;
  return true;
}
function isoMilliseconds(value) {
  const candidate = text(value);
  return EXPLICIT_TIMEZONE.test(candidate) ? Date.parse(candidate) : Number.NaN;
}
function safeBranch(value) {
  const branch = text(value);
  return typeof value === 'string' && value === branch && SAFE_BRANCH.test(branch)
    && !['main', 'master'].includes(branch)
    && !branch.startsWith('refs/')
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.includes('..')
    && !branch.includes('//');
}
function normalizedChangedFiles(files) {
  return list(files).map((file) => Object.freeze({
    path: text(file?.path).replace(/\\/g, '/'),
    beforeBlobSha: text(file?.beforeBlobSha).toLowerCase(),
    afterBlobSha: text(file?.afterBlobSha).toLowerCase(),
    sha256: text(file?.sha256).toLowerCase(),
  }));
}

export function validateSourceArtifactEscrowV1(escrow = {}, nowUtc = new Date().toISOString()) {
  const errors = [];
  const nowMs = isoMilliseconds(nowUtc);
  const createdMs = isoMilliseconds(escrow.createdAtUtc);
  const expiresMs = isoMilliseconds(escrow.expiresAtUtc);
  const changedFiles = normalizedChangedFiles(escrow.changedFiles);
  const paths = changedFiles.map((file) => file.path);
  const prNumber = canonicalPr(escrow.canonicalPr);
  const issueNumber = integer(escrow.canonicalIssue);

  if (escrow.schemaVersion !== SOURCE_ARTIFACT_ESCROW_V1_SCHEMA) errors.push('invalid-schema-version');
  if (!Object.values(SOURCE_ARTIFACT_KIND).includes(escrow.artifactKind)) errors.push('invalid-artifact-kind');
  if (escrow.repository !== REPOSITORY) errors.push('invalid-repository');
  if (!(prNumber === null || prNumber > 0)) errors.push('invalid-canonical-pr');
  if (prNumber === null && issueNumber < 1) errors.push('invalid-canonical-issue');
  if (escrow.canonicalIssue !== null && escrow.canonicalIssue !== undefined && issueNumber < 1) errors.push('invalid-canonical-issue');
  if (!safeBranch(escrow.canonicalBranch)) errors.push('invalid-canonical-branch');
  if (!rawSha(escrow.exactParentHead)) errors.push('invalid-parent-head');
  if (!rawSha(escrow.exactParentTree)) errors.push('invalid-parent-tree');
  if (!rawSha(escrow.exactResultTree)) errors.push('invalid-result-tree');
  if (escrow.localCommitSha && !rawSha(escrow.localCommitSha)) errors.push('invalid-local-commit');
  if (!rawSha256(escrow.completeArtifactSha256)) errors.push('invalid-artifact-sha256');
  if (!text(escrow.artifactRef)) errors.push('missing-artifact-ref');
  if (escrow.externallyReadable !== true) errors.push('artifact-not-externally-readable');
  if (!text(escrow.commitMessage)) errors.push('missing-commit-message');
  if (!text(escrow.executorIdentity)) errors.push('missing-executor-identity');
  if (!Number.isFinite(nowMs) || !Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || createdMs > nowMs + 5 * 60 * 1000 || expiresMs <= nowMs || expiresMs <= createdMs) errors.push('invalid-escrow-time-window');
  if (!changedFiles.length || new Set(paths).size !== paths.length) errors.push('invalid-changed-files');
  for (let index = 0; index < changedFiles.length; index += 1) {
    const file = changedFiles[index];
    const rawFile = escrow.changedFiles[index];
    if (typeof rawFile?.path !== 'string' || rawFile.path !== file.path
      || !SAFE_PATH.test(file.path)
      || file.path.split('/').some((component) => component === '.' || component !== component.trim())) {
      errors.push(`unsafe-path:${file.path || 'missing'}`);
    }
    if (!rawSha(rawFile?.beforeBlobSha) || !rawSha(rawFile?.afterBlobSha)) errors.push(`invalid-blob-identity:${file.path || 'missing'}`);
    if (!rawSha256(rawFile?.sha256)) errors.push(`invalid-file-sha256:${file.path || 'missing'}`);
  }
  // Test evidence is an exact raw manifest: never discard empty entries or
  // convert non-string, padded authority values into passing proof.
  const testsRun = list(escrow.testsRun);
  const testVerdicts = list(escrow.testVerdicts);
  if (!Array.isArray(escrow.testsRun) || !Array.isArray(escrow.testVerdicts)
    || !testsRun.length || testsRun.length !== testVerdicts.length
    || testsRun.some((command) => typeof command !== 'string'
      || !command.trim() || command !== command.trim())
    || testVerdicts.some((verdict) => typeof verdict !== 'string'
      || verdict !== verdict.trim() || verdict.toUpperCase() !== 'PASS')) {
    errors.push('tests-not-proven');
  }
  if (typeof escrow.diffCheckVerdict !== 'string'
    || escrow.diffCheckVerdict !== escrow.diffCheckVerdict.trim()
    || escrow.diffCheckVerdict.toUpperCase() !== 'PASS') errors.push('diff-check-not-proven');

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    changedFiles: Object.freeze(changedFiles),
    finalVerdict: errors.length ? SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE : SOURCE_ARTIFACT_RECOVERY_STATE.ESCROW_PROVEN,
  });
}

function baseProjection(escrow = {}) {
  return {
    schemaVersion: SOURCE_ARTIFACT_PUBLICATION_RECOVERY_V1_SCHEMA,
    repository: REPOSITORY,
    canonicalIssue: integer(escrow.canonicalIssue) || null,
    canonicalPr: canonicalPr(escrow.canonicalPr),
    canonicalBranch: text(escrow.canonicalBranch),
    exactParentHead: text(escrow.exactParentHead).toLowerCase(),
    exactParentTree: text(escrow.exactParentTree).toLowerCase(),
    exactResultTree: text(escrow.exactResultTree).toLowerCase(),
    localCommitSha: text(escrow.localCommitSha).toLowerCase(),
    preserveEscrow: true,
    rebuildRequired: false,
    duplicateBranchAllowed: false,
    duplicatePullRequestAllowed: false,
    forceAllowed: false,
    fastForwardOnly: true,
    mergeAllowed: false,
    runtimeMutationAllowed: false,
    selectedRoute: SOURCE_PUBLICATION_ROUTE.NONE,
  };
}

function publicationEvidenceMatches(escrow, evidence = {}) {
  return evidence.proven === true
    && evidence.repository === REPOSITORY
    && canonicalOwnerMatches(evidence, escrow)
    && typeof evidence.canonicalBranch === 'string' && evidence.canonicalBranch === escrow.canonicalBranch
    && rawSha(evidence.previousHead)
    && text(evidence.previousHead).toLowerCase() === text(escrow.exactParentHead).toLowerCase()
    && rawSha(evidence.newHead)
    && rawSha(evidence.newTree)
    && text(evidence.newTree).toLowerCase() === text(escrow.exactResultTree).toLowerCase()
    && evidence.fastForward === true
    && Object.values(SOURCE_PUBLICATION_ROUTE).includes(evidence.route)
    && evidence.route !== SOURCE_PUBLICATION_ROUTE.NONE;
}

export function buildSourceArtifactPublicationRecoveryV1(input = {}) {
  const escrow = input.escrow || {};
  const base = baseProjection(escrow);
  const validation = validateSourceArtifactEscrowV1(escrow, input.nowUtc);
  if (!validation.valid) {
    const escrowMissing = validation.errors.some((error) => ['missing-artifact-ref', 'artifact-not-externally-readable'].includes(error));
    const finalVerdict = escrowMissing ? SOURCE_ARTIFACT_RECOVERY_STATE.ESCROW_REQUIRED : SOURCE_ARTIFACT_RECOVERY_STATE.UNRECOVERABLE;
    return Object.freeze({ ...base, escrowValid: false, escrowErrors: validation.errors, blocker: finalVerdict, exactNextAction: escrowMissing ? 'Create and independently prove an integrity-pinned provider-neutral artifact outside the disposable executor workspace before any publication attempt.' : 'Fail closed and retain evidence; the escrow contract is incomplete or corrupt and cannot be published safely.', finalVerdict });
  }

  const remote = input.canonicalRemote || {};
  if (remote.repository !== REPOSITORY
      || !canonicalOwnerMatches(remote, escrow)
      || typeof remote.canonicalBranch !== 'string' || remote.canonicalBranch !== escrow.canonicalBranch
      || !rawSha(remote.head) || text(remote.head).toLowerCase() !== text(escrow.exactParentHead).toLowerCase()) {
    return Object.freeze({ ...base, escrowValid: true, blocker: SOURCE_ARTIFACT_RECOVERY_STATE.BRANCH_DRIFTED, exactNextAction: 'Stop publication. Re-read the canonical branch and require a separately governed recovery plan; do not rebase, reset, force-update or rebuild the verified source artifact.', finalVerdict: SOURCE_ARTIFACT_RECOVERY_STATE.BRANCH_DRIFTED });
  }

  if (publicationEvidenceMatches(escrow, input.publicationEvidence)) {
    return Object.freeze({ ...base, escrowValid: true, selectedRoute: input.publicationEvidence.route, publishedHead: text(input.publicationEvidence.newHead).toLowerCase(), blocker: '', retireEscrowAllowed: true, exactNextAction: 'Continue ordinary exact-head CI, review and approval gates on the existing canonical PR; retire escrow only after canonical publication remains proven.', finalVerdict: SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_PROVEN });
  }

  const failedRoutes = list(input.failedRoutes).map(text);
  const continuity = buildSourcePublicationContinuityV1({
    workspace: input.workspace,
    artifact: {
      exactBase: text(escrow.exactParentHead).toLowerCase(),
      exactTree: text(escrow.exactResultTree).toLowerCase(),
      exactCommit: text(escrow.localCommitSha).toLowerCase(),
      branch: text(escrow.canonicalBranch),
    },
    nowUtc: input.nowUtc,
    capabilities: input.capabilities,
    failedRoutes,
    // canonicalRemote has already proved this PR branch exists at its parent.
    existingBranch: true,
  });

  if (continuity.routeReady) {
    return Object.freeze({
      ...base,
      escrowValid: true,
      selectedRoute: continuity.selectedRoute,
      failedRoutes: Object.freeze(failedRoutes),
      capabilityReceipt: continuity.capabilityReceipt,
      blocker: '',
      exactNextAction: `Publish the preserved escrow bytes through ${continuity.selectedRoute}; create an evidence-equivalent commit if needed, then fast-forward only the existing canonical branch from the exact parent and verify the resulting tree before moving on.`,
      finalVerdict: failedRoutes.length ? SOURCE_ARTIFACT_RECOVERY_STATE.FAILOVER_IN_PROGRESS : SOURCE_ARTIFACT_RECOVERY_STATE.ESCROW_PROVEN,
    });
  }

  if (continuity.blocker === SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE) {
    return Object.freeze({ ...base, escrowValid: true, failedRoutes: Object.freeze(failedRoutes), blocker: SOURCE_ARTIFACT_RECOVERY_STATE.ALL_ROUTES_UNAVAILABLE, exactNextAction: 'Keep the escrow durable and publish terminal route evidence; do not rebuild, create a duplicate branch/PR, or ask the original executor to recreate the source change.', finalVerdict: SOURCE_ARTIFACT_RECOVERY_STATE.ALL_ROUTES_UNAVAILABLE });
  }

  return Object.freeze({ ...base, escrowValid: true, failedRoutes: Object.freeze(failedRoutes), blocker: continuity.blocker, unresolvedRoutes: continuity.unresolvedRoutes, exactNextAction: continuity.exactNextAction, finalVerdict: continuity.finalVerdict });
}
