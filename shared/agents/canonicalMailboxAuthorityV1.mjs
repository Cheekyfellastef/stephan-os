export const CANONICAL_MAILBOX_AUTHORITY_SCHEMA = 'stephanos.canonical-mailbox-authority.v1';
export const CANONICAL_MAILBOX_ISSUE = 2158;
export const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([1507]);

// GitHub has already refused further comments on the retired #1507 surface after
// it crossed 2,500 comments. Rotate well before that observed transport failure
// instead of treating a finite issue thread as permanent infrastructure.
export const CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS = 2200;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

export function isCanonicalMailboxIssue(issueNumber) {
  return positiveInteger(issueNumber) === CANONICAL_MAILBOX_ISSUE;
}

export function isRetiredCanonicalMailboxIssue(issueNumber) {
  const normalized = positiveInteger(issueNumber);
  return normalized > 0 && RETIRED_CANONICAL_MAILBOX_ISSUES.includes(normalized);
}

export function evaluateCanonicalMailboxCapacity({
  issueNumber = CANONICAL_MAILBOX_ISSUE,
  commentCount = 0,
} = {}) {
  const normalizedIssue = positiveInteger(issueNumber);
  const normalizedCount = Number(commentCount);
  if (normalizedIssue !== CANONICAL_MAILBOX_ISSUE) {
    return Object.freeze({
      ok: false,
      blocker: isRetiredCanonicalMailboxIssue(normalizedIssue)
        ? 'CANONICAL_MAILBOX_ISSUE_RETIRED'
        : 'CANONICAL_MAILBOX_ISSUE_MISMATCH',
      issueNumber: normalizedIssue,
      rotationRequired: false,
    });
  }
  if (!Number.isSafeInteger(normalizedCount) || normalizedCount < 0) {
    return Object.freeze({
      ok: false,
      blocker: 'CANONICAL_MAILBOX_COMMENT_COUNT_INVALID',
      issueNumber: normalizedIssue,
      rotationRequired: false,
    });
  }
  return Object.freeze({
    ok: true,
    blocker: '',
    issueNumber: normalizedIssue,
    commentCount: normalizedCount,
    rotationThresholdComments: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
    rotationRequired: normalizedCount >= CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
  });
}

export function validateCanonicalMailboxSuccessor({
  currentIssue = CANONICAL_MAILBOX_ISSUE,
  nextIssue,
  retiredIssues = RETIRED_CANONICAL_MAILBOX_ISSUES,
} = {}) {
  const current = positiveInteger(currentIssue);
  const next = positiveInteger(nextIssue);
  const retired = Array.isArray(retiredIssues)
    ? retiredIssues.map(positiveInteger).filter(Boolean)
    : [];
  if (!current || !next) return Object.freeze({ ok: false, blocker: 'CANONICAL_MAILBOX_SUCCESSOR_INVALID' });
  if (current !== CANONICAL_MAILBOX_ISSUE) return Object.freeze({ ok: false, blocker: 'CANONICAL_MAILBOX_CURRENT_ISSUE_MISMATCH' });
  if (next === current) return Object.freeze({ ok: false, blocker: 'CANONICAL_MAILBOX_SUCCESSOR_SAME_AS_CURRENT' });
  if (retired.includes(next)) return Object.freeze({ ok: false, blocker: 'CANONICAL_MAILBOX_SUCCESSOR_RETIRED' });
  return Object.freeze({
    ok: true,
    blocker: '',
    currentIssue: current,
    nextIssue: next,
    preservesSingleCanonicalAuthority: true,
  });
}
