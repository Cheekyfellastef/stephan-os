import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceWorkerCompletionProofV1 } from './sourceWorkerCompletionProofV1.mjs';

const base = {
  success: true,
  missionId: 'goal-1567-r1',
  actionId: 'goal-1567-r1-action',
  repository: 'Cheekyfellastef/stephan-os',
  canonicalPr: 2163,
  canonicalBranch: 'fix/1567-source-artifact-escrow-completion-gate-v1',
  executorIdentity: 'mission-worker:codex',
  worktreePath: 'C:/bounded/worktree',
  changedFiles: ['shared/agents/example.mjs'],
  requiredTests: ['node --test focused.test.mjs'],
  evidenceReceipts: [{ verified: true, testCommand: 'node --test focused.test.mjs' }],
  completedAt: '2026-09-10T16:00:00.000Z',
};

test('fails closed when deterministic tests are not grounded', async () => {
  const result = await buildSourceWorkerCompletionProofV1({
    ...base,
    evidenceReceipts: [{ verified: true, testCommand: 'node --test different.test.mjs' }],
  });
  assert.equal(result.testsPassed, false);
  assert.equal(result.finalVerdict, 'SOURCE_WORKER_TEST_PROOF_REQUIRED');
});

test('fails closed when no canonical escrow writer is supplied', async () => {
  const result = await buildSourceWorkerCompletionProofV1(base);
  assert.equal(result.testsPassed, true);
  assert.equal(result.finalVerdict, 'SOURCE_ARTIFACT_ESCROW_WRITER_REQUIRED');
});

test('returns grounded test truth and externally-readable escrow from the admitted writer', async () => {
  let persisted;
  const escrow = {
    schemaVersion: 'stephanos.source-artifact-escrow.v1',
    artifactRef: 'shared-workspace:source-artifacts/goal-1567-r1',
    externallyReadable: true,
  };
  const result = await buildSourceWorkerCompletionProofV1({
    ...base,
    persistSourceArtifactEscrow: async (input) => {
      persisted = input;
      return escrow;
    },
  });
  assert.equal(result.testsPassed, true);
  assert.equal(result.sourceArtifactEscrow, escrow);
  assert.equal(result.finalVerdict, 'SOURCE_WORKER_COMPLETION_PROOF_READY');
  assert.equal(persisted.missionId, base.missionId);
  assert.equal(persisted.canonicalPr, 2163);
  assert.deepEqual(persisted.requiredTests, base.requiredTests);
});

test('rejects a writer result that is not externally readable', async () => {
  const result = await buildSourceWorkerCompletionProofV1({
    ...base,
    persistSourceArtifactEscrow: async () => ({ artifactRef: 'local-only', externallyReadable: false }),
  });
  assert.equal(result.finalVerdict, 'SOURCE_ARTIFACT_ESCROW_REQUIRED');
  assert.equal(result.sourceArtifactEscrow, null);
});
