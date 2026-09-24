import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeGithubGoalIssue,
  readGithubGoalIssue,
} from './githubPrEvidenceService.js';

const OWNER = 'Cheekyfellastef';
const REPO = 'stephan-os';

function auth() {
  return { configured: true, token: 'test-token', authority: 'test' };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test('GitHub goal close adapter is hard-bound to completed issue-state PATCH', async () => {
  const calls = [];
  const result = await closeGithubGoalIssue({
    owner: OWNER,
    repo: REPO,
    issueNumber: 4242,
    auth: auth(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({
        number: 4242,
        state: 'closed',
        state_reason: 'completed',
        title: 'Goal: test',
        labels: [{ name: 'goal' }],
      });
    },
  });

  assert.equal(result.number, 4242);
  assert.equal(result.state, 'closed');
  assert.equal(result.state_reason, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/4242');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    state: 'closed',
    state_reason: 'completed',
  });
});

test('GitHub goal close adapter fails closed when API does not confirm completed reason', async () => {
  const result = await closeGithubGoalIssue({
    owner: OWNER,
    repo: REPO,
    issueNumber: 4242,
    auth: auth(),
    fetchImpl: async () => response({
      number: 4242,
      state: 'closed',
      state_reason: 'not_planned',
      labels: [{ name: 'goal' }],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'GITHUB_GOAL_ISSUE_CLOSE_UNCONFIRMED');
});

test('GitHub goal read adapter preserves live goal label and PR-shape evidence', async () => {
  const result = await readGithubGoalIssue({
    owner: OWNER,
    repo: REPO,
    issueNumber: 4242,
    auth: auth(),
    fetchImpl: async () => response({
      number: 4242,
      state: 'open',
      state_reason: null,
      title: 'Goal: test',
      labels: [{ name: 'goal' }],
      pull_request: null,
    }),
  });
  assert.equal(result.number, 4242);
  assert.equal(result.state, 'open');
  assert.deepEqual(result.labels, [{ name: 'goal' }]);
  assert.equal(result.pull_request, null);
});

test('GitHub goal mutation adapter rejects every non-canonical repository before network use', async () => {
  let calls = 0;
  const result = await closeGithubGoalIssue({
    owner: 'Cheekyfellastef',
    repo: 'other-repo',
    issueNumber: 4242,
    auth: auth(),
    fetchImpl: async () => { calls += 1; return response({}); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CANONICAL_GOAL_ISSUE_IDENTITY_REQUIRED');
  assert.equal(calls, 0);
});
