export const SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA = 'stephanos.source-worker-completion-proof.v1';

function text(value) { return String(value ?? '').trim(); }
function positiveInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

export async function buildSourceWorkerCompletionProofV1(input = {}) {
  const requiredTests = (Array.isArray(input.requiredTests) ? input.requiredTests : []).map(text).filter(Boolean);
  const evidenceReceipts = Array.isArray(input.evidenceReceipts) ? input.evidenceReceipts : [];
  const groundedCommands = new Set(
    evidenceReceipts
      .filter((receipt) => receipt?.verified === true && text(receipt.testCommand))
      .map((receipt) => text(receipt.testCommand)),
  );
  const testsPassed = requiredTests.length > 0
    && requiredTests.every((command) => groundedCommands.has(command));

  if (input.success !== true || !Array.isArray(input.changedFiles) || input.changedFiles.length === 0) {
    return Object.freeze({
      schemaVersion: SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA,
      testsPassed: false,
      sourceArtifactEscrow: null,
      blocker: 'SOURCE_WORKER_SOURCE_MOVEMENT_REQUIRED',
      finalVerdict: 'SOURCE_WORKER_SOURCE_MOVEMENT_REQUIRED',
    });
  }

  if (!testsPassed) {
    return Object.freeze({
      schemaVersion: SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA,
      testsPassed: false,
      sourceArtifactEscrow: null,
      blocker: 'SOURCE_WORKER_TEST_PROOF_REQUIRED',
      finalVerdict: 'SOURCE_WORKER_TEST_PROOF_REQUIRED',
    });
  }

  const prExplicitNull = input.canonicalPr === null;
  const prNumber = prExplicitNull ? null : positiveInteger(input.canonicalPr);
  const issueNumber = positiveInteger(input.canonicalIssue);
  const identityReady = Boolean(
    text(input.missionId)
    && text(input.actionId)
    && text(input.repository)
    && text(input.canonicalBranch)
    && text(input.exactParentHead)
    && text(input.exactParentTree)
    && text(input.exactResultTree)
    && text(input.executorIdentity)
    && (prNumber || (prExplicitNull && issueNumber)),
  );
  if (!identityReady) {
    return Object.freeze({
      schemaVersion: SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA,
      testsPassed: true,
      sourceArtifactEscrow: null,
      blocker: 'SOURCE_WORKER_IDENTITY_REQUIRED',
      finalVerdict: 'SOURCE_WORKER_IDENTITY_REQUIRED',
    });
  }

  if (typeof input.persistSourceArtifactEscrow !== 'function') {
    return Object.freeze({
      schemaVersion: SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA,
      testsPassed: true,
      sourceArtifactEscrow: null,
      blocker: 'SOURCE_ARTIFACT_ESCROW_WRITER_REQUIRED',
      finalVerdict: 'SOURCE_ARTIFACT_ESCROW_WRITER_REQUIRED',
    });
  }

  const sourceArtifactEscrow = await input.persistSourceArtifactEscrow({
    missionId: text(input.missionId),
    actionId: text(input.actionId),
    repository: text(input.repository),
    canonicalIssue: issueNumber,
    canonicalPr: prNumber,
    canonicalBranch: text(input.canonicalBranch),
    exactParentHead: text(input.exactParentHead).toLowerCase(),
    exactParentTree: text(input.exactParentTree).toLowerCase(),
    exactResultTree: text(input.exactResultTree).toLowerCase(),
    executorIdentity: text(input.executorIdentity),
    worktreePath: text(input.worktreePath),
    changedFiles: input.changedFiles.map((file) => ({ ...file })),
    artifactFiles: (Array.isArray(input.artifactFiles) ? input.artifactFiles : []).map((file) => ({ ...file })),
    requiredTests,
    evidenceReceipts,
    commitMessage: text(input.commitMessage),
    completedAt: text(input.completedAt),
  });

  if (!sourceArtifactEscrow || sourceArtifactEscrow.externallyReadable !== true || !text(sourceArtifactEscrow.artifactRef)) {
    return Object.freeze({
      schemaVersion: SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA,
      testsPassed: true,
      sourceArtifactEscrow: null,
      blocker: 'SOURCE_ARTIFACT_ESCROW_REQUIRED',
      finalVerdict: 'SOURCE_ARTIFACT_ESCROW_REQUIRED',
    });
  }

  return Object.freeze({
    schemaVersion: SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA,
    testsPassed: true,
    sourceArtifactEscrow,
    blocker: '',
    finalVerdict: 'SOURCE_WORKER_COMPLETION_PROOF_READY',
  });
}
