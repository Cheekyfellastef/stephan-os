#!/usr/bin/env node

import fs from 'node:fs';

import {
  DEFAULT_REVIEW_RECEIPT_TIMEOUT_MS,
  EXACT_HEAD_REVIEW_DECISION,
  buildMissingReceiptEscalationComment,
  buildReviewDispatchComment,
  buildReviewReceiptComment,
  canonicalLaneEvidence,
  evaluateExactHeadReviewDispatch,
} from '../shared/agents/exactHeadReviewDispatchCoordinator.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-exact-head-review-dispatch-v1';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function positiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(path) {
  if (!path || !fs.existsSync(path)) return {};
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

function repositoryParts(repository) {
  const match = text(repository).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return { owner: match[1], repo: match[2] };
}

function authToken() {
  return text(
    process.env.STEPHANOS_REVIEW_DISPATCH_TOKEN
      ?? process.env.GITHUB_TOKEN
      ?? process.env.GH_TOKEN,
  );
}

async function githubRequest(path, { method = 'GET', body = null, token, accept = 'application/vnd.github+json' } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload ? payload.message : raw;
    throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${text(message, 'unknown error')}`);
  }
  return payload;
}

async function githubPages(path, { token, itemKey = null } = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const payload = await githubRequest(`${path}${separator}per_page=100&page=${page}`, { token });
    const pageItems = itemKey ? payload?.[itemKey] : payload;
    if (!Array.isArray(pageItems)) throw new Error(`GitHub pagination payload for ${path} is not an array`);
    items.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return items;
}

function candidatePrNumbers(event, manualPrNumber) {
  if (manualPrNumber) return [manualPrNumber];
  const issuePr = event?.issue?.pull_request && positiveInteger(event?.issue?.number);
  if (issuePr) return [issuePr];
  const workflowPrs = Array.isArray(event?.workflow_run?.pull_requests)
    ? event.workflow_run.pull_requests.map((pr) => positiveInteger(pr?.number)).filter(Boolean)
    : [];
  return [...new Set(workflowPrs)];
}

function mapComment(comment) {
  return {
    id: comment?.id ?? null,
    body: text(comment?.body),
    user: { login: text(comment?.user?.login) },
    createdAt: comment?.created_at ?? null,
    updatedAt: comment?.updated_at ?? null,
  };
}

function mapReview(review) {
  return {
    id: review?.id ?? null,
    body: text(review?.body),
    commitId: text(review?.commit_id),
    user: { login: text(review?.user?.login) },
    submittedAt: review?.submitted_at ?? null,
  };
}

function mapWorkflowRun(run) {
  return {
    id: run?.id ?? null,
    name: text(run?.name),
    headSha: text(run?.head_sha),
    status: text(run?.status),
    conclusion: text(run?.conclusion),
    event: text(run?.event),
    runAttempt: Number(run?.run_attempt ?? 0),
    createdAt: run?.created_at ?? null,
    updatedAt: run?.updated_at ?? null,
    htmlUrl: text(run?.html_url),
  };
}

async function listOpenPullRequests({ owner, repo, token }) {
  return githubPages(`/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc`, { token });
}

async function loadPrContext({ owner, repo, repository, token, prNumber }) {
  const pr = await githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token });
  const comments = (await githubPages(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, { token })).map(mapComment);
  const reviews = (await githubPages(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, { token })).map(mapReview);
  const runs = (await githubPages(
    `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(text(pr?.head?.sha))}&event=pull_request`,
    { token, itemKey: 'workflow_runs' },
  )).map(mapWorkflowRun);
  const laneEvidence = canonicalLaneEvidence(comments);
  return {
    rawPr: pr,
    comments,
    reviews,
    workflowRuns: runs,
    canonicalLaneConfirmed: laneEvidence.confirmed,
    canonicalLaneCommentId: laneEvidence.commentId,
    pr: {
      number: positiveInteger(pr?.number),
      state: text(pr?.state),
      baseRef: text(pr?.base?.ref),
      headSha: text(pr?.head?.sha),
      sameRepository: text(pr?.head?.repo?.full_name).toLowerCase() === repository.toLowerCase(),
    },
  };
}

async function postPrComment({ owner, repo, token, prNumber, body }) {
  const result = await githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body },
    token,
  });
  return result?.id ?? null;
}

async function discoverCanonicalContexts({ owner, repo, repository, token, requestedNumbers }) {
  const numbers = requestedNumbers.length
    ? requestedNumbers
    : (await listOpenPullRequests({ owner, repo, token })).map((pr) => positiveInteger(pr?.number)).filter(Boolean);
  const contexts = [];
  for (const prNumber of [...new Set(numbers)]) {
    const context = await loadPrContext({ owner, repo, repository, token, prNumber });
    if (context.canonicalLaneConfirmed) contexts.push(context);
  }
  return contexts;
}

async function main() {
  const repository = text(process.env.GITHUB_REPOSITORY);
  const { owner, repo } = repositoryParts(repository);
  const token = authToken();
  if (!token) throw new Error('a bounded GitHub token is required');

  const event = readJson(text(process.env.GITHUB_EVENT_PATH));
  const manualPrNumber = positiveInteger(process.env.STEPHANOS_EXACT_HEAD_REVIEW_PR);
  const requestedNumbers = candidatePrNumbers(event, manualPrNumber);
  const contexts = await discoverCanonicalContexts({ owner, repo, repository, token, requestedNumbers });

  if (contexts.length === 0) {
    console.log('EXACT_HEAD_REVIEW_DISPATCH_DECISION=NO_CANONICAL_LANE');
    appendOutput('decision', 'NO_CANONICAL_LANE');
    return;
  }
  if (contexts.length > 1) {
    const candidates = contexts.map((context) => `#${context.pr.number}@${context.pr.headSha}`).join(',');
    throw new Error(`multiple canonical review lanes detected; refusing mutation: ${candidates}`);
  }

  const [context] = contexts;
  const timeoutMinutes = positiveInteger(process.env.STEPHANOS_REVIEW_RECEIPT_TIMEOUT_MINUTES, Math.round(DEFAULT_REVIEW_RECEIPT_TIMEOUT_MS / 60000));
  const decision = evaluateExactHeadReviewDispatch({
    now: new Date().toISOString(),
    receiptTimeoutMs: timeoutMinutes * 60 * 1000,
    canonicalLaneConfirmed: context.canonicalLaneConfirmed,
    pr: context.pr,
    workflowRuns: context.workflowRuns,
    comments: context.comments,
    reviews: context.reviews,
  });

  console.log(`EXACT_HEAD_REVIEW_DISPATCH_DECISION=${decision.decision}`);
  console.log(`EXACT_HEAD_REVIEW_PR=${decision.prNumber}`);
  console.log(`EXACT_HEAD_REVIEW_HEAD=${decision.exactHead}`);
  console.log(`EXACT_HEAD_REVIEW_REASON=${decision.reason}`);
  appendOutput('decision', decision.decision);
  appendOutput('pr_number', decision.prNumber ?? '');
  appendOutput('exact_head', decision.exactHead);
  appendOutput('reason', decision.reason);

  let commentId = null;
  switch (decision.decision) {
    case EXACT_HEAD_REVIEW_DECISION.DISPATCH_REVIEW:
      commentId = await postPrComment({
        owner,
        repo,
        token,
        prNumber: decision.prNumber,
        body: buildReviewDispatchComment({ prNumber: decision.prNumber, headSha: decision.exactHead }),
      });
      console.log(`EXACT_HEAD_REVIEW_DISPATCH_COMMENT_ID=${commentId}`);
      appendOutput('comment_id', commentId ?? '');
      break;

    case EXACT_HEAD_REVIEW_DECISION.RECORD_REVIEW_RECEIPT:
      commentId = await postPrComment({
        owner,
        repo,
        token,
        prNumber: decision.prNumber,
        body: buildReviewReceiptComment({
          prNumber: decision.prNumber,
          headSha: decision.exactHead,
          externalReceiptId: decision.externalReceiptId,
        }),
      });
      console.log(`EXACT_HEAD_REVIEW_RECEIPT_COMMENT_ID=${commentId}`);
      appendOutput('comment_id', commentId ?? '');
      break;

    case EXACT_HEAD_REVIEW_DECISION.ESCALATE_MISSING_RECEIPT:
      commentId = await postPrComment({
        owner,
        repo,
        token,
        prNumber: decision.prNumber,
        body: buildMissingReceiptEscalationComment({
          prNumber: decision.prNumber,
          headSha: decision.exactHead,
          timeoutMinutes,
          dispatchCommentId: decision.dispatchCommentId,
        }),
      });
      console.log(`EXACT_HEAD_REVIEW_ESCALATION_COMMENT_ID=${commentId}`);
      appendOutput('comment_id', commentId ?? '');
      process.exitCode = 2;
      break;

    default:
      break;
  }
}

main().catch((error) => {
  console.error(`EXACT_HEAD_REVIEW_DISPATCH_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
