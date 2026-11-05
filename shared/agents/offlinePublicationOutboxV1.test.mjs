import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFLINE_PUBLICATION_OUTBOX_STATE,
  OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA,
  buildOfflinePublicationOutboxRecordV1,
} from './offlinePublicationOutboxV1.mjs';
import {
  SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
  SOURCE_ARTIFACT_KIND,
} from './sourceArtifactEscrowContinuityV1.mjs';

const NOW = '2026-09-28T15:00:00.000Z';

function escrow(overrides = {}) {
  return {
    schemaVersion: SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
    artifactKind: SOURCE_ARTIFACT_KIND.COMPLETE_FILE_BUNDLE,
    missionId: 'critical-2488-offline-test',
    actionId: 'agent-critical-2488-source-1',
    repository: 'Cheekyfellastef/stephan-os',
    canonicalIssue: 2488,
    canonicalPr: null,
    canonicalBranch: 'agent/offline-build-test',
    exactParentHead: 'a'.repeat(40),
    exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    localCommitSha: '',
    completeArtifactSha256: 'd'.repeat(64),
    artifactRef: 'shared-workspace://source-artifacts/' + 'd'.repeat(64) + '.json',
    externallyReadable: true,
    commitMessage: 'Offline build test',
    executorIdentity: 'mission-worker:critical-2488-offline-test',
    createdAtUtc: NOW,
    expiresAtUtc: '2026-10-28T15:00:00.000Z',
    changedFiles: [{
      path: 'shared/agents/offline-test.mjs',
      beforeBlobSha: '1'.repeat(40),
      afterBlobSha: '2'.repeat(40),
      sha256: '3'.repeat(64),
    }],
    testsRun: ['node --test focused.test.mjs'],
    testVerdicts: ['PASS'],
    diffCheckVerdict: 'PASS',
    ...overrides,
  };
}

test('queues verified source without granting publication authority', () => {
  const built = buildOfflinePublicationOutboxRecordV1(escrow(), { nowUtc: NOW });
  assert.equal(built.ok, true);
  assert.equal(built.record.schemaVersion, OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA);
  assert.equal(built.record.state, OFFLINE_PUBLICATION_OUTBOX_STATE);
  assert.equal(built.record.publicationPaused, true);
  assert.equal(built.record.preserveVerifiedArtifact, true);
  assert.equal(built.record.rebuildRequired, false);
  assert.equal(built.record.duplicatePullRequestAllowed, false);
  assert.equal(built.record.pushAuthority, false);
  assert.equal(built.record.mergeAuthority, false);
  assert.equal(built.record.deploymentAuthority, false);
});

test('rejects unproven or expired source escrow', () => {
  const badProof = buildOfflinePublicationOutboxRecordV1(
    escrow({ testVerdicts: ['FAIL'] }),
    { nowUtc: NOW },
  );
  assert.equal(badProof.ok, false);
  const expired = buildOfflinePublicationOutboxRecordV1(
    escrow({ expiresAtUtc: '2026-09-28T14:59:59.000Z' }),
    { nowUtc: NOW },
  );
  assert.equal(expired.ok, false);
});
