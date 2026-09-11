import { validateSourceArtifactEscrowV1 } from './sourceArtifactEscrowContinuityV1.mjs';

export const SOURCE_ARTIFACT_ESCROW_COMPLETION_GATE_V1_SCHEMA = 'stephanos.source-artifact-escrow-completion-gate.v1';

const SOURCE_MOVEMENT_STAGES = new Set(['SOURCE_CHANGED', 'TESTED']);

function text(value) { return String(value ?? '').trim(); }
function lower(value) { return text(value).toLowerCase(); }

function changedFileIdentity(files = []) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      path: text(file?.path),
      beforeBlobSha: lower(file?.beforeBlobSha),
      afterBlobSha: lower(file?.afterBlobSha),
      sha256: lower(file?.sha256),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function escrowIdentityErrors(escrow = {}, expected = {}) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return [];
  const errors = [];
  const equalText = (field, normalizer = text) => {
    const wanted = normalizer(expected[field]);
    if (wanted && normalizer(escrow[field]) !== wanted) errors.push(`identity-${field}-mismatch`);
  };
  equalText('repository');
  if (Number.isInteger(expected.canonicalPr) && Number(escrow.canonicalPr) !== expected.canonicalPr) errors.push('identity-canonicalPr-mismatch');
  equalText('canonicalBranch');
  equalText('exactParentHead', lower);
  equalText('exactParentTree', lower);
  equalText('exactResultTree', lower);
  equalText('executorIdentity');

  const expectedFiles = changedFileIdentity(expected.changedFiles);
  if (expectedFiles.length > 0) {
    const actualFiles = changedFileIdentity(escrow.changedFiles);
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) errors.push('identity-changedFiles-mismatch');
  }
  return errors;
}

export function gateSourceWorkerCompletionV1(input = {}) {
  const stage = text(input.stage).toUpperCase();
  const sourceChanged = input.sourceChanged === true || SOURCE_MOVEMENT_STAGES.has(stage);
  const testsPassed = input.testsPassed === true;
  const terminalRequested = input.terminalRequested === true || input.reviewHandoffRequested === true;

  const base = {
    schemaVersion: SOURCE_ARTIFACT_ESCROW_COMPLETION_GATE_V1_SCHEMA,
    sourceChanged,
    testsPassed,
    terminalRequested,
    terminalReceiptAllowed: false,
    reviewHandoffAllowed: false,
    executorMayTerminate: false,
    preserveCanonicalMission: true,
    rebuildRequired: false,
    duplicateBranchAllowed: false,
    duplicatePullRequestAllowed: false,
    mergeAllowed: false,
    runtimeMutationAllowed: false,
  };

  if (!sourceChanged || !testsPassed || !terminalRequested) {
    return Object.freeze({
      ...base,
      blocker: 'SOURCE_WORKER_COMPLETION_NOT_READY',
      exactNextAction: 'Continue the existing mission until non-empty source movement, deterministic passing tests, and terminal or review-handoff intent are all present.',
      finalVerdict: 'SOURCE_WORKER_COMPLETION_NOT_READY',
    });
  }

  const escrow = input.escrow || {};
  const validation = validateSourceArtifactEscrowV1(escrow, input.nowUtc);
  if (!validation.valid) {
    return Object.freeze({
      ...base,
      escrowErrors: validation.errors,
      blocker: 'SOURCE_ARTIFACT_ESCROW_REQUIRED',
      exactNextAction: 'Persist and independently prove an integrity-pinned source artifact outside the disposable executor workspace before publication, terminal receipt, review handoff, or executor termination.',
      finalVerdict: 'SOURCE_ARTIFACT_ESCROW_REQUIRED',
    });
  }

  const identityErrors = escrowIdentityErrors(escrow, input.expectedIdentity);
  if (identityErrors.length > 0) {
    return Object.freeze({
      ...base,
      escrowErrors: identityErrors,
      blocker: 'SOURCE_ARTIFACT_ESCROW_IDENTITY_MISMATCH',
      exactNextAction: 'Preserve the same mission and produce externally readable escrow whose repository, PR, branch, source trees, executor identity, and changed-file digests exactly match the claimed execution.',
      finalVerdict: 'SOURCE_ARTIFACT_ESCROW_IDENTITY_MISMATCH',
    });
  }

  return Object.freeze({
    ...base,
    escrowProven: true,
    terminalReceiptAllowed: true,
    reviewHandoffAllowed: true,
    executorMayTerminate: true,
    blocker: '',
    exactNextAction: 'Attempt publication of the preserved escrow through the existing Source Publication Continuity route, retaining the same mission, branch, PR, writer and authority envelope.',
    finalVerdict: 'SOURCE_ARTIFACT_ESCROW_PROVEN_FOR_COMPLETION',
  });
}
