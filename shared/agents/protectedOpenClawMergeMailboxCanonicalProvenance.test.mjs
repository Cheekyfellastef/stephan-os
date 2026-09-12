import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
  buildProtectedOpenClawMergePlan,
  buildProtectedOperatorWorkflowDispatchArgs,
  resolveProtectedOperatorAuthorizationCommentId,
} from './protectedOpenClawMergeMailboxAdapter.mjs';

const head = '1'.repeat(40);
const base = '2'.repeat(40);
const reviewDigest = `sha256:${'3'.repeat(64)}`;
const payloadDigest = '4'.repeat(64);
const approvalToken = `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:2178:${head}`;

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'backend-cold-start-protected-merge-2178-test',
    operation: 'EXECUTE_PROTECTED_OPENCLAW_PR_MERGE',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: head,
    expectedBase: base,
    prNumber: 2178,
    reviewRunId: 34649924434,
    reviewRunAttempt: 1,
    reviewJobId: 103429440595,
    reviewArtifactId: 10283247994,
    reviewArtifactDigest: reviewDigest,
    reviewPayloadSha256: payloadDigest,
    reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
    reviewFindingCode: '',
    mergeMethod: 'squash',
    mergeApprovalToken: approvalToken,
    expiresAt: '2026-09-11T23:30:00.000Z',
    ...overrides,
  };
}

function plan() {
  const result = buildProtectedOpenClawMergePlan(command(), {
    now: new Date('2026-09-11T22:00:00.000Z'),
    userProfile: 'C:\\Users\\Stef',
  });
  assert.equal(result.ok, true);
  return result;
}

function comment(id, payload = command(), overrides = {}) {
  return {
    id,
    issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/2158',
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`stephanos-battle-bridge-command\n${JSON.stringify(payload)}\n\`\`\``,
    ...overrides,
  };
}

test('canonical protected merge resolves only the exact owner-authored #2158 command', () => {
  const exactPlan = plan();
  const comments = [
    comment(100, command({ requestId: 'different-request-id' })),
    comment(101, command(), { user: { login: 'someone-else' } }),
    comment(102, command({ expectedHead: '5'.repeat(40) })),
    comment(103),
  ];
  assert.equal(resolveProtectedOperatorAuthorizationCommentId(comments, exactPlan), 103);
});

test('canonical protected merge fails closed when exact provenance is absent', () => {
  const exactPlan = plan();
  assert.equal(resolveProtectedOperatorAuthorizationCommentId([], exactPlan), 0);
  assert.equal(resolveProtectedOperatorAuthorizationCommentId([
    comment(200, command({ expectedBase: '6'.repeat(40) })),
  ], exactPlan), 0);
});

test('protected workflow dispatch always carries the exact authorization comment id', () => {
  const exactPlan = plan();
  const args = buildProtectedOperatorWorkflowDispatchArgs(
    exactPlan,
    { head: { ref: 'fix/backend-cold-start-health-v1' } },
    '7'.repeat(40),
    5640927439,
  );
  assert.ok(Array.isArray(args));
  assert.ok(args.includes('authorization_comment_id=5640927439'));
  assert.equal(buildProtectedOperatorWorkflowDispatchArgs(
    exactPlan,
    { head: { ref: 'fix/backend-cold-start-health-v1' } },
    '7'.repeat(40),
    0,
  ), null);
});
