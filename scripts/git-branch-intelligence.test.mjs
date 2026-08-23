import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGitBranchIntelligence, projectBuildLaneManager } from './git-branch-intelligence.mjs';

test('unknown upstream blocks push advice', () => {
  const intel = projectGitBranchIntelligence({ currentBranch: 'feature/x', upstreamBranch: 'fork/x', hasUpstream: true });
  assert.equal(intel.blocksAmbiguousPushDestination, true);
  assert.equal(intel.safestExactPushCommand, '');
  assert.equal(intel.pushProjection, 'BLOCKED_AMBIGUOUS');
});

test('branch with no upstream shows safe set-upstream command', () => {
  const intel = projectGitBranchIntelligence({ currentBranch: 'feature/no-upstream', hasUpstream: false });
  assert.equal(intel.blocksAmbiguousPushDestination, false);
  assert.equal(intel.safestExactPushCommand, 'git push --set-upstream origin feature/no-upstream');
  assert.equal(intel.pushProjection, 'CREATES_REMOTE_BRANCH_AND_NEW_PR_CANDIDATE');
});

test('associated PR projection if branch matches PR metadata', () => {
  const intel = projectGitBranchIntelligence({
    currentBranch: 'feature/g8-g9',
    upstreamBranch: 'origin/feature/g8-g9',
    hasUpstream: true,
    pullRequests: [{ number: 1440, headRefName: 'feature/g8-g9', title: 'Add G8/G9 proof' }],
  });
  assert.equal(intel.associatedPr.number, 1440);
  assert.equal(intel.associatedPr.title, 'Add G8/G9 proof');
  assert.equal(intel.pushProjection, 'UPDATES_EXISTING_PR');
  assert.equal(intel.safestExactPushCommand, 'git push origin HEAD:feature/g8-g9');
});

test('build lane manager projects active worktree state without mutation powers', () => {
  const projection = projectBuildLaneManager({
    currentBranch: 'feature/captains-bridge',
    queueState: 'active',
    worktrees: [{ path: '/repo', branch: 'feature/captains-bridge', upstream: 'origin/feature/captains-bridge', headSha: 'abcdef1234567890', dirtyPaths: [], mergeState: 'CLEAN', goalLinks: ['G10', 'G11'] }],
    pullRequests: [{ number: 1510, headRefName: 'feature/captains-bridge', title: "Captain's Bridge V1" }],
    proofPackets: [{ branch: 'feature/captains-bridge', headSha: 'abcdef1234567890', status: 'passed', command: 'node --test shared/agents/*.test.mjs', completedAtUtc: '2026-07-08T00:00:00.000Z' }],
  });
  assert.equal(projection.readOnly, true);
  assert.equal(projection.safetyLocks.autoMerge, false);
  assert.equal(projection.activeLane.prNumber, 1510);
  assert.equal(projection.activeLane.headShortSha, 'abcdef123456');
  assert.equal(projection.activeLane.latestProof.status, 'passed');
  assert.equal(projection.mergeReadiness, 'READY_FOR_EXACT_HEAD_OPERATOR_REVIEW');
  assert.deepEqual(projection.goals.map((goal) => goal.id), ['G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G19']);
});

test('build lane manager blocks dirty lanes and unknown proof', () => {
  const projection = projectBuildLaneManager({ worktrees: [{ path: '/repo', branch: 'feature/dirty', headSha: '1111222233334444', dirtyPaths: ['src/app.js'], mergeState: 'UNKNOWN' }] });
  assert.equal(projection.activeLane.dirty, true);
  assert.match(projection.activeLane.blocker, /dirty-worktree|latest-proof-unknown/);
  assert.equal(projection.mergeReadiness, 'HELD');
});
