export const SOURCE_WORKER_COMPLETION_PROOF_V1_SCHEMA = 'stephanos.source-worker-completion-proof.v1';

function text(value) { return String(value ?? '').trim(); }

export async function buildSourceWorkerCompletionProofV1(input = {}) {
  const requiredTests = (Array.isArray(input.requiredTests) ? input.requiredTests : []).map(text).filter(Boolean);
  const evidenceReceipts = Array.isArray(input.evidenceReceipts) ? input.evidenceReceipts : [];
  const groundedCommands = new Set(
    evidenceReceipts
      .filter((receipt) => receipt?.verified === true)
      .map((receipt) => text(receipt.testCommand || receipt.command || receipt.requirement))
      .filter(Boolean),
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
    canonicalPr: Number(input.canonicalPr) || 0,
    canonicalBranch: text(input.canonicalBranch),
    executorIdentity: text(input.executorIdentity),
    worktreePath: text(input.worktreePath),
    changedFiles: [...input.changedFiles],
    requiredTests,
    evidenceReceipts,
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
