import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER,
} from './directOperatorIntentGithubCommentV1.mjs';
import {
  resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1,
} from './directOperatorIntentGithubCommentBattleBridgeV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';

function receipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.direct-operator-intent-standing-authority.v1',
    repository,
    operator: 'Cheekyfellastef',
    requestId: 'chatgpt-20261004-autonomous-build-closure-v1',
    goalId: 'goal-1903',
    originSurface: 'chatgpt',
    intent: 'Close the autonomous build continuation loop.',
    directOperatorRequest: true,
    boundedScope: true,
    requestedOutcome: 'build-test-review-protected-merge-guarded-live',
    autoProtectedMergeRequested: true,
    guardedLiveUpdateRequested: true,
    requiresNewSensitiveAuthority: false,
    revoked: false,
    ...overrides,
  };
}

function ownerComment(id = 5984364946, bodyReceipt = receipt()) {
  return {
    id,
    issue_url: `https://api.github.com/repos/${repository}/issues/1903`,
    user: { login: 'Cheekyfellastef' },
    author_association: 'OWNER',
    created_at: '2026-10-04T21:10:00Z',
    body: `${DIRECT_OPERATOR_INTENT_GITHUB_COMMENT_MARKER}
\`\`\`stephanos-direct-operator-intent
${JSON.stringify(bodyReceipt)}
\`\`\``,
  };
}

function runWith({ comments = [ownerComment()], issueComments = comments.length } = {}) {
  return (_exe, args) => {
    const endpoint = args[1];
    if (endpoint === `repos/${repository}/issues/1903`) {
      return {
        status: 0,
        stdout: JSON.stringify({
          number: 1903,
          repository_url: `https://api.github.com/repos/${repository}`,
          comments: issueComments,
        }),
      };
    }
    if (endpoint.startsWith(`repos/${repository}/issues/1903/comments?`)) {
      return { status: 0, stdout: JSON.stringify(comments) };
    }
    return { status: 1, stderr: 'unexpected endpoint' };
  };
}

test('fixed Battle Bridge adapter revalidates current owner-authenticated intent from GitHub', () => {
  const result = resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1(
    { issueNumber: 1903 },
    { githubCli: 'gh.exe', runCommand: runWith() },
  );
  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.evidence.commentId, 5984364946);
  assert.equal(result.evidence.authority.protectedExactHeadMergeEligible, true);
});

test('GitHub observation failure never falls back to local workspace authority', () => {
  const result = resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1(
    { issueNumber: 1903 },
    {
      githubCli: 'gh.exe',
      runCommand: () => ({ status: 1, stderr: 'offline' }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.evidence, null);
  assert.equal(result.blocker, 'direct-intent-github-read-failed');
});

test('latest revocation observed from GitHub blocks protected continuation', () => {
  const granted = ownerComment(10);
  const revoked = {
    ...ownerComment(11, receipt({ requestId: 'chatgpt-20261004-revoke', revoked: true })),
    created_at: '2026-10-04T22:00:00Z',
  };
  const result = resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1(
    { issueNumber: 1903 },
    { githubCli: 'gh.exe', runCommand: runWith({ comments: [granted, revoked] }) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.evidence.commentId, 11);
  assert.ok(result.evidence.blockers.includes('authorization-revoked'));
});

test('oversized comment estate fails closed rather than silently truncating authority evidence', () => {
  const result = resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1(
    { issueNumber: 1903 },
    { githubCli: 'gh.exe', runCommand: runWith({ issueComments: 2001 }) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'direct-intent-github-comment-window-exceeded');
});
