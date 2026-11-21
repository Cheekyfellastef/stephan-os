const BLOCKED = 'blocked';
const OPEN_PR_STATES = new Set(['open']);
const CLOSED_PR_STATES = new Set(['closed', 'merged']);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function issueToken(issueNumber) {
  return new RegExp(`(^|[^0-9])#${issueNumber}([^0-9]|$)`);
}

function referencesIssue(pr, issueNumber) {
  if (list(pr.implementsIssues).map(String).includes(String(issueNumber))) return true;
  if (list(pr.activeImplementationFor).map(String).includes(String(issueNumber))) return true;
  if (text(pr.activeImplementationFor) === String(issueNumber)) return true;
  const haystack = [pr.title, pr.body, pr.summary, pr.claim].map(text).join('\n');
  return issueToken(issueNumber).test(haystack);
}

function prState(pr) {
  return text(pr.state || pr.status).toLowerCase();
}

function isOpen(pr) {
  return OPEN_PR_STATES.has(prState(pr));
}

function isClosed(pr) {
  return CLOSED_PR_STATES.has(prState(pr));
}

function hasHeadDrift(pr) {
  const claimed = text(pr.claimedHeadSha || pr.claimedHead || pr.claimed_head_sha);
  const actual = text(pr.actualHeadSha || pr.headSha || pr.headRefOid || pr.actual_head_sha);
  return Boolean(claimed && actual && claimed !== actual);
}

function hasClaimedHeadDriftBlocker(pr) {
  const blockers = [...list(pr.blockers), ...list(pr.evidence?.blockers)].map((blocker) => text(blocker).toLowerCase());
  return blockers.some((blocker) => /claimed[-\s]?head|head sha|head drift/.test(blocker) && /drift|changed|mismatch|stale|block/.test(blocker));
}

function hasRuntimeBlocker(item) {
  const blockers = [...list(item.blockers), ...list(item.evidence?.blockers)].map((blocker) => text(blocker).toLowerCase());
  return blockers.some((blocker) => blocker.includes('runtime')) || text(item.runtimeStatus || item.runtime).toLowerCase().includes('blocked');
}

function hasReviewEvidence(pr) {
  const state = text(pr.reviewState || pr.review || pr.reviewDecision).toLowerCase();
  if (['approved', 'changes_requested', 'review_required', 'waiting-for-review', 'waiting_for_review'].includes(state)) return true;
  return list(pr.reviews).length > 0 || Boolean(pr.reviewRequested || pr.readyForReview || pr.isReadyForReview);
}

function prStatus(pr) {
  if (hasHeadDrift(pr) || hasClaimedHeadDriftBlocker(pr)) return { status: BLOCKED, reason: 'claimed-head drift blocked' };
  if (hasRuntimeBlocker(pr)) return { status: BLOCKED, reason: 'runtime-blocked' };
  if (pr.ready === true || text(pr.status).toLowerCase() === 'ready') return { status: 'ready', reason: 'ready' };
  if (isOpen(pr)) return { status: 'open', reason: prState(pr) };
  if (isClosed(pr)) return { status: 'closed', reason: prState(pr) };
  return { status: 'unknown', reason: prState(pr) || 'missing-state' };
}

export function buildGitHubOperatorBriefing(input) {
  const pullRequests = list(input.pullRequests || input.prs);
  const issues = list(input.issues);
  const prBriefs = pullRequests.map((pr) => ({ number: Number(pr.number), title: text(pr.title), ...prStatus(pr) }));
  const issueBriefs = issues.map((issue) => {
    const number = Number(issue.number);
    const blockers = list(issue.blockers).map(text).filter(Boolean);
    if (hasRuntimeBlocker(issue)) return { number, status: BLOCKED, reason: 'runtime-blocked', blockers };

    const implementationPrs = pullRequests.filter((pr) => isOpen(pr) && referencesIssue(pr, number));
    if (implementationPrs.length > 0) {
      const hasBlockedImplementation = implementationPrs.some((pr) => prStatus(pr).status === BLOCKED);
      if (hasBlockedImplementation) return { number, status: BLOCKED, reason: 'active implementation PR blocked', activeImplementationPrs: implementationPrs.map((pr) => Number(pr.number)), blockers };
      const reviewReady = implementationPrs.some(hasReviewEvidence);
      return {
        number,
        status: reviewReady ? 'waiting-for-review' : 'implementation-in-progress',
        reason: `active implementation PR ${implementationPrs.map((pr) => `#${pr.number}`).join(', ')}`,
        activeImplementationPrs: implementationPrs.map((pr) => Number(pr.number)),
        blockers,
      };
    }
    return { number, status: 'waiting-for-implementation', reason: 'no active implementation PR evidence', blockers };
  });
  return { finalVerdict: 'GITHUB_OPERATOR_BRIEFING_READY', pullRequests: prBriefs, issues: issueBriefs };
}

export function renderGitHubOperatorBriefing(briefing, { human = false } = {}) {
  if (!human) return JSON.stringify(briefing, null, 2);
  const lines = ['GitHub Operator Briefing', 'Pull requests:'];
  for (const pr of briefing.pullRequests) lines.push(`- #${pr.number}: ${pr.status} (${pr.reason}) ${pr.title}`.trim());
  lines.push('Issues:');
  for (const issue of briefing.issues) lines.push(`- #${issue.number}: ${issue.status} (${issue.reason})`);
  return `${lines.join('\n')}\n`;
}
