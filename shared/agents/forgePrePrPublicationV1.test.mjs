import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { buildOfflinePublicationOutboxRecordV1 } from './offlinePublicationOutboxV1.mjs';
import { verifyForgePrePrPublicationEvidence } from './forgePrePrPublicationV1.mjs';

const NOW = '2026-10-08T07:30:00.000Z';
const sha = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');

function fixture() {
  const content = Buffer.from('export const proof = true;\n');
  const afterBlobSha = sha(Buffer.concat([Buffer.from('blob ' + content.length + '\0'), content]), 'sha1');
  const changed = {
    path: 'shared/agents/forgeProof.mjs',
    beforeBlobSha: '0'.repeat(40),
    afterBlobSha,
    sha256: sha(content),
  };
  const identity = {
    repository: 'Cheekyfellastef/stephan-os',
    missionId: 'critical-2732-elastic-goal',
    actionId: 'critical-2732-elastic-goal-r1-safe',
    canonicalIssue: 2732,
    canonicalPr: null,
    canonicalBranch: 'openclaw/elastic-goal-2732',
    exactParentHead: 'a'.repeat(40),
    exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    executorIdentity: 'mission-worker:foundry-forge:verified',
  };
  const bundle = {
    schemaVersion: 'stephanos.source-artifact-complete-file-bundle.v1',
    ...identity,
    commitMessage: 'Build proof',
    completedAtUtc: NOW,
    changedFiles: [{ ...changed, mode: '100644', deleted: false, contentBase64: content.toString('base64') }],
    testsRun: ['node --test shared/agents/forgeProof.test.mjs'],
    testVerdicts: ['PASS'],
    diffCheckVerdict: 'PASS',
  };
  const bundleBytes = Buffer.from(JSON.stringify(bundle, null, 2) + '\n');
  const escrow = {
    schemaVersion: 'stephanos.source-artifact-escrow.v1',
    artifactKind: 'COMPLETE_FILE_BUNDLE',
    ...identity,
    localCommitSha: '',
    completeArtifactSha256: sha(bundleBytes),
    artifactRef: 'shared-workspace://source-artifacts/' + sha(bundleBytes) + '.json',
    externallyReadable: true,
    commitMessage: 'Build proof',
    createdAtUtc: NOW,
    expiresAtUtc: '2026-10-09T07:30:00.000Z',
    changedFiles: [changed],
    testsRun: bundle.testsRun,
    testVerdicts: ['PASS'],
    diffCheckVerdict: 'PASS',
  };
  const outbox = buildOfflinePublicationOutboxRecordV1(escrow, { nowUtc: NOW }).record;
  const canonicalRemote = {
    repository: identity.repository, branch: identity.canonicalBranch, branchExists: false,
    mainHead: identity.exactParentHead, mainTree: identity.exactParentTree,
  };
  return { escrow, outbox, bundleBytes, canonicalRemote, nowUtc: NOW };
}

test('verifies exact artifact bytes and parent without granting push or merge authority', () => {
  const proof = verifyForgePrePrPublicationEvidence(fixture());
  assert.equal(proof.ok, true, JSON.stringify(proof.blockers));
  assert.equal(proof.finalVerdict, 'FORGE_PRE_PR_EXACT_ARTIFACT_VERIFIED_AWAITING_AUTHORITY');
  assert.equal(proof.publishAllowed, false);
  assert.equal(proof.mergeAuthority, false);
  assert.equal(proof.forcePushAllowed, false);
  assert.equal(proof.entries.length, 1);
});

test('rejects mutated bundle bytes, even when files seem unchanged', () => {
  const input = fixture();
  input.bundleBytes = Buffer.concat([input.bundleBytes, Buffer.from(' ')]);
  const proof = verifyForgePrePrPublicationEvidence(input);
  assert.equal(proof.ok, false);
  assert.ok(proof.blockers.includes('BUNDLE_RAW_SHA256_MISMATCH'));
});

test('rejects changed GitHub parent or existing branch', () => {
  const input = fixture();
  input.canonicalRemote.mainHead = 'd'.repeat(40);
  input.canonicalRemote.branchExists = true;
  const proof = verifyForgePrePrPublicationEvidence(input);
  assert.equal(proof.ok, false);
  assert.ok(proof.blockers.includes('REMOTE_BRANCH_OR_PARENT_DRIFT_UNPROVEN'));
});

test('outbox cannot supply publication authority on its own', () => {
  const input = fixture();
  input.outbox = { ...input.outbox, pushAuthority: true, publicationPaused: false };
  const proof = verifyForgePrePrPublicationEvidence(input);
  assert.equal(proof.ok, false);
  assert.ok(proof.blockers.includes('OUTBOX_AUTHORITY_BOUNDARY_INVALID'));
});

test('rejects expired source escrow', () => {
  const input = fixture();
  input.nowUtc = '2026-10-10T07:30:00.000Z';
  const proof = verifyForgePrePrPublicationEvidence(input);
  assert.equal(proof.ok, false);
  assert.ok(proof.blockers.some((x) => x.includes('invalid-escrow-time-window')));
});
