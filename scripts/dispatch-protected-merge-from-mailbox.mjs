#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import {
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_MARKER,
  PROTECTED_WORKFLOW_DISPATCH_OPERATION,
  PROTECTED_WORKFLOW_READY_OPERATION,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  buildProtectedWorkflowDispatchReceipt,
  buildProtectedWorkflowDispatchRequest,
  extractProtectedWorkflowDispatch,
  validateProtectedWorkflowDispatch,
  inspectProtectedWorkflowDuplicateDispatchRuns,
  validateProtectedWorkflowActorHandoff,
  protectedWorkflowAuthorizationCommentSha256,
} from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';

const API = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-protected-workflow-dispatch-mailbox-v1';
const READY_MUTATION = 'mutation($pullRequestId:ID!){markPullRequestReadyForReview(input:{pullRequestId:$pullRequestId}){pullRequest{id number isDraft headRefOid}}}';

function text(value) { return String(value ?? '').trim(); }
function positiveInteger(value) {
  const raw = text(value);
  if (!/^[1-9][0-9]*$/.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function headers(token, body) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
    ...(body === null ? {} : { 'Content-Type': 'application/json' }),
  };
}

async function request(url, { method = 'GET', body = null, expectedStatus = 200 } = {}) {
  const token = text(process.env.GITHUB_TOKEN);
  if (!token) fail('GITHUB_TOKEN_REQUIRED');
  const response = await fetch(url, {
    method,
    redirect: 'error',
    headers: headers(token, body),
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  if (response.status !== expectedStatus) {
    fail('GITHUB_API_REQUEST_FAILED', { method, status: response.status, body: raw.slice(0, 500) });
  }
  return raw ? JSON.parse(raw) : null;
}

async function github(path, options = {}) {
  return request(`${API}${path}`, options);
}

async function graphqlReady(pullRequestId) {
  const result = await request(GRAPHQL, {
    method: 'POST',
    body: { query: READY_MUTATION, variables: { pullRequestId } },
    expectedStatus: 200,
  });
  if (!result || (Array.isArray(result.errors) && result.errors.length)) {
    fail('PROTECTED_WORKFLOW_READY_GRAPHQL_FAILED', { errors: result?.errors?.slice?.(0, 3) || [] });
  }
  return result?.data?.markPullRequestReadyForReview?.pullRequest || null;
}

function validateLivePull(pull, command, { allowDraft }) {
  if (pull?.state !== 'open' || pull?.merged === true) fail('PROTECTED_WORKFLOW_DISPATCH_PR_NOT_OPEN');
  if (Number(pull?.number) !== command.prNumber) fail('PROTECTED_WORKFLOW_DISPATCH_PR_NUMBER_CHANGED');
  if (pull?.head?.ref !== command.expectedBranch || pull?.head?.sha !== command.expectedHead) {
    fail('PROTECTED_WORKFLOW_DISPATCH_PR_HEAD_CHANGED');
  }
  if (pull?.head?.repo?.full_name !== PROTECTED_WORKFLOW_DISPATCH_REPOSITORY) {
    fail('PROTECTED_WORKFLOW_DISPATCH_PR_HEAD_REPOSITORY_CHANGED');
  }
  if (pull?.base?.ref !== 'main' || pull?.base?.sha !== command.expectedBase) {
    fail('PROTECTED_WORKFLOW_DISPATCH_PR_BASE_CHANGED');
  }
  if (pull?.base?.repo?.full_name !== PROTECTED_WORKFLOW_DISPATCH_REPOSITORY) {
    fail('PROTECTED_WORKFLOW_DISPATCH_PR_BASE_REPOSITORY_CHANGED');
  }
  if (!allowDraft && pull?.draft !== false) fail('PROTECTED_WORKFLOW_DISPATCH_PR_NOT_READY');
  if (allowDraft && pull?.draft !== true && pull?.draft !== false) fail('PROTECTED_WORKFLOW_READY_DRAFT_STATE_INVALID');
  if (!text(pull?.node_id)) fail('PROTECTED_WORKFLOW_READY_PR_NODE_ID_MISSING');
}

async function readExactState(command, { allowDraft }) {
  const [pull, branch, headCommit] = await Promise.all([
    github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/pulls/${command.prNumber}`),
    github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/branches/main`),
    github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/git/commits/${command.expectedHead}`),
  ]);
  validateLivePull(pull, command, { allowDraft });
  if (branch?.commit?.sha !== command.expectedBase) fail('PROTECTED_WORKFLOW_DISPATCH_MAIN_CHANGED');
  if (headCommit?.tree?.sha !== command.expectedHeadTree) fail('PROTECTED_WORKFLOW_DISPATCH_HEAD_TREE_CHANGED');
  return { pull, branch, headCommit };
}


const DUPLICATE_PROBE_PAGE_SIZE = 100;
const DUPLICATE_PROBE_MAX_PAGES = 6;

// The dedicated protected workflow endpoint plus an exact main/base SHA
// narrows the read to a bounded, independently fetched replay inventory.
async function rejectPriorProtectedDispatch(command) {
  let expectedTotal = null;
  const seen = new Set();
  const runs = [];
  for (let page = 1; page <= DUPLICATE_PROBE_MAX_PAGES; page += 1) {
    const result = await github(
      `/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/actions/workflows/operator-merge-approval-gate.yml/runs`
      + `?event=workflow_dispatch&head_sha=${command.expectedBase}&per_page=${DUPLICATE_PROBE_PAGE_SIZE}&page=${page}`,
    );
    if (!result || !Number.isSafeInteger(result.total_count)
        || result.total_count < 0
        || result.total_count > DUPLICATE_PROBE_PAGE_SIZE * DUPLICATE_PROBE_MAX_PAGES
        || !Array.isArray(result.workflow_runs)
        || result.workflow_runs.length > DUPLICATE_PROBE_PAGE_SIZE
        || (expectedTotal !== null && result.total_count !== expectedTotal))
      fail('PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
    expectedTotal = result.total_count;
    for (const run of result.workflow_runs) {
      if (!Number.isSafeInteger(run?.id) || run.id <= 0 || seen.has(run.id))
        fail('PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
      seen.add(run.id);
      runs.push(run);
    }
    // Never decide from a truncated first page; complete all exact-base runs.
    if (runs.length === expectedTotal) {
      let classification = inspectProtectedWorkflowDuplicateDispatchRuns(runs, command);
      const retryIds = classification.details?.retryCandidateRunIds;
      if (!classification.ok && Array.isArray(retryIds) && retryIds.length > 0) {
        const priorRunJobSets = [];
        // At most eight exact failed runs, one complete bounded all-attempt
        // job inventory each. Missing/truncated/foreign jobs remain a hold.
        for (const runId of retryIds) {
          const result = await github('/repos/' + PROTECTED_WORKFLOW_DISPATCH_REPOSITORY
            + '/actions/runs/' + runId + '/jobs?filter=all&per_page=100');
          if (!result || !Number.isSafeInteger(result.total_count)
              || result.total_count < 1 || result.total_count > 100
              || !Array.isArray(result.jobs) || result.jobs.length !== result.total_count)
            fail('PROTECTED_WORKFLOW_DISPATCH_PRIOR_JOBS_UNVERIFIABLE');
          priorRunJobSets.push({ runId, jobs: result.jobs });
        }
        classification = inspectProtectedWorkflowDuplicateDispatchRuns(runs, command, { priorRunJobSets });
      }
      if (!classification.ok) fail(classification.blocker, classification.details);
      return;
    }
    if (result.workflow_runs.length !== DUPLICATE_PROBE_PAGE_SIZE
        || runs.length > expectedTotal)
      fail('PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
  }
  fail('PROTECTED_WORKFLOW_DISPATCH_RUN_INVENTORY_UNVERIFIABLE');
}

async function postReceipt(command, lifecycleResult) {
  const receipt = buildProtectedWorkflowDispatchReceipt(command, new Date(), lifecycleResult);
  await github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/issues/${PROTECTED_WORKFLOW_DISPATCH_ISSUE}/comments`, {
    method: 'POST',
    body: {
      body: `<!-- stephanos-protected-workflow-dispatch-receipt -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``,
    },
    expectedStatus: 201,
  });
  return receipt;
}

async function main() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath) fail('GITHUB_EVENT_PATH_REQUIRED');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const issueNumber = Number(event?.issue?.number || 0);
  const authorLogin = text(event?.comment?.user?.login);
  const authorizationCommentId = positiveInteger(event?.comment?.id);
  const body = text(event?.comment?.body);
  const authoredAt = new Date(event?.comment?.created_at || 0);
  const now = new Date();

  if (issueNumber !== PROTECTED_WORKFLOW_DISPATCH_ISSUE
    || authorLogin !== PROTECTED_WORKFLOW_DISPATCH_AUTHOR
    || !body.includes(PROTECTED_WORKFLOW_DISPATCH_MARKER)) {
    console.log(JSON.stringify({ ok: true, verdict: 'PROTECTED_WORKFLOW_DISPATCH_IGNORED' }));
    return;
  }
  if (!authorizationCommentId) fail('PROTECTED_WORKFLOW_DISPATCH_AUTHORIZATION_COMMENT_ID_INVALID');
  if (process.env.GITHUB_RUN_ATTEMPT !== '1') fail('PROTECTED_WORKFLOW_DISPATCH_REPLAY_BLOCKED');

  const extracted = extractProtectedWorkflowDispatch(body);
  if (!extracted.ok) fail(extracted.blocker, extracted.details);
  const validation = validateProtectedWorkflowDispatch(extracted.command, {
    authorLogin,
    issueNumber,
    now,
    authoredAt,
  });
  if (!validation.ok) fail(validation.blocker, validation.details);
  const command = validation.command;

  if (command.operation === PROTECTED_WORKFLOW_READY_OPERATION) {
    const before = await readExactState(command, { allowDraft: true });
    let lifecycleResult = 'ALREADY_READY';
    if (before.pull.draft === true) {
      const mutation = await graphqlReady(before.pull.node_id);
      if (!mutation
        || Number(mutation.number) !== command.prNumber
        || mutation.headRefOid !== command.expectedHead
        || mutation.isDraft !== false) {
        fail('PROTECTED_WORKFLOW_READY_MUTATION_RESULT_INVALID');
      }
      lifecycleResult = 'READY_FOR_REVIEW_PROVEN';
    }
    const after = await readExactState(command, { allowDraft: true });
    if (after.pull.draft !== false) fail('PROTECTED_WORKFLOW_READY_POST_MUTATION_NOT_READY');
    const receipt = await postReceipt(command, lifecycleResult);
    console.log(JSON.stringify({ ok: true, verdict: lifecycleResult, receipt }));
    return;
  }

  if (command.operation === PROTECTED_WORKFLOW_DISPATCH_OPERATION) {
    await readExactState(command, { allowDraft: false });
    const liveComment = await github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/issues/comments/${authorizationCommentId}`);
    const proof = validateProtectedWorkflowActorHandoff(liveComment, command, {
      transportActor: authorLogin, transportActorId: event.comment.user.id, expectedCommentId: authorizationCommentId,
      expectedCommentSha256: protectedWorkflowAuthorizationCommentSha256(event.comment), now: new Date(),
    });
    if (!proof.ok) fail(proof.blocker, proof.details);
    await rejectPriorProtectedDispatch(command);
    const dispatch = buildProtectedWorkflowDispatchRequest(command, { authorizationCommentId });
    if (!dispatch.ok) fail(dispatch.blocker, dispatch.details);
    await github(dispatch.path, { method: dispatch.method, body: dispatch.body, expectedStatus: 204 });
    const receipt = await postReceipt(command, 'PROTECTED_MERGE_WORKFLOW_DISPATCHED');
    console.log(JSON.stringify({ ok: true, verdict: 'PROTECTED_WORKFLOW_DISPATCHED', receipt }));
    return;
  }

  fail('PROTECTED_WORKFLOW_DISPATCH_OPERATION_NOT_ALLOWED');
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    verdict: 'PROTECTED_WORKFLOW_DISPATCH_BLOCKED',
    blocker: error?.message || String(error),
    details: error?.details || {},
  }));
  process.exitCode = 1;
});
