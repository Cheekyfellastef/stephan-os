const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;

function text(value) { return String(value || '').trim(); }
function short(value) { return text(value).slice(0, 12); }
function safeRef(value) { const ref = text(value); return SAFE_BRANCH.test(ref) ? ref : ''; }

function findAssociatedPr({ currentBranch, pullRequests = [] }) {
  return pullRequests.find((pr) => text(pr.headRefName || pr.branch || pr.head) === currentBranch) || null;
}

export function projectGitBranchIntelligence(input = {}) {
  const currentBranch = safeRef(input.currentBranch || input.branch);
  const upstreamBranch = safeRef(input.upstreamBranch || input.upstream);
  const remoteBranch = safeRef(input.remoteBranch || (upstreamBranch.startsWith('origin/') ? upstreamBranch : (currentBranch ? `origin/${currentBranch}` : '')));
  const hasUpstream = input.hasUpstream ?? Boolean(upstreamBranch);
  const remoteExists = input.remoteExists ?? Boolean(upstreamBranch || input.remoteBranchExists);
  const associatedPr = input.associatedPr || findAssociatedPr({ currentBranch, pullRequests: input.pullRequests || [] });
  const prNumber = associatedPr?.number || associatedPr?.prNumber || null;
  const prTitle = text(associatedPr?.title);
  const ambiguous = !currentBranch || currentBranch === 'HEAD' || !safeRef(currentBranch) || (upstreamBranch && !upstreamBranch.startsWith('origin/'));
  const blockers = [];
  if (!currentBranch || currentBranch === 'HEAD') blockers.push('detached-or-unknown-current-branch');
  if (upstreamBranch && !upstreamBranch.startsWith('origin/')) blockers.push('non-origin-upstream-ambiguous');

  let safestExactPushCommand = '';
  let pushProjection = 'BLOCKED_AMBIGUOUS';
  let exactNextAction = 'Resolve branch/upstream ambiguity before pushing. Do not auto-push.';

  if (!ambiguous && !hasUpstream) {
    safestExactPushCommand = `git push --set-upstream origin ${currentBranch}`;
    pushProjection = 'CREATES_REMOTE_BRANCH_AND_NEW_PR_CANDIDATE';
    exactNextAction = `After operator approval, run: ${safestExactPushCommand}`;
  } else if (!ambiguous && hasUpstream && remoteExists) {
    safestExactPushCommand = `git push origin HEAD:${remoteBranch.replace(/^origin\//, '')}`;
    pushProjection = prNumber ? 'UPDATES_EXISTING_PR' : 'UPDATES_REMOTE_BRANCH_OR_CREATES_PR_CANDIDATE';
    exactNextAction = prNumber
      ? `After operator approval, run: ${safestExactPushCommand} (updates PR #${prNumber}).`
      : `After operator approval, run: ${safestExactPushCommand}; open a PR if one is not already associated.`;
  }

  return {
    schema: 'stephanos.git-branch-intelligence.v1',
    currentBranch,
    upstreamBranch,
    remoteBranch,
    associatedPr: associatedPr ? { number: prNumber, title: prTitle, url: text(associatedPr.url) } : null,
    pushProjection,
    safestExactPushCommand,
    blocksAmbiguousPushDestination: blockers.length > 0,
    blockers,
    exactNextAction,
    safetyLocks: { autoPush: false, autoMerge: false, branchDeletion: false, arbitraryShell: false },
  };
}
