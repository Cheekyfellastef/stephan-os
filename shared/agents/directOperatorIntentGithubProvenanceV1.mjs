import {
  DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
  DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR,
  DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY,
  evaluateDirectOperatorIntentStandingAuthorityV1,
} from './directOperatorIntentStandingAuthorityV1.mjs';

export const DIRECT_OPERATOR_INTENT_GITHUB_MARKER = 'stephanos-direct-operator-intent-v1';
export const DIRECT_OPERATOR_INTENT_GITHUB_SOURCE = 'github-owner-authenticated-request';

function text(value) { return String(value ?? '').trim(); }
function positiveInteger(value) {
  const raw = String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function extractReceipt(body = '') {
  const source = String(body || '');
  const marker = DIRECT_OPERATOR_INTENT_GITHUB_MARKER;
  if (source.toLowerCase().split(marker).length - 1 !== 1) {
    return Object.freeze({ applicable: false, ok: false, blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_MARKER_COUNT_INVALID' });
  }
  const fence = String.fromCharCode(96).repeat(3);
  const start = source.toLowerCase().indexOf((fence + marker).toLowerCase());
  if (start < 0) return Object.freeze({ applicable: true, ok: false, blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_FENCE_INVALID' });
  const payloadStart = start + fence.length + marker.length;
  const end = source.indexOf(fence, payloadStart);
  if (end < 0) return Object.freeze({ applicable: true, ok: false, blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_FENCE_INVALID' });
  try {
    const receipt = JSON.parse(source.slice(payloadStart, end).trim());
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('not-object');
    return Object.freeze({ applicable: true, ok: true, receipt });
  } catch {
    return Object.freeze({ applicable: true, ok: false, blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_JSON_INVALID' });
  }
}

export function evaluateDirectOperatorIntentGithubCommentV1(comment = {}, { expectedGoalId = '' } = {}) {
  const commentId = positiveInteger(comment?.id);
  const author = text(comment?.user?.login);
  if (!commentId) return Object.freeze({ applicable: false, ok: false, blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_ID_INVALID' });
  if (author !== DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR) {
    return Object.freeze({ applicable: false, ok: false, blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_AUTHOR_NOT_OWNER' });
  }
  const extracted = extractReceipt(comment?.body);
  if (!extracted.applicable) return extracted;
  if (!extracted.ok) return Object.freeze({ ...extracted, commentId });

  const receipt = extracted.receipt;
  if (text(receipt.goalId) !== text(expectedGoalId)) {
    return Object.freeze({ applicable: false, ok: false, blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_GOAL_MISMATCH', commentId });
  }

  const provenance = Object.freeze({
    schemaVersion: DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
    authenticated: true,
    source: DIRECT_OPERATOR_INTENT_GITHUB_SOURCE,
    repository: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY,
    operator: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR,
    requestId: text(receipt.requestId),
    goalId: text(receipt.goalId),
    evidenceRef: 'github-issue-comment:' + commentId,
  });
  const evaluated = evaluateDirectOperatorIntentStandingAuthorityV1(receipt, {
    authenticatedProvenance: provenance,
  });
  return Object.freeze({
    applicable: true,
    ok: evaluated.protectedContinuationAuthenticated === true,
    blocker: evaluated.protectedContinuationAuthenticated === true
      ? ''
      : (evaluated.blockers?.[0] || evaluated.authenticatedProvenance?.blockers?.[0] || 'DIRECT_OPERATOR_INTENT_GITHUB_NOT_AUTHORIZED'),
    commentId,
    receipt: Object.freeze({ ...receipt }),
    provenance,
    evaluation: evaluated,
  });
}

export function selectLatestDirectOperatorIntentGithubCommentV1(comments = [], { expectedGoalId = '' } = {}) {
  const candidates = (Array.isArray(comments) ? comments : [])
    .map((comment) => ({ comment, parsed: evaluateDirectOperatorIntentGithubCommentV1(comment, { expectedGoalId }) }))
    .filter(({ parsed }) => parsed.applicable === true)
    .sort((left, right) => positiveInteger(right.comment?.id) - positiveInteger(left.comment?.id));
  if (!candidates.length) {
    return Object.freeze({
      applicable: false,
      ok: false,
      blocker: 'DIRECT_OPERATOR_INTENT_GITHUB_EVIDENCE_NOT_FOUND',
      receipt: null,
      provenance: null,
    });
  }
  return candidates[0].parsed;
}
