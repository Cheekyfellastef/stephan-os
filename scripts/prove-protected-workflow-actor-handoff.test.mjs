import { CANONICAL_MAILBOX_ISSUE as activeMailboxIssueForTest } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { proveProtectedWorkflowActorHandoff } from './prove-protected-workflow-actor-handoff.mjs';
import { buildProtectedWorkflowDispatchRequest, PROTECTED_WORKFLOW_DISPATCH_SCHEMA } from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';

const command = {
  schemaVersion: PROTECTED_WORKFLOW_DISPATCH_SCHEMA, requestId: 'actor-handoff-test-3085',
  operation: 'DISPATCH_PROTECTED_OPERATOR_MERGE', repository: 'Cheekyfellastef/stephan-os',
  issueNumber: activeMailboxIssueForTest, operatorApproval: 'operator-approved', expiresAt: '2026-10-13T00:12:00Z',
  mode: 'user-owned-protected-squash', prNumber: 3085,
  expectedBranch: 'repair/2961-original-owner-recovery-handoff-20261013',
  expectedHead: '7e9a6893371d229d7d8f50f6c454a90ebf415ed5',
  expectedHeadTree: '00fb462151a83ed9988ba57c9e6d6f39cdd64207',
  expectedBase: '93523c7941eca31fe3105fe97863073341c0d9b0',
  independentReviewRunId: 38323153264, independentReviewRunAttempt: 1,
  independentReviewArtifactId: 11779577383,
  independentReviewArtifactDigest: 'sha256:02f6b70c4f5893758544864f8aa2542116ad394f8aab8b52ae6f99ec36e5d63b',
  independentReviewPayloadSha256: '6dfcb3a110b5580a94e208bca4605110a200a8293f18c8682f005c24f60341a7',
};
const comment = {
  id: 6134973687, user: { login: 'Cheekyfellastef', id: 267490109, type: 'User' },
  issue_url: `https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/${activeMailboxIssueForTest}`,
  created_at: '2026-10-13T00:03:11Z', updated_at: '2026-10-13T00:03:11Z',
  body: '```stephanos-protected-workflow-dispatch\n' + JSON.stringify(command) + '\n```',
};
const event = { repository: { full_name: command.repository }, inputs: buildProtectedWorkflowDispatchRequest(command, { authorizationCommentId: comment.id }).body.inputs };
const run = {
  event: 'workflow_dispatch', repository: event.repository, head_branch: 'main', head_sha: command.expectedBase,
  path: '.github/workflows/operator-merge-approval-gate.yml', run_attempt: 1,
  created_at: '2026-10-13T00:03:25Z', triggering_actor: { login: 'github-actions[bot]', id: 41898282 },
};

test('mailbox request survives bot transport through admission and immutable post-approval reproof', async () => {
  const readComment = async (id) => { assert.equal(id, comment.id); return comment; };
  const initial = await proveProtectedWorkflowActorHandoff({ event, run, readComment });
  const final = await proveProtectedWorkflowActorHandoff({ event, run, readComment, expectedCommentSha256: initial.authorization.commentSha256 });
  assert.deepEqual(final.authorization, initial.authorization);
  assert.equal(final.authorization.operatorAuthor, 'Cheekyfellastef');
  assert.equal(final.authorization.transportActor, 'github-actions[bot]');
  await assert.rejects(proveProtectedWorkflowActorHandoff({ event, run,
    readComment: async () => ({ ...comment, body: comment.body + '\nchanged' }),
    expectedCommentSha256: initial.authorization.commentSha256,
  }), /COMMENT_DIGEST_MISMATCH/);
});

test('reruns, unrelated carrier workflows and stale review inputs cannot pick up the command', async () => {
  for (const mutation of [
    { run_attempt: 2 }, { event: 'issue_comment' }, { head_branch: 'feature' },
    { head_sha: 'a'.repeat(40) }, { path: '.github/workflows/unrelated.yml' },
    { repository: { full_name: 'other/repo' } }, { triggering_actor: { login: 'lookalike' } },
    { created_at: '2026-10-13T00:12:01Z' },
  ]) await assert.rejects(proveProtectedWorkflowActorHandoff({ event, run: { ...run, ...mutation }, readComment: async () => comment }));
  await assert.rejects(proveProtectedWorkflowActorHandoff({
    event: { ...event, inputs: { ...event.inputs, independent_review_run_id: '123' } }, run, readComment: async () => comment,
  }), /IDENTITY_MISMATCH/);
});

test('all merge stages use owner-comment provenance while ready stays owner-only and the protected environment remains binding', () => {
  const workflow = readFileSync(new URL('../.github/workflows/operator-merge-approval-gate.yml', import.meta.url), 'utf8');
  const executor = readFileSync(new URL('./operator-protected-personal-repository-merge.mjs', import.meta.url), 'utf8');
  const dispatcher = readFileSync(new URL('./dispatch-protected-merge-from-mailbox.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /environment: operator-merge-approval/);
  assert.match(workflow, /authorization_comment_sha256: \$\{\{ steps\.authorization\.outputs/);
  assert.match(workflow, /STEPHANOS_AUTHORIZATION_COMMENT_SHA256: \$\{\{ needs\.personal-repository-evidence\.outputs/);
  assert.match(workflow, /OPERATOR_AUTHOR: \$\{\{ needs\.personal-repository-evidence\.outputs/);
  assert.match(workflow, /test "\$\{TRIGGERING_ACTOR}" = 'Cheekyfellastef'/);
  assert.doesNotMatch(workflow + executor, /GITHUB_TRIGGERING_ACTOR\s*[:=]\s*['"]?Cheekyfellastef/);
  assert.match(executor, /proveProtectedWorkflowActorHandoff/);
  assert.match(dispatcher, /GITHUB_RUN_ATTEMPT !== '1'/);
  assert.match(dispatcher, /protectedWorkflowAuthorizationCommentSha256\(event\.comment\)/);
});
