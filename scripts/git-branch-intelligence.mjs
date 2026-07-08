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

function bool(value) { return value === true || value === 'true'; }
function array(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

export const BUILD_LANE_MANAGER_SCHEMA = 'stephanos.build-lane-manager.v1';
export const CAPTAINS_BRIDGE_MILESTONE = Object.freeze({
  id: 'captains-bridge-v1',
  title: "Captain's Bridge V1",
  goal: 'Make Stephan feel like the captain, not the click worker.',
  implementedGoals: ['G10', 'G11', 'G12'],
  plannedGoals: ['G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G19'],
});
export const CAPTAINS_BRIDGE_GOALS = Object.freeze([
  ['G10', 'Build Lane Manager', 'implemented_guarded'],
  ['G11', 'Live Goal Dashboard', 'implemented_guarded'],
  ['G12', 'Professional Ignition Cockpit', 'implemented_guarded'],
  ['G13', 'Automatic Build Orchestrator', 'planned_guarded'],
  ['G14', 'Merge Pipeline', 'planned_guarded'],
  ['G15', 'Runtime Health Observatory', 'planned_guarded'],
  ['G16', 'Operator Timeline', 'planned_guarded'],
  ['G17', 'Workspace Auto Discovery', 'planned_guarded'],
  ['G18', 'Visual Mission Control', 'planned_guarded'],
  ['G19', 'Self-Explaining Stephanos', 'planned_guarded'],
]);

export function projectBuildLaneManager(input = {}) {
  const proofPackets = array(input.proofPackets);
  const queueRecords = array(input.queueRecords);
  const lanes = array(input.worktrees).map((worktree, index) => {
    const branch = safeRef(worktree.branch || worktree.headRef || '');
    const headSha = text(worktree.headSha || worktree.head || worktree.sha);
    const pr = worktree.pr || array(input.pullRequests).find((candidate) => text(candidate.headRefName || candidate.branch || candidate.head) === branch) || null;
    const goalLinks = array(worktree.goalLinks || worktree.goals || (pr?.goal ? [pr.goal] : []));
    const latestProof = proofPackets
      .filter((packet) => [packet.branch, packet.headSha, packet.prNumber, packet.goalId].some((value) => [branch, headSha, pr?.number, ...goalLinks].map(String).includes(String(value))))
      .sort((a, b) => Date.parse(b.completedAtUtc || b.timestampUtc || 0) - Date.parse(a.completedAtUtc || a.timestampUtc || 0))[0] || null;
    const dirty = bool(worktree.dirty) || array(worktree.dirtyPaths).length > 0;
    const queueRecord = queueRecords.find((record) => text(record.branch) === branch || String(record.issueNumber || '') === String(pr?.number || '').replace(/^#/, '')) || null;
    const mergeState = text(worktree.mergeState || pr?.mergeStateStatus || pr?.mergeableState || 'UNKNOWN', 'UNKNOWN');
    const blockers = [];
    if (!branch || branch === 'HEAD') blockers.push('detached-or-unknown-branch');
    if (!headSha) blockers.push('missing-head-sha');
    if (dirty) blockers.push('dirty-worktree');
    if (!latestProof) blockers.push('latest-proof-unknown');
    if (/dirty|blocked|conflict/i.test(mergeState)) blockers.push(`merge-state-${mergeState}`);
    const mergeReady = blockers.length === 0 && /clean|ready|mergeable|has_hooks/i.test(mergeState);
    return Object.freeze({
      laneId: text(worktree.laneId || worktree.path || branch || `lane-${index + 1}`),
      worktreePath: text(worktree.path || worktree.worktreePath),
      branch,
      upstream: safeRef(worktree.upstream || worktree.upstreamBranch || ''),
      prNumber: pr?.number || pr?.prNumber || worktree.prNumber || null,
      prTitle: text(pr?.title || worktree.prTitle),
      headSha,
      headShortSha: short(headSha),
      goalLinks,
      mergeState,
      dirty,
      dirtyPaths: array(worktree.dirtyPaths).sort(),
      queueState: text(queueRecord?.status || worktree.queueState || 'UNKNOWN', 'UNKNOWN'),
      latestProof: latestProof ? { status: text(latestProof.status || latestProof.finalVerdict, 'UNKNOWN'), command: text(latestProof.command), completedAtUtc: text(latestProof.completedAtUtc || latestProof.timestampUtc), proofRef: text(latestProof.proofRef || latestProof.path) } : { status: 'UNKNOWN', command: '', completedAtUtc: '', proofRef: '' },
      blocker: blockers[0] || '',
      blockers,
      mergeReady,
      nextAction: blockers.length ? `Resolve ${blockers[0]} before captain approval.` : 'Review exact head and proof packet; operator may approve next guarded action.',
    });
  }).sort((a, b) => a.laneId.localeCompare(b.laneId));
  const activeLane = lanes.find((lane) => lane.branch === safeRef(input.currentBranch || input.activeBranch)) || lanes.find((lane) => lane.queueState === 'running' || lane.queueState === 'active') || lanes[0] || null;
  return Object.freeze({
    schema: BUILD_LANE_MANAGER_SCHEMA,
    milestone: CAPTAINS_BRIDGE_MILESTONE,
    goals: CAPTAINS_BRIDGE_GOALS.map(([id, title, status]) => ({ id, title, status })),
    readOnly: true,
    discoveryMode: 'read-only',
    safetyLocks: { arbitraryShell: false, gitResetHard: false, branchDeletion: false, autoPush: false, autoMerge: false },
    activeLane,
    lanes,
    queueState: text(input.queueState || activeLane?.queueState || 'UNKNOWN', 'UNKNOWN'),
    mergeReadiness: activeLane?.mergeReady ? 'READY_FOR_EXACT_HEAD_OPERATOR_REVIEW' : 'HELD',
    latestProofState: activeLane?.latestProof?.status || 'UNKNOWN',
    exactNextAction: activeLane?.nextAction || 'Discover active worktrees before claiming a live build lane.',
    finalVerdict: lanes.length ? 'BUILD_LANE_MANAGER_PROJECTED_READ_ONLY' : 'BUILD_LANE_MANAGER_NO_LANES_DISCOVERED',
  });
}
