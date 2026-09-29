import { createHash } from 'node:crypto';
import { validatePreparedPatchEscrow } from './codex-patch-escrow-validate-prepared.mjs';

export const VALIDATED_PATCH_ESCROW_SCHEMA_VERSION = 'stephanos.codex.patch-escrow-validated.v1';
export const VALIDATED_PATCH_ESCROW_KIND = 'PATCH_ESCROW_VALIDATED_ARTIFACT_V1';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBase64(value) {
  const encoded = text(value);
  if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, 'base64');
  return decoded.toString('base64') === encoded ? decoded : null;
}

function evidenceDigest(evidence) {
  return sha256(Buffer.from(JSON.stringify(evidence), 'utf8'));
}

function attestationCore(input) {
  return {
    schemaVersion: VALIDATED_PATCH_ESCROW_SCHEMA_VERSION,
    kind: VALIDATED_PATCH_ESCROW_KIND,
    preparedArtifactBase64: input.preparedArtifactBase64,
    preparedArtifactSha256: input.preparedArtifactSha256,
    repository: input.repository,
    ownerLogin: input.ownerLogin,
    issueNumber: input.issueNumber,
    publishCommentId: input.publishCommentId,
    manifestCommentId: input.manifestCommentId,
    chunkCommentIds: input.chunkCommentIds,
    bundleId: input.bundleId,
    authorizedPatchSha256: input.authorizedPatchSha256,
    patchSha256: input.patchSha256,
    baseSha: input.baseSha,
    targetBranch: input.targetBranch,
    expectedTreeSha: input.expectedTreeSha,
    validationVerdict: input.validationVerdict,
    validationEvidence: input.validationEvidence,
    validationEvidenceSha256: input.validationEvidenceSha256,
  };
}

export function createValidatedPatchEscrowArtifact(input = {}) {
  const preparedBytes = Buffer.isBuffer(input.preparedBytes) ? input.preparedBytes : Buffer.from(input.preparedBytes || '');
  const prepared = JSON.parse(preparedBytes.toString('utf8'));
  const preparedValidation = validatePreparedPatchEscrow(prepared);
  if (!preparedValidation.valid) throw new Error(`prepared artifact is invalid: ${preparedValidation.blockers.join(', ')}`);
  if (input.validationResult?.finalVerdict !== 'PATCH_ESCROW_TOKEN_FREE_VALIDATION_PASS') throw new Error('token-free validation pass is required');
  const validationEvidence = Object.freeze({
    ancestry: input.validationResult.ancestry,
    testEvidence: input.validationResult.testEvidence,
  });
  const core = attestationCore({
    preparedArtifactBase64: preparedBytes.toString('base64'),
    preparedArtifactSha256: sha256(preparedBytes),
    repository: prepared.repository,
    ownerLogin: prepared.ownerLogin,
    issueNumber: prepared.issueNumber,
    publishCommentId: prepared.publishCommentId,
    manifestCommentId: prepared.manifestCommentId,
    chunkCommentIds: Object.freeze([...(prepared.chunkCommentIds || [])]),
    bundleId: prepared.bundleId,
    authorizedPatchSha256: prepared.authorizedPatchSha256,
    patchSha256: prepared.patchSha256,
    baseSha: prepared.currentBaseSha,
    targetBranch: prepared.manifest.targetBranch,
    expectedTreeSha: input.validationResult.expectedTreeSha,
    validationVerdict: input.validationResult.finalVerdict,
    validationEvidence,
    validationEvidenceSha256: evidenceDigest(validationEvidence),
  });
  return Object.freeze({
    ...core,
    artifactSha256: sha256(Buffer.from(JSON.stringify(core), 'utf8')),
  });
}

export function validateValidatedPatchEscrowArtifact(artifact = {}) {
  const blockers = [];
  const preparedBytes = canonicalBase64(artifact.preparedArtifactBase64);
  let prepared = null;
  let preparedValidation = null;
  if (!preparedBytes) blockers.push('invalid-validated-prepared-artifact-base64');
  if (preparedBytes) {
    try {
      prepared = JSON.parse(preparedBytes.toString('utf8'));
      preparedValidation = validatePreparedPatchEscrow(prepared);
      if (!preparedValidation.valid) blockers.push(...preparedValidation.blockers.map((item) => `prepared:${item}`));
    } catch {
      blockers.push('invalid-validated-prepared-artifact-json');
    }
  }
  if (artifact.schemaVersion !== VALIDATED_PATCH_ESCROW_SCHEMA_VERSION) blockers.push('invalid-validated-artifact-schema');
  if (artifact.kind !== VALIDATED_PATCH_ESCROW_KIND) blockers.push('invalid-validated-artifact-kind');
  if (!SHA256_PATTERN.test(text(artifact.preparedArtifactSha256))) blockers.push('invalid-prepared-artifact-sha256');
  if (preparedBytes && sha256(preparedBytes) !== artifact.preparedArtifactSha256) blockers.push('prepared-artifact-digest-mismatch');
  if (!SHA256_PATTERN.test(text(artifact.patchSha256))) blockers.push('invalid-validated-patch-sha256');
  if (!SHA256_PATTERN.test(text(artifact.authorizedPatchSha256))) blockers.push('invalid-authorized-patch-sha256');
  if (!SHA_PATTERN.test(text(artifact.baseSha))) blockers.push('invalid-validated-base-sha');
  if (!SHA_PATTERN.test(text(artifact.expectedTreeSha))) blockers.push('invalid-validated-tree-sha');
  if (artifact.validationVerdict !== 'PATCH_ESCROW_TOKEN_FREE_VALIDATION_PASS') blockers.push('token-free-validation-verdict-missing');
  if (!Number.isSafeInteger(artifact.publishCommentId) || artifact.publishCommentId < 1) blockers.push('invalid-validated-publish-comment-id');
  if (!Number.isSafeInteger(artifact.manifestCommentId) || artifact.manifestCommentId < 1) blockers.push('invalid-validated-manifest-comment-id');
  if (!Array.isArray(artifact.chunkCommentIds) || !artifact.chunkCommentIds.length || artifact.chunkCommentIds.some((id) => !Number.isSafeInteger(id) || id < 1)) blockers.push('invalid-validated-chunk-comment-ids');
  if (evidenceDigest(artifact.validationEvidence) !== artifact.validationEvidenceSha256) blockers.push('validation-evidence-digest-mismatch');

  if (prepared) {
    if (prepared.repository !== artifact.repository) blockers.push('validated-repository-mismatch');
    if (prepared.ownerLogin !== artifact.ownerLogin) blockers.push('validated-owner-mismatch');
    if (prepared.issueNumber !== artifact.issueNumber) blockers.push('validated-issue-mismatch');
    if (prepared.publishCommentId !== artifact.publishCommentId) blockers.push('validated-publish-comment-mismatch');
    if (prepared.manifestCommentId !== artifact.manifestCommentId) blockers.push('validated-manifest-comment-mismatch');
    if (JSON.stringify(prepared.chunkCommentIds) !== JSON.stringify(artifact.chunkCommentIds)) blockers.push('validated-chunk-comments-mismatch');
    if (prepared.bundleId !== artifact.bundleId) blockers.push('validated-bundle-mismatch');
    if (prepared.authorizedPatchSha256 !== artifact.authorizedPatchSha256) blockers.push('validated-authorization-hash-mismatch');
    if (prepared.patchSha256 !== artifact.patchSha256) blockers.push('validated-patch-hash-mismatch');
    if (prepared.currentBaseSha !== artifact.baseSha) blockers.push('validated-base-mismatch');
    if (prepared.manifest.targetBranch !== artifact.targetBranch) blockers.push('validated-target-branch-mismatch');
    if (prepared.manifest.patchSha256 !== artifact.patchSha256) blockers.push('validated-manifest-patch-hash-mismatch');
  }
  if (artifact.authorizedPatchSha256 !== artifact.patchSha256) blockers.push('publication-authorization-not-bound-to-full-patch-hash');

  const core = attestationCore(artifact);
  if (!SHA256_PATTERN.test(text(artifact.artifactSha256))) blockers.push('invalid-validated-artifact-sha256');
  if (sha256(Buffer.from(JSON.stringify(core), 'utf8')) !== artifact.artifactSha256) blockers.push('validated-artifact-digest-mismatch');

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)].sort()),
    prepared,
    preparedValidation,
    preparedBytes,
    manifest: prepared?.manifest || null,
    patch: preparedValidation?.patch || null,
    finalVerdict: blockers.length ? 'PATCH_ESCROW_VALIDATED_ARTIFACT_BLOCKED' : 'PATCH_ESCROW_VALIDATED_ARTIFACT_PASS',
  });
}
