import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatchEscrowBundle } from './codexPatchEscrow.mjs';
import {
  buildPreparedPatchEscrow,
  PREPARED_PATCH_ESCROW_SCHEMA_VERSION,
} from '../../scripts/codex-patch-escrow-prepare.mjs';
import {
  inspectGithubCredentialProcessAncestry,
  validatePreparedPatchEscrow,
} from '../../scripts/codex-patch-escrow-validate-prepared.mjs';
import {
  createValidatedPatchEscrowArtifact,
  validateValidatedPatchEscrowArtifact,
} from '../../scripts/codex-patch-escrow-validated-artifact.mjs';

const BASE_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);

function fixture() {
  const patch = Buffer.from('diff --git a/shared/agents/a.mjs b/shared/agents/a.mjs\n', 'utf8');
  const bundle = createPatchEscrowBundle({
    issueNumber: 1503,
    baseSha: BASE_SHA,
    patch,
    changedFiles: ['shared/agents/a.mjs'],
    testProfile: 'node-changed',
    commitMessage: 'Repair issue #1503',
    prTitle: 'Repair issue #1503',
  });
  const prepared = buildPreparedPatchEscrow({
    publishEvent: {
      repository: 'Cheekyfellastef/stephan-os',
      ownerLogin: 'Cheekyfellastef',
      issueNumber: 1503,
      commentId: 42,
      patchSha256: bundle.manifest.patchSha256,
    },
    selected: {
      ok: true,
      manifest: bundle.manifest,
      patch,
      manifestCommentId: 1,
      chunkCommentIds: [2],
    },
    repositoryMetadata: { default_branch: 'main' },
    currentBase: { sha: BASE_SHA },
  });
  const preparedBytes = Buffer.from(`${JSON.stringify(prepared, null, 2)}\n`, 'utf8');
  const validationResult = {
    finalVerdict: 'PATCH_ESCROW_TOKEN_FREE_VALIDATION_PASS',
    bundleId: prepared.bundleId,
    patchSha256: prepared.patchSha256,
    expectedTreeSha: TREE_SHA,
    ancestry: { safe: true, blockers: [], inspectedPids: [200, 1] },
    testEvidence: { profile: 'node-changed', commands: ['node --check shared/agents/a.mjs'] },
  };
  return { bundle, patch, prepared, preparedBytes, validationResult };
}

test('prepared patch escrow revalidates the exact manifest and patch without GitHub credentials', () => {
  const { prepared } = fixture();
  assert.equal(prepared.schemaVersion, PREPARED_PATCH_ESCROW_SCHEMA_VERSION);
  assert.equal(prepared.publishCommentId, 42);
  assert.equal(prepared.authorizedPatchSha256, prepared.patchSha256);
  const validation = validatePreparedPatchEscrow(prepared);
  assert.equal(validation.valid, true);
  assert.equal(validation.finalVerdict, 'PATCH_ESCROW_PREPARED_PASS');
});

test('prepared artifact construction rejects a publish request authorising another full patch hash', () => {
  const { bundle, patch } = fixture();
  assert.throws(() => buildPreparedPatchEscrow({
    publishEvent: {
      repository: 'Cheekyfellastef/stephan-os',
      ownerLogin: 'Cheekyfellastef',
      issueNumber: 1503,
      commentId: 42,
      patchSha256: '0'.repeat(64),
    },
    selected: { ok: true, manifest: bundle.manifest, patch, manifestCommentId: 1, chunkCommentIds: [2] },
    repositoryMetadata: { default_branch: 'main' },
    currentBase: { sha: BASE_SHA },
  }), /does not match owner publication authorization/);
});

test('prepared patch escrow fails closed when artifact patch bytes are replaced', () => {
  const { prepared } = fixture();
  const corrupted = {
    ...prepared,
    patchBase64: Buffer.from('different patch', 'utf8').toString('base64'),
  };
  const validation = validatePreparedPatchEscrow(corrupted);
  assert.equal(validation.valid, false);
  assert.equal(validation.blockers.includes('prepared-patch-hash-mismatch'), true);
});

test('prepared patch escrow fails closed when advertised bundle identity changes', () => {
  const { prepared } = fixture();
  const validation = validatePreparedPatchEscrow({
    ...prepared,
    bundleId: 'patch-issue-1503-000000000000',
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.blockers.includes('prepared-bundle-id-mismatch'), true);
});

test('validated artifact binds exact prepared bytes, full patch hash, expected tree, and evidence', () => {
  const { preparedBytes, validationResult } = fixture();
  const artifact = createValidatedPatchEscrowArtifact({ preparedBytes, validationResult });
  const validation = validateValidatedPatchEscrowArtifact(artifact);
  assert.equal(validation.valid, true);
  assert.equal(validation.finalVerdict, 'PATCH_ESCROW_VALIDATED_ARTIFACT_PASS');
  assert.equal(artifact.authorizedPatchSha256, artifact.patchSha256);
  assert.equal(artifact.expectedTreeSha, TREE_SHA);
  assert.match(artifact.preparedArtifactSha256, /^[a-f0-9]{64}$/);
  assert.match(artifact.artifactSha256, /^[a-f0-9]{64}$/);
});

test('validated artifact fails closed when any embedded prepared byte is replaced', () => {
  const { preparedBytes, validationResult } = fixture();
  const artifact = createValidatedPatchEscrowArtifact({ preparedBytes, validationResult });
  const changedPrepared = Buffer.from(preparedBytes);
  changedPrepared[0] = changedPrepared[0] === 0x7b ? 0x5b : 0x7b;
  const validation = validateValidatedPatchEscrowArtifact({
    ...artifact,
    preparedArtifactBase64: changedPrepared.toString('base64'),
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.blockers.includes('prepared-artifact-digest-mismatch'), true);
});

test('validated artifact fails closed when expected tree or validation evidence is altered', () => {
  const { preparedBytes, validationResult } = fixture();
  const artifact = createValidatedPatchEscrowArtifact({ preparedBytes, validationResult });
  const treeValidation = validateValidatedPatchEscrowArtifact({ ...artifact, expectedTreeSha: 'c'.repeat(40) });
  assert.equal(treeValidation.valid, false);
  assert.equal(treeValidation.blockers.includes('validated-artifact-digest-mismatch'), true);

  const evidenceValidation = validateValidatedPatchEscrowArtifact({
    ...artifact,
    validationEvidence: { ...artifact.validationEvidence, testEvidence: { profile: 'other' } },
  });
  assert.equal(evidenceValidation.valid, false);
  assert.equal(evidenceValidation.blockers.includes('validation-evidence-digest-mismatch'), true);
});

test('process ancestry guard detects a GitHub token held by a parent process', () => {
  const files = new Map([
    ['/proc/200/environ', 'PATH=/usr/bin\0'],
    ['/proc/200/status', 'Name:\tnode\nPPid:\t100\n'],
    ['/proc/100/environ', 'GITHUB_TOKEN=repository-token\0PATH=/usr/bin\0'],
    ['/proc/100/status', 'Name:\tbash\nPPid:\t1\n'],
    ['/proc/1/environ', 'PATH=/usr/bin\0'],
    ['/proc/1/status', 'Name:\tinit\nPPid:\t0\n'],
  ]);
  const result = inspectGithubCredentialProcessAncestry({
    platform: 'linux',
    startPid: 200,
    readProcFile: (path) => {
      if (!files.has(path)) throw new Error(`missing fixture ${path}`);
      return files.get(path);
    },
  });
  assert.equal(result.safe, false);
  assert.equal(result.blockers.includes('github-credential-in-process-ancestry:100:GITHUB_TOKEN'), true);
});

test('process ancestry guard accepts a clean chain and ignores empty credential variables', () => {
  const files = new Map([
    ['/proc/200/environ', 'GITHUB_TOKEN=\0PATH=/usr/bin\0'],
    ['/proc/200/status', 'Name:\tnode\nPPid:\t1\n'],
    ['/proc/1/environ', 'PATH=/usr/bin\0'],
    ['/proc/1/status', 'Name:\tinit\nPPid:\t0\n'],
  ]);
  const result = inspectGithubCredentialProcessAncestry({
    platform: 'linux',
    startPid: 200,
    readProcFile: (path) => files.get(path),
  });
  assert.equal(result.safe, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.inspectedPids, [200, 1]);
});
