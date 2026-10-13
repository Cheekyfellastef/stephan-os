// External owner-attested, single-task source-proposal authorization.
// The local approval file is a pointer ONLY; it is never treated as authority.
import { evaluateParallelSeedExactApprovalV1 } from './seedCanopyParallelSupervisorV1.mjs';

export const SEED_PARALLEL_APPROVAL_REF_SCHEMA = 'stephanos.seed-parallel-github-approval-reference.v1';
const OWNER = 'Cheekyfellastef';
const REPO = 'Cheekyfellastef/stephan-os';
const APPROVAL_ISSUE = 3096;
const MARKER = 'stephanos-seed-parallel-owner-approval';
const COMMENT_MAX_BYTES = 12000;
const ID_PATTERN = /^[1-9][0-9]{0,12}$/;
const TIMESPAN = 24 * 60 * 60 * 1000;

export function validateSeedParallelApprovalReferenceV1(reference) {
  return reference?.schemaVersion === SEED_PARALLEL_APPROVAL_REF_SCHEMA
    && ID_PATTERN.test(String(reference?.commentId || ''))
    && Object.keys(reference || {}).sort().join(',') === 'commentId,schemaVersion';
}

export async function verifySeedParallelOwnerGitHubApprovalV1({
  request, manifestSha256, reference, fetchFn = fetch, nowMs = Date.now(),
} = {}) {
  const blocked = (reason) => Object.freeze({ ok: false, reason, approval: null });
  if (!validateSeedParallelApprovalReferenceV1(reference)) return blocked('NO_OWNER_COMMENT_REFERENCE');
  if (!Number.isFinite(nowMs)) return blocked('INVALID_VERIFICATION_TIME');
  const url = 'https://api.github.com/repos/' + REPO + '/issues/comments/' + String(reference.commentId);
  let comment;
  try {
    const response = await fetchFn(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Stephanos-Seed-Parallel-Forge' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (response.status !== 200) return blocked('GITHUB_OWNER_APPROVAL_UNAVAILABLE');
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > COMMENT_MAX_BYTES) return blocked('GITHUB_COMMENT_TOO_LARGE');
    comment = JSON.parse(body);
  } catch {
    return blocked('GITHUB_OWNER_APPROVAL_UNAVAILABLE');
  }
  if (comment?.id !== Number(reference.commentId)
    || comment?.user?.login !== OWNER || comment?.author_association !== 'OWNER'
    || comment?.issue_url !== 'https://api.github.com/repos/' + REPO + '/issues/' + APPROVAL_ISSUE)
    return blocked('GITHUB_COMMENT_NOT_OWNER_ISSUE_BOUND');
  const created = Date.parse(comment.created_at || '');
  const updated = Date.parse(comment.updated_at || '');
  if (!Number.isFinite(created) || created > nowMs || nowMs - created > TIMESPAN
    || !Number.isFinite(updated) || updated > nowMs)
    return blocked('GITHUB_APPROVAL_NOT_FRESH');
  const body = String(comment.body || '');
  const match = body.match(new RegExp('\\`\\`\\`' + MARKER + '\\s*([\\s\\S]*?)\\`\\`\\`'));
  if (!match) return blocked('GITHUB_APPROVAL_MARKER_MISSING');
  let approval;
  try { approval = JSON.parse(match[1]); } catch { return blocked('GITHUB_APPROVAL_JSON_INVALID'); }
  // Exact approval format remains the existing canonical no-merge/no-deploy grant.
  const structural = evaluateParallelSeedExactApprovalV1({
    request, manifestSha256, approval, nowMs,
  });
  if (!structural.ok) return blocked('GITHUB_APPROVAL_EXACT_TASK_MISMATCH');
  // GitHub comment creation bounds the approval timestamp: an old approval cannot be re-dated.
  if (Date.parse(approval.issuedAtUtc) < created - 300000
    || Date.parse(approval.issuedAtUtc) > updated + 300000
    || Date.parse(approval.expiresAtUtc) > created + TIMESPAN)
    return blocked('GITHUB_APPROVAL_TIMESTAMP_MISMATCH');
  return Object.freeze({
    ok: true,
    reason: '',
    approval: Object.freeze({ ...approval }),
    owner: OWNER,
    source: 'GITHUB_OWNER_AUTHENTICATED_COMMENT',
    commentId: comment.id,
  });
}
