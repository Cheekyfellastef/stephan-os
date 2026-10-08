import { createHash } from 'node:crypto';
import { validateSourceArtifactEscrowV1 } from './sourceArtifactEscrowContinuityV1.mjs';
import { OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA } from './offlinePublicationOutboxV1.mjs';

export const FORGE_PRE_PR_PUBLICATION_SCHEMA = 'stephanos.forge-pre-pr-publication.v1';
const SHA40 = /^[0-9a-f]{40}$/;
const HASH64 = /^[0-9a-f]{64}$/;
const ZERO = '0'.repeat(40);
const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const blobDigest = (bytes) => digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const error = (blockers) => Object.freeze({
  schemaVersion: FORGE_PRE_PR_PUBLICATION_SCHEMA,
  ok: false,
  blockers: Object.freeze([...new Set(blockers)]),
  publishAllowed: false,
  mergeAuthority: false,
  forcePushAllowed: false,
  finalVerdict: 'FORGE_PRE_PR_PUBLICATION_BLOCKED',
});

export function verifyForgePrePrPublicationEvidence({
  escrow, outbox, bundleBytes, canonicalRemote, nowUtc = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const validation = validateSourceArtifactEscrowV1(escrow, nowUtc);
  if (!validation.valid) blockers.push(...validation.errors.map((x) => `escrow:${x}`));
  if (escrow?.canonicalPr !== null) blockers.push('NOT_A_PRE_PR_ESCROW');
  if (outbox?.schemaVersion !== OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA
      || outbox?.state !== 'PENDING_PUBLICATION'
      || outbox?.publicationPaused !== true
      || outbox?.pushAuthority !== false
      || outbox?.mergeAuthority !== false) blockers.push('OUTBOX_AUTHORITY_BOUNDARY_INVALID');
  for (const field of ['repository', 'missionId', 'actionId', 'canonicalBranch',
    'canonicalIssue', 'canonicalPr', 'exactParentHead', 'exactParentTree',
    'exactResultTree', 'completeArtifactSha256', 'artifactRef', 'executorIdentity']) {
    if (outbox?.[field] !== escrow?.[field]) blockers.push(`OUTBOX_${field}_MISMATCH`);
  }
  const raw = Buffer.isBuffer(bundleBytes) ? bundleBytes : null;
  if (!raw || !HASH64.test(String(escrow?.completeArtifactSha256 || ''))
      || digest(raw || Buffer.alloc(0)) !== escrow?.completeArtifactSha256) {
    blockers.push('BUNDLE_RAW_SHA256_MISMATCH');
  }
  let bundle = null;
  try { if (raw) bundle = JSON.parse(raw.toString('utf8')); } catch {}
  if (bundle?.schemaVersion !== 'stephanos.source-artifact-complete-file-bundle.v1')
    blockers.push('COMPLETE_FILE_BUNDLE_SCHEMA_REQUIRED');
  for (const field of ['repository', 'missionId', 'actionId', 'canonicalIssue',
    'canonicalPr', 'canonicalBranch', 'exactParentHead', 'exactParentTree',
    'exactResultTree', 'executorIdentity']) {
    if (bundle?.[field] !== escrow?.[field]) blockers.push(`BUNDLE_${field}_MISMATCH`);
  }
  if (!same(bundle?.testsRun, escrow?.testsRun)
      || !same(bundle?.testVerdicts, escrow?.testVerdicts)
      || bundle?.diffCheckVerdict !== 'PASS') blockers.push('TEST_PROOF_BINDING_MISMATCH');
  const files = Array.isArray(bundle?.changedFiles) ? bundle.changedFiles : [];
  const expected = Array.isArray(escrow?.changedFiles) ? escrow.changedFiles : [];
  if (!files.length || files.length !== expected.length) blockers.push('FILE_SET_MISMATCH');
  const seen = new Set();
  const entries = [];
  for (const file of files) {
    const match = expected.find((item) => item.path === file.path);
    if (!match || seen.has(file.path)) { blockers.push('FILE_IDENTITY_MISMATCH'); continue; }
    seen.add(file.path);
    if (!same([file.beforeBlobSha, file.afterBlobSha, file.sha256],
      [match.beforeBlobSha, match.afterBlobSha, match.sha256])) blockers.push('FILE_HASH_MANIFEST_MISMATCH');
    if (!['100644', '100755'].includes(file.mode) && !(file.deleted && file.mode === '000000'))
      blockers.push('FILE_MODE_NOT_ALLOWED');
    if (file.deleted) {
      if (file.afterBlobSha !== ZERO || file.contentBase64 !== '') blockers.push('DELETION_BLOB_INVALID');
      entries.push({ path: file.path, mode: file.mode, type: 'blob', sha: null });
      continue;
    }
    if (typeof file.contentBase64 !== 'string'
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) {
      blockers.push('FILE_BASE64_INVALID'); continue;
    }
    const bytes = Buffer.from(file.contentBase64, 'base64');
    if (digest(bytes) !== file.sha256 || blobDigest(bytes) !== file.afterBlobSha)
      blockers.push('FILE_CONTENT_HASH_MISMATCH');
    entries.push({ path: file.path, mode: file.mode, type: 'blob', contentBase64: file.contentBase64,
      expectedBlobSha: file.afterBlobSha });
  }
  if (canonicalRemote?.repository !== escrow?.repository
      || canonicalRemote?.branch !== escrow?.canonicalBranch
      || canonicalRemote?.branchExists !== false
      || !SHA40.test(String(canonicalRemote?.mainHead || ''))
      || canonicalRemote?.mainHead !== escrow?.exactParentHead
      || canonicalRemote?.mainTree !== escrow?.exactParentTree) {
    blockers.push('REMOTE_BRANCH_OR_PARENT_DRIFT_UNPROVEN');
  }
  if (blockers.length) return error(blockers);
  return Object.freeze({
    schemaVersion: FORGE_PRE_PR_PUBLICATION_SCHEMA,
    ok: true,
    blockers: Object.freeze([]),
    repository: escrow.repository,
    missionId: escrow.missionId,
    issueNumber: escrow.canonicalIssue,
    branch: escrow.canonicalBranch,
    parentHead: escrow.exactParentHead,
    parentTree: escrow.exactParentTree,
    resultTree: escrow.exactResultTree,
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    publishAllowed: false,
    requiresSeparatelyVerifiedPublicationAuthority: true,
    mergeAuthority: false,
    forcePushAllowed: false,
    finalVerdict: 'FORGE_PRE_PR_EXACT_ARTIFACT_VERIFIED_AWAITING_AUTHORITY',
  });
}
