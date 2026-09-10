import test from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE_ARTIFACT_ESCROW_V1_SCHEMA, SOURCE_ARTIFACT_KIND } from './sourceArtifactEscrowContinuityV1.mjs';
import { gateSourceWorkerCompletionV1 } from './sourceArtifactEscrowCompletionGateV1.mjs';

const NOW = '2026-09-10T04:54:28Z';

function validEscrow(overrides = {}) {
  return {
    schemaVersion: SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
    artifactKind: SOURCE_ARTIFACT_KIND.COMPLETE_FILE_BUNDLE,
    repository: 'Cheekyfellastef/stephan-os',
    canonicalPr: 2162,
    canonicalBranch: 'fix/lifeboat-stale-active-recovery-v1',
    exactParentHead: 'a'.repeat(40),
    exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    localCommitSha: 'd'.repeat(40),
    completeArtifactSha256: 'e'.repeat(64),
    artifactRef: 'shared-workspace://source-artifacts/2162/example',
    externallyReadable: true,
    commitMessage: 'Recover stale active Battle Bridge Lifeboat through inactive bank',
    executorIdentity: 'mission-worker:2162',
    createdAtUtc: '2026-09-10T04:50:00Z',
    expiresAtUtc: '2026-09-11T04:50:00Z',
    changedFiles: [{ path: 'shared/agents/example.mjs', beforeBlobSha: '1'.repeat(40), afterBlobSha: '2'.repeat(40), sha256: '3'.repeat(64) }],
    testsRun: ['node --test shared/agents/example.test.mjs'],
    testVerdicts: ['PASS'],
    diffCheckVerdict: 'PASS',
    ...overrides,
  };
}

test('tested source worker is blocked from terminal receipt, handoff, and termination without external escrow', () => {
  const result = gateSourceWorkerCompletionV1({
    stage: 'TESTED', sourceChanged: true, testsPassed: true, terminalRequested: true, nowUtc: NOW,
  });
  assert.equal(result.finalVerdict, 'SOURCE_ARTIFACT_ESCROW_REQUIRED');
  assert.equal(result.terminalReceiptAllowed, false);
  assert.equal(result.reviewHandoffAllowed, false);
  assert.equal(result.executorMayTerminate, false);
  assert.equal(result.rebuildRequired, false);
});

test('local-only artifact does not satisfy completion gate', () => {
  const result = gateSourceWorkerCompletionV1({
    stage: 'TESTED', sourceChanged: true, testsPassed: true, reviewHandoffRequested: true, nowUtc: NOW,
    escrow: validEscrow({ externallyReadable: false }),
  });
  assert.equal(result.finalVerdict, 'SOURCE_ARTIFACT_ESCROW_REQUIRED');
  assert.ok(result.escrowErrors.includes('artifact-not-externally-readable'));
  assert.equal(result.executorMayTerminate, false);
});

test('independently readable integrity-pinned escrow admits publication continuation without widening authority', () => {
  const result = gateSourceWorkerCompletionV1({
    stage: 'TESTED', sourceChanged: true, testsPassed: true, reviewHandoffRequested: true, nowUtc: NOW,
    escrow: validEscrow(),
  });
  assert.equal(result.finalVerdict, 'SOURCE_ARTIFACT_ESCROW_PROVEN_FOR_COMPLETION');
  assert.equal(result.terminalReceiptAllowed, true);
  assert.equal(result.reviewHandoffAllowed, true);
  assert.equal(result.executorMayTerminate, true);
  assert.equal(result.preserveCanonicalMission, true);
  assert.equal(result.duplicateBranchAllowed, false);
  assert.equal(result.duplicatePullRequestAllowed, false);
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.runtimeMutationAllowed, false);
});

test('no terminal completion is manufactured before source and test movement', () => {
  const result = gateSourceWorkerCompletionV1({ stage: 'CLAIMED', terminalRequested: true, nowUtc: NOW, escrow: validEscrow() });
  assert.equal(result.finalVerdict, 'SOURCE_WORKER_COMPLETION_NOT_READY');
  assert.equal(result.terminalReceiptAllowed, false);
  assert.equal(result.executorMayTerminate, false);
});
