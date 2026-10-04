import {
  DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
  DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR,
  DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY,
  evaluateDirectOperatorIntentStandingAuthorityV1,
} from './directOperatorIntentStandingAuthorityV1.mjs';

export const DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_SCHEMA =
  'stephanos.direct-operator-intent-github-comment.v1';
export const DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER =
  '<!-- stephanos-direct-operator-intent:v1 -->';
export const DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_FENCE =
  'stephanos-direct-operator-intent';

const INTEGER = /^[1-9][0-9]*$/;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const raw = text(value);
  if (!INTEGER.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function markerCount(body) {
  return String(body ?? '').split(DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER).length - 1;
}

export function extractDirectOperatorIntentGithubCommentV1(body = '') {
  const source = String(body ?? '');
  if (markerCount(source) !== 1) {
    return Object.freeze({
      ok: false,
      blocker: 'direct-intent-comment-marker-not-exact',
      receipt: null,
    });
  }
  const pattern = /\`\`\`stephanos-direct-operator-intent\s*([\s\S]*?)\s*\`\`\`/gi;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    return Object.freeze({
      ok: false,
      blocker: 'direct-intent-comment-fence-not-exact',
      receipt: null,
    });
  }
  let receipt;
  try {
    receipt = JSON.parse(matches[0][1]);
  } catch {
    return Object.freeze({
      ok: false,
      blocker: 'direct-intent-comment-json-invalid',
      receipt: null,
    });
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return Object.freeze({
      ok: false,
      blocker: 'direct-intent-comment-receipt-invalid',
      receipt: null,
    });
  }
  return Object.freeze({ ok: true, blocker: '', receipt: Object.freeze({ ...receipt }) });
}

export function evaluateDirectOperatorIntentGithubCommentV1(comment = {}, options = {}) {
  const issueNumber = positiveInteger(options.issueNumber);
  const commentId = positiveInteger(comment?.id);
  const blockers = [];
  if (!issueNumber) blockers.push('direct-intent-goal-issue-invalid');
  if (!commentId) blockers.push('direct-intent-comment-id-invalid');
  if (text(comment?.user?.login) !== DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR) {
    blockers.push('direct-intent-comment-author-not-operator');
  }
  if (text(comment?.author_association).toUpperCase() !== 'OWNER') {
    blockers.push('direct-intent-comment-author-not-owner');
  }
  const expectedIssueUrl =
    `https://api.github.com/repos/${DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY}/issues/${issueNumber}`;
  if (text(comment?.issue_url) !== expectedIssueUrl) {
    blockers.push('direct-intent-comment-issue-mismatch');
  }

  const extracted = extractDirectOperatorIntentGithubCommentV1(comment?.body);
  if (!extracted.ok) blockers.push(extracted.blocker);
  const receipt = extracted.receipt || {};
  if (text(receipt.goalId) !== `goal-${issueNumber}`) {
    blockers.push('direct-intent-comment-goal-mismatch');
  }

  const provenance = Object.freeze({
    schemaVersion: DIRECT_OPERATOR_INTENT_AUTHENTICATED_PROVENANCE_SCHEMA,
    authenticated: blockers.length === 0,
    source: 'github-owner-authenticated-request',
    repository: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY,
    operator: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR,
    requestId: text(receipt.requestId),
    goalId: text(receipt.goalId),
    evidenceRef: commentId ? `github-comment-${commentId}` : '',
  });
  const authority = evaluateDirectOperatorIntentStandingAuthorityV1({
    receipt,
  }, {
    authenticatedProvenance: provenance,
  });
  if (!authority.valid) blockers.push(...authority.blockers);
  if (!authority.authenticatedProvenance?.valid) {
    blockers.push(...(authority.authenticatedProvenance?.blockers || []));
  }
  if (!authority.protectedContinuationAuthenticated) {
    blockers.push('direct-intent-protected-continuation-not-authenticated');
  }

  return Object.freeze({
    schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_SCHEMA,
    valid: blockers.length === 0,
    commentId,
    issueNumber,
    receipt: extracted.receipt,
    authenticatedProvenance: provenance,
    authority,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length === 0
      ? 'DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_AUTHENTICATED'
      : 'DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_BLOCKED',
  });
}

function ownerIntentCandidate(comment = {}) {
  return text(comment?.user?.login) === DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR
    && text(comment?.author_association).toUpperCase() === 'OWNER'
    && String(comment?.body ?? '').includes(DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER);
}

export function selectDirectOperatorIntentGithubCommentV1(comments = [], options = {}) {
  const candidates = (Array.isArray(comments) ? comments : [])
    .filter(ownerIntentCandidate)
    .sort((left, right) => {
      const leftTime = Date.parse(text(left?.created_at) || text(left?.updated_at) || 0);
      const rightTime = Date.parse(text(right?.created_at) || text(right?.updated_at) || 0);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return positiveInteger(right?.id) - positiveInteger(left?.id);
    });
  if (candidates.length === 0) {
    return Object.freeze({
      schemaVersion: DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_SCHEMA,
      valid: false,
      commentId: 0,
      issueNumber: positiveInteger(options.issueNumber),
      receipt: null,
      authenticatedProvenance: null,
      authority: null,
      blockers: Object.freeze(['direct-intent-owner-comment-missing']),
      finalVerdict: 'DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_BLOCKED',
    });
  }
  // The latest owner-authenticated intent is authoritative. A later revocation
  // or malformed replacement may not silently fall back to an older grant.
  return evaluateDirectOperatorIntentGithubCommentV1(candidates[0], options);
}
