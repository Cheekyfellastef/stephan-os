#!/usr/bin/env node
// Trusted-main review escalation. Read-only; never signs an approval or merges.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateIndependentReviewArtifact } from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import { reviewExactHead } from './exact-head-review.mjs';
import {
  validateProtectedOpenClawReviewRunIdentity,
  validateProtectedOpenClawReviewArtifactMetadata,
  validateProtectedOpenClawBootstrapFindings,
} from '../shared/agents/protectedOpenClawMergeMailboxAdapter.mjs';

const REPO = 'Cheekyfellastef/stephan-os';
const OWNER = 'Cheekyfellastef';
const SCHEMA = 'stephanos.exact-head-qualified-escalation.v1';
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const fail = reason => { throw new Error('EXACT_HEAD_ESCALATION_BLOCKED:' + reason); };
const requireProof = (ok, reason) => { if (!ok) fail(reason); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const positive = v => Number.isSafeInteger(v) && v > 0;

export function validateOwnerEscalationCommentV1(comment, input, patchDigest, nowMs = Date.now()) {
  requireProof(comment?.user?.login === OWNER && comment?.author_association === 'OWNER'
    && comment?.issue_url === 'https://api.github.com/repos/' + REPO + '/issues/' + input.prNumber
    && comment?.created_at === comment?.updated_at, 'OWNER_PROVENANCE');
  const match = String(comment.body || '').match(/\x60{3}stephanos-exact-head-qualified-review-v1\s*([\s\S]*?)\x60{3}/);
  requireProof(match && match[1].length <= 5000, 'OWNER_FENCE');
  let p;
  try { p = JSON.parse(match[1].trim()); } catch { fail('OWNER_JSON'); }
  const keys = ['schemaVersion','operation','repository','prNumber','expectedHead','expectedBase',
    'patchSha256','reviewRunId','reviewRunAttempt','reviewArtifactId','reviewArtifactDigest',
    'reviewPayloadSha256','scope','expiresAt'];
  requireProof(p && !Array.isArray(p) && typeof p === 'object'
    && JSON.stringify(Object.keys(p).sort()) === JSON.stringify(keys.sort()), 'OWNER_SCHEMA');
  requireProof(p.schemaVersion === SCHEMA
    && p.operation === 'AUTHORIZE_EXACT_HEAD_REVIEW_ESCALATION'
    && p.repository === REPO && p.prNumber === input.prNumber
    && p.expectedHead === input.headSha && p.expectedBase === input.baseSha
    && p.patchSha256 === patchDigest && p.scope === 'exact-head-review-only'
    && positive(p.reviewRunId) && positive(p.reviewRunAttempt) && positive(p.reviewArtifactId)
    && /^sha256:[a-f0-9]{64}$/.test(p.reviewArtifactDigest)
    && SHA256.test(p.reviewPayloadSha256), 'OWNER_BINDING');
  const issued = Date.parse(comment.created_at), until = Date.parse(p.expiresAt);
  requireProof(Number.isFinite(nowMs) && Number.isFinite(issued) && Number.isFinite(until)
    && issued <= nowMs + 60_000 && until > nowMs && until > issued
    && until - issued <= 60 * 60_000, 'OWNER_EXPIRY');
  return Object.freeze({ ...p, commentId: comment.id });
}

export function assertQualifiableExactHeadReceiptV1(input, receipt) {
  requireProof(input?.repository === REPO && positive(input.prNumber)
    && SHA.test(input.headSha) && SHA.test(input.baseSha)
    && typeof input.patch === 'string' && input.patch.startsWith('diff --git ')
    && Buffer.byteLength(input.patch) <= 2_000_000, 'REVIEW_TARGET');
  requireProof(receipt?.verdict === 'STEPHANOS_REVIEW_FINDINGS'
    && receipt.repository === REPO && receipt.prNumber === input.prNumber
    && receipt.headSha === input.headSha && receipt.baseSha === input.baseSha, 'REVIEW_IDENTITY');
  requireProof(Array.isArray(receipt.findings) && receipt.findings.length > 0
    && receipt.findings.length <= 40
    && receipt.findings.every(item => item?.severity === 'P2'
      && ['AUTHORITY_SURFACE_CHANGED', 'DYNAMIC_EXECUTION'].includes(item?.code)),
    'UNRELATED_OR_SERIOUS_FINDINGS');
  return Object.freeze({ patchSha256: digest(input.patch) });
}

// Exact-head review cannot outlive a concurrent PR head/base update. This
// validation is used once before external evidence and again at conclusion.
// It does NOT confer merge authority or waive separate branch protections.
export function assertCurrentExactHeadPrIdentityV1(pr, input) {
  requireProof(pr?.state === 'open' && pr?.draft === false
    && pr?.head?.sha === input.headSha && pr?.base?.sha === input.baseSha
    && pr?.base?.ref === 'main' && pr?.head?.repo?.full_name === REPO,
    'PR_CHANGED');
  return true;
}

export async function qualifyExactHeadReviewV1(input, receipt, { api, download, unzip, nowMs } = {}) {
  const context = assertQualifiableExactHeadReceiptV1(input, receipt);
  requireProof(typeof api === 'function' && typeof download === 'function'
    && typeof unzip === 'function', 'TRUSTED_TRANSPORT_UNAVAILABLE');
  const pr = await api('/pulls/' + input.prNumber);
  assertCurrentExactHeadPrIdentityV1(pr, input);
  const issue = await api('/issues/' + input.prNumber);
  const pages = Math.ceil(Number(issue?.comments) / 100);
  requireProof(pages > 0 && Number.isSafeInteger(pages), 'OWNER_COMMENT_ABSENT');
  const comments = [];
  for (let n = Math.max(1, pages - 1); n <= pages; n++) {
    const batch = await api('/issues/' + input.prNumber + '/comments?per_page=100&page=' + n);
    requireProof(Array.isArray(batch), 'OWNER_COMMENT_READ');
    comments.push(...batch);
  }
  // Untrusted PR commenters may quote this public marker. Only OWNER
  // provenance can designate the latest owner-issued escalation request;
  // never let an unrelated bot/comment supersede an authentic owner record.
  // The chosen owner record still goes through all immutable SHA, artifact,
  // expiry and no-edit checks below. An expired owner record stays HOLD.
  const ownerCandidates = comments.filter(c =>
    c?.user?.login === OWNER && c?.author_association === 'OWNER'
    && c?.issue_url === 'https://api.github.com/repos/' + REPO + '/issues/' + input.prNumber
    && String(c?.body || '').includes('stephanos-exact-head-qualified-review-v1'));
  requireProof(ownerCandidates.length > 0, 'OWNER_ESCALATION_NOT_POSTED');
  const owner = validateOwnerEscalationCommentV1(ownerCandidates.at(-1), input,
    context.patchSha256, nowMs ?? Date.now());
  const command = {
    // Bind the exact PR to the trusted workflow-run name and association.
    prNumber: input.prNumber,
    reviewRunId: owner.reviewRunId, reviewRunAttempt: owner.reviewRunAttempt,
    reviewArtifactId: owner.reviewArtifactId, reviewArtifactDigest: owner.reviewArtifactDigest,
    expectedHead: input.headSha, expectedBase: input.baseSha,
  };
  const run = await api('/actions/runs/' + owner.reviewRunId);
  requireProof(validateProtectedOpenClawReviewRunIdentity(run, pr, command), 'REVIEW_RUN_UNBOUND');
  const jobs = await api('/actions/runs/' + owner.reviewRunId + '/jobs?per_page=100');
  requireProof(Array.isArray(jobs?.jobs) && jobs.jobs.some(j =>
    j?.name === 'independent-security-review'
      && j?.status === 'completed' && j?.conclusion === 'success'
      && Number(j?.run_id) === owner.reviewRunId), 'REVIEW_JOB_NOT_SUCCESS');
  const metadata = await api('/actions/artifacts/' + owner.reviewArtifactId);
  requireProof(validateProtectedOpenClawReviewArtifactMetadata(metadata, command, run),
    'ARTIFACT_IDENTITY');
  const zip = await download(owner.reviewArtifactId);
  requireProof(Buffer.isBuffer(zip) && zip.length > 0 && zip.length <= 8 * 1024 * 1024,
    'ARCHIVE_INVALID');
  requireProof('sha256:' + digest(zip) === owner.reviewArtifactDigest, 'ARCHIVE_DIGEST');
  const content = await unzip(zip);
  requireProof(typeof content === 'string' && Buffer.byteLength(content) <= 1024 * 1024,
    'ARTIFACT_OVERSIZE');
  let artifact;
  try { artifact = JSON.parse(content); } catch { fail('ARTIFACT_JSON'); }
  const verified = validateIndependentReviewArtifact(artifact, {
    repository: REPO, prNumber: input.prNumber, branch: pr.head.ref,
    expectedHead: input.headSha, expectedBaseSha: input.baseSha,
    expectedPayloadSha256: owner.reviewPayloadSha256,
    workflowRunId: owner.reviewRunId, workflowRunAttempt: owner.reviewRunAttempt,
  });
  requireProof(verified.valid, 'ARTIFACT_PAYLOAD_UNTRUSTED');
  const fs = artifact?.receipt?.findings;
  const clean = artifact.reviewMode === 'clean-independent' &&
    artifact?.receipt?.verdict === 'clean' && Array.isArray(fs) && fs.length === 0;
  const bootstrap = artifact.reviewMode === 'qualified-operator-bootstrap'
    && artifact?.receipt?.verdict === 'findings'
    && Array.isArray(artifact?.receipt?.reviewScope)
    && artifact.receipt.reviewScope.includes('operator-protected-bootstrap-required')
    && validateProtectedOpenClawBootstrapFindings(fs);
  requireProof(clean || bootstrap, 'INDEPENDENT_NOT_QUALIFIED');
  // The external run/artifact may have taken seconds to fetch and inspect.
  // Reject a replaced PR head or changed protected base, even if the first
  // GitHub read and the independent evidence matched the old snapshot.
  const prAfter = await api('/pulls/' + input.prNumber);
  assertCurrentExactHeadPrIdentityV1(prAfter, input);
  return Object.freeze({
    ok: true, finalVerdict: 'EXACT_HEAD_QUALIFIED_ESCALATION_PASS',
    prNumber: input.prNumber, sourceHead: input.headSha,
    ownerCommentId: owner.commentId, independentReviewRunId: owner.reviewRunId,
    independentArtifactId: owner.reviewArtifactId,
    reviewMode: artifact.reviewMode, approvalAuthority: false, mergeAuthority: false,
  });
}

async function api(path) {
  requireProof(Boolean(process.env.GH_TOKEN), 'GH_TOKEN_MISSING');
  const r = await fetch('https://api.github.com/repos/' + REPO + path, {
    headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json', 'User-Agent': 'stephanos-exact-review',
      'X-GitHub-Api-Version': '2022-11-28' },
  });
  requireProof(r.ok, 'GITHUB_API_' + r.status);
  return r.json();
}
async function download(id) {
  const r = await fetch('https://api.github.com/repos/' + REPO
    + '/actions/artifacts/' + id + '/zip', {
    headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json', 'User-Agent': 'stephanos-exact-review' },
  });
  requireProof(r.ok, 'GITHUB_ARTIFACT_' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function unzip(zip) {
  const dir = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-'));
  try {
    const source = join(dir, 'review.zip');
    writeFileSync(source, zip, { flag: 'wx', mode: 0o600 });
    const result = spawnSync('/usr/bin/unzip', ['-p', source, 'independent-review-result.json'],
      { encoding: 'utf8', shell: false, timeout: 10000, maxBuffer: 1024 * 1024 });
    requireProof(!result.error && result.status === 0, 'ZIP_EXTRACT_FAIL');
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function main() {
  requireProof(process.env.GITHUB_ACTIONS === 'true' && process.argv.length === 4,
    'TRUSTED_WORKFLOW_REQUIRED');
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  // Only the trusted source-controlled engine creates the review receipt.
  // Never ingest a caller-provided approval or a PR-controlled JSON receipt.
  const receipt = reviewExactHead(input);
  writeFileSync(process.argv[3], JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx', mode: 0o600,
  });
  if (receipt.verdict === 'STEPHANOS_REVIEW_PASS' && Array.isArray(receipt.findings)
    && receipt.findings.length === 0) {
    process.stdout.write('EXACT_HEAD_QUALIFIED_ESCALATION=NOT_REQUIRED\n');
    return;
  }
  const output = await qualifyExactHeadReviewV1(input, receipt, { api, download, unzip });
  process.stdout.write('EXACT_HEAD_QUALIFIED_ESCALATION=' + output.finalVerdict + '\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { process.stderr.write(String(e?.message || e) + '\n'); process.exitCode = 1; });
}
