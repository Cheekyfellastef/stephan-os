import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGitHubOperatorBriefing } from '../shared/agents/githubOperatorBriefing.mjs';

const fixture = {
  pullRequests: [
    { number: 1448, title: 'Ready implementation', state: 'open', ready: true },
    { number: 1444, title: 'Runtime blocked implementation', state: 'open', runtimeStatus: 'blocked', blockers: ['runtime proof missing'] },
    { number: 1447, title: 'Claimed-head drift sample', state: 'open', claimedHeadSha: 'abc123', actualHeadSha: 'def456' },
    { number: 1449, title: 'Implement operator automation layer for #1286', state: 'open', implementsIssues: [1286], readyForReview: true, reviewState: 'review_required' },
  ],
  issues: [
    { number: 1286, title: 'Operator automation layer' },
  ],
};

function issueForPullRequest(pr) {
  return buildGitHubOperatorBriefing({ pullRequests: [pr], issues: [{ number: 1286 }] }).issues[0];
}

test('briefing preserves blockers and recognizes active implementation PRs', () => {
  const briefing = buildGitHubOperatorBriefing(fixture);
  assert.equal(briefing.pullRequests.find((pr) => pr.number === 1448).status, 'ready');
  assert.deepEqual(briefing.pullRequests.find((pr) => pr.number === 1444), {
    number: 1444,
    title: 'Runtime blocked implementation',
    status: 'blocked',
    reason: 'runtime-blocked',
  });
  assert.equal(briefing.pullRequests.find((pr) => pr.number === 1447).reason, 'claimed-head drift blocked');
  const issue = briefing.issues.find((candidate) => candidate.number === 1286);
  assert.equal(issue.status, 'waiting-for-review');
  assert.deepEqual(issue.activeImplementationPrs, [1449]);
});

test('active implementation PR without review evidence is implementation-in-progress', () => {
  const input = { pullRequests: [{ number: 1449, state: 'open', body: 'Implements #1286' }], issues: [{ number: 1286 }] };
  const issue = buildGitHubOperatorBriefing(input).issues[0];
  assert.equal(issue.status, 'implementation-in-progress');
});

test('missing state does not count as active implementation PR', () => {
  const issue = issueForPullRequest({ number: 1450, body: 'Implements #1286' });
  assert.equal(issue.status, 'waiting-for-implementation');
  assert.equal(issue.reason, 'no active implementation PR evidence');
});

test('unknown state does not count as active implementation PR', () => {
  const issue = issueForPullRequest({ number: 1450, state: 'unknown', body: 'Implements #1286' });
  assert.equal(issue.status, 'waiting-for-implementation');
});

test('closed state does not count as active implementation PR', () => {
  const issue = issueForPullRequest({ number: 1450, state: 'closed', body: 'Implements #1286' });
  assert.equal(issue.status, 'waiting-for-implementation');
});

test('merged state does not count as active implementation PR', () => {
  const issue = issueForPullRequest({ number: 1450, state: 'merged', body: 'Implements #1286' });
  assert.equal(issue.status, 'waiting-for-implementation');
});

test('explicit open state counts as active implementation PR', () => {
  const issue = issueForPullRequest({ number: 1450, state: 'open', body: 'Implements #1286' });
  assert.equal(issue.status, 'implementation-in-progress');
  assert.deepEqual(issue.activeImplementationPrs, [1450]);
});

test('claimed-head drift blocker string blocks active implementation PR', () => {
  const issue = issueForPullRequest({
    number: 1450,
    state: 'open',
    body: 'Implements #1286',
    blockers: ['Claimed-head drift blocked: current PR head changed after approval.'],
  });
  assert.equal(issue.status, 'blocked');
  assert.equal(issue.reason, 'active implementation PR blocked');
  assert.deepEqual(issue.activeImplementationPrs, [1450]);
});
