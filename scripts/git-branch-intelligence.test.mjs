import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGitBranchIntelligence } from './git-branch-intelligence.mjs';

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
