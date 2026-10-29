// Fail-closed dispatch suppression only. This is not a review validator,
// admission grant, or independent security-review receipt.
export const EXISTING_REVIEW_EVIDENCE_FENCE_SCHEMA = 'stephanos.independent-review-existing-evidence-fence.v1';

const SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /\b[a-f0-9]{64}\b/i;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const ACTIONS = Object.freeze({ login: 'github-actions[bot]', id: 41898282 });
const OWNER = Object.freeze({ login: 'Cheekyfellastef', id: 267490109 });

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function same(left, right) { return text(left).toLowerCase() === text(right).toLowerCase(); }
function integer(value) { return Number.isSafeInteger(value) && value > 0 ? value : 0; }
function actor(comment, expected) {
  return same(comment?.user?.login, expected.login)
    && comment?.user?.id === expected.id;
}
function hasExactSha(body, sha) {
  return new RegExp(`(?:^|[^a-f0-9])${sha}(?:$|[^a-f0-9])`, 'i').test(body);
}
function hasOriginalPr(body, prNumber) {
  return new RegExp(`\\bPR\\s*#${prNumber}\\b`, 'i').test(body);
}
function ownerHint(comment, identity) {
  if (!actor(comment, OWNER) || comment?.user?.type !== 'User') return null;
  const body = text(comment?.body);
  if (!hasOriginalPr(body, identity.prNumber)
    || !hasExactSha(body, identity.expectedHead)
    || !hasExactSha(body, identity.expectedBase)
    || !/\bCLEAN\b/i.test(body)
    || !/independent\s+(?:GitHub\s+)?(?:security\s+)?review/i.test(body)
    || !SHA256.test(body)) return null;
  const escapedRepo = REPOSITORY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const runPattern = new RegExp(`https://github\\.com/${escapedRepo}/actions/runs/(\\d+)(?:/artifacts/(\\d+))?`, 'g');
  const runIds = new Set();
  const artifactIds = new Map();
  for (const match of body.matchAll(runPattern)) {
    const runId = Number(match[1]);
    if (!integer(runId)) continue;
    runIds.add(runId);
    if (match[2] && integer(Number(match[2]))) artifactIds.set(runId, Number(match[2]));
  }
  const digest = body.match(/\bsha256\s*[:=]?\s*([a-f0-9]{64})\b/i)?.[1]?.toLowerCase();
  if (!digest) return null;
  for (const runId of runIds) {
    if (!artifactIds.has(runId)) continue;
    return { kind: 'OWNER_REVIEW_ARTIFACT_REFERENCE', runId, artifactId: artifactIds.get(runId), sha256: digest };
  }
  return null;
}
function actionHint(comment, identity) {
  if (!actor(comment, ACTIONS) || !same(comment?.user?.type, 'Bot')) return null;
  const body = text(comment?.body);
  if (!body.includes('<!-- stephanos:independent-review-artifact-index:v1 -->')
    || !body.includes('<!-- stephanos-protected-security-review -->')) return null;
  const found = [];
  for (const match of body.matchAll(/```json\s*([\s\S]*?)```/g)) {
    let receipt;
    try { receipt = JSON.parse(match[1]); } catch { continue; }
    if (receipt?.schemaVersion !== 'stephanos.provider-neutral-review.v1'
      || receipt?.kind !== 'stephanos.provider-neutral.review'
      || receipt?.verdict !== 'clean'
      || receipt?.prNumber !== identity.prNumber
      || !same(receipt?.repository, REPOSITORY)
      || receipt?.branch !== identity.branch
      || !same(receipt?.sourceHead, identity.expectedHead)
      || !Array.isArray(receipt?.proofRefs)
      || !receipt.proofRefs.includes(`proofs/independent-review/base-${identity.expectedBase}`)) continue;
    const session = text(receipt?.reviewerSessionId).match(/^github-actions-independent-review-run-(\d+)-attempt-(\d+)$/);
    if (!session || !integer(Number(session[1])) || !integer(Number(session[2]))) continue;
    found.push({ kind:'TRUSTED_ACTIONS_ARTIFACT_INDEX', runId:Number(session[1]), attempt:Number(session[2]) });
  }
  return found[0] ?? null;
}

/**
 * A matching claim MUST cause HOLD and independent readback of the referenced
 * workflow, immutable artifact and exact PR/base. It MUST NOT count as clean
 * review or permit merge, and the missing-run launcher MUST NOT dispatch again.
 */
export function findExistingIndependentReviewEvidenceHintV1(input = {}) {
  const prNumber = integer(input.prNumber);
  const branch = text(input.branch);
  const expectedHead = text(input.expectedHead).toLowerCase();
  const expectedBase = text(input.expectedBase).toLowerCase();
  if (!prNumber || !branch || !SHA.test(expectedHead) || !SHA.test(expectedBase)
    || !same(input.repository, REPOSITORY) || !Array.isArray(input.comments)) {
    return Object.freeze({schemaVersion:EXISTING_REVIEW_EVIDENCE_FENCE_SCHEMA, status:'HOLD_INVALID_PREFLIGHT',
      mutationAllowed:false, reviewQualified:false});
  }
  const identity = {prNumber,branch,expectedHead,expectedBase};
  const hints = [];
  for (const comment of input.comments) {
    const hint = actionHint(comment, identity) || ownerHint(comment, identity);
    if (hint) hints.push({ ...hint, commentId:integer(comment?.id) || null });
  }
  if (hints.length) {
    const runs = new Set(hints.map((hint) => String(hint.runId)));
    for (const hint of hints) {
      if (hint.kind !== 'OWNER_REVIEW_ARTIFACT_REFERENCE') continue;
      for (const other of hints) {
        if (other.kind !== 'OWNER_REVIEW_ARTIFACT_REFERENCE' || other.runId !== hint.runId) continue;
        if (other.artifactId !== hint.artifactId || other.sha256 !== hint.sha256) runs.add(String(hint.runId) + ':COLLISION');
      }
    }
    if (runs.size !== 1) {
      return Object.freeze({schemaVersion:EXISTING_REVIEW_EVIDENCE_FENCE_SCHEMA,
        status:'HOLD_CONFLICTING_EXISTING_REVIEW_REFERENCES',mutationAllowed:false,reviewQualified:false});
    }
    // Prefer an authenticated owner reference with immutable artifact ID/digest.
    const selected = hints.find((hint) => hint.kind === 'OWNER_REVIEW_ARTIFACT_REFERENCE') || hints[0];
    return Object.freeze({schemaVersion:EXISTING_REVIEW_EVIDENCE_FENCE_SCHEMA,
      status:'HOLD_EXISTING_REVIEW_NEEDS_READBACK',kind:selected.kind,
      commentId:selected.commentId,runId:selected.runId,attempt:selected.attempt || null,
      artifactId:selected.artifactId || null,sha256:selected.sha256 || null,
      mutationAllowed:false,reviewQualified:false});
  }
  return Object.freeze({schemaVersion:EXISTING_REVIEW_EVIDENCE_FENCE_SCHEMA,
    status:'NO_EXISTING_EVIDENCE_HINT',mutationAllowed:false,reviewQualified:false});
}
