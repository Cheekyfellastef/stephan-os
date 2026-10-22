import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_PATH,
  validateProtectedWorkflowActorHandoff,
} from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';

export async function proveProtectedWorkflowActorHandoff({ event, run, readComment, expectedCommentSha256 = '' }) {
  const inputs = event?.inputs || {};
  if (event?.repository?.full_name !== PROTECTED_WORKFLOW_DISPATCH_REPOSITORY
    || run?.repository?.full_name !== PROTECTED_WORKFLOW_DISPATCH_REPOSITORY
    || run?.event !== 'workflow_dispatch' || run?.head_branch !== 'main'
    || run?.head_sha !== inputs.expected_base
    || run?.path !== PROTECTED_WORKFLOW_DISPATCH_PATH
    || run?.run_attempt !== 1) {
    throw new Error('PROTECTED_WORKFLOW_HANDOFF_RUN_IDENTITY_INVALID');
  }
  const commentId = Number(inputs.authorization_comment_id);
  if (!Number.isSafeInteger(commentId) || commentId < 1) {
    throw new Error('PROTECTED_WORKFLOW_AUTHORIZATION_COMMENT_ID_MISMATCH');
  }
  const comment = await readComment(commentId);
  const proof = validateProtectedWorkflowActorHandoff(comment, {
    operation: PROTECTED_WORKFLOW_DISPATCH_OPERATION,
    repository: PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    operatorApproval: 'operator-approved',
    mode: inputs.mode, prNumber: Number(inputs.pr_number), expectedBranch: inputs.expected_branch,
    expectedHead: inputs.expected_head, expectedHeadTree: inputs.expected_head_tree, expectedBase: inputs.expected_base,
    independentReviewRunId: Number(inputs.independent_review_run_id),
    independentReviewRunAttempt: Number(inputs.independent_review_run_attempt),
    independentReviewArtifactId: Number(inputs.independent_review_artifact_id),
    independentReviewArtifactDigest: inputs.independent_review_artifact_digest,
    independentReviewPayloadSha256: inputs.independent_review_payload_sha256,
  }, {
    transportActor: run?.triggering_actor?.login,
    transportActorId: run?.triggering_actor?.id,
    expectedCommentId: commentId, expectedCommentSha256,
    now: new Date(run.created_at),
  });
  if (!proof.ok) throw new Error(proof.blocker);
  return proof;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('PROTECTED_WORKFLOW_HANDOFF_ACTIONS_REQUIRED');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const runId = Number(process.env.GITHUB_RUN_ID);
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  if (!Number.isSafeInteger(runId) || runId < 1 || attempt !== 1) {
    throw new Error('PROTECTED_WORKFLOW_HANDOFF_RUN_IDENTITY_INVALID');
  }
  const api = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}${path}`, {
      redirect: 'error', headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stephanos-protected-actor-handoff-v1',
      },
    });
    if (!response.ok) throw new Error(`PROTECTED_WORKFLOW_HANDOFF_READ_FAILED:${response.status}`);
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('PROTECTED_WORKFLOW_HANDOFF_READ_TOO_LARGE');
    return JSON.parse(raw);
  };
  const run = await api(`/actions/runs/${runId}`);
  if (run.id !== runId || run.run_attempt !== attempt
    || run.triggering_actor?.login !== process.env.GITHUB_TRIGGERING_ACTOR) {
    throw new Error('PROTECTED_WORKFLOW_HANDOFF_RUN_IDENTITY_INVALID');
  }
  const proof = await proveProtectedWorkflowActorHandoff({
    event, run, readComment: (id) => api(`/issues/comments/${id}`),
    expectedCommentSha256: process.env.STEPHANOS_AUTHORIZATION_COMMENT_SHA256 || '',
  });
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries({
    authorization_comment_id: proof.commentId,
    authorization_comment_sha256: proof.authorization.commentSha256,
    authorization_request_id: proof.authorization.requestId,
    operator_author: proof.authorization.operatorAuthor,
    transport_actor: proof.authorization.transportActor,
    authorization_head: proof.materialAuthorization.authorizationHead,
    authorization_head_tree: proof.materialAuthorization.authorizationHeadTree,
    authorization_base: proof.materialAuthorization.authorizationBase,
  }).map(([key, value]) => `${key}=${value}\n`).join(''), 'utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
