import { validateSourceArtifactEscrowV1 } from './sourceArtifactEscrowContinuityV1.mjs';

export const SOURCE_ARTIFACT_ESCROW_COMPLETION_GATE_V1_SCHEMA = 'stephanos.source-artifact-escrow-completion-gate.v1';

const SOURCE_MOVEMENT_STAGES = new Set(['SOURCE_CHANGED', 'TESTED']);

function text(value) { return String(value ?? '').trim(); }

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

  const escrow = validateSourceArtifactEscrowV1(input.escrow || {}, input.nowUtc);
  if (!escrow.valid) {
    return Object.freeze({
      ...base,
      escrowErrors: escrow.errors,
      blocker: 'SOURCE_ARTIFACT_ESCROW_REQUIRED',
      exactNextAction: 'Persist and independently prove an integrity-pinned source artifact outside the disposable executor workspace before publication, terminal receipt, review handoff, or executor termination.',
      finalVerdict: 'SOURCE_ARTIFACT_ESCROW_REQUIRED',
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
