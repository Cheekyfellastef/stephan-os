#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  appendIndependentReviewHandoffProvenanceV1,
  buildIndependentReviewHandoffProvenanceV1,
  parseIndependentReviewHandoffProvenanceV1,
} from '../shared/agents/independentReviewHandoffProvenanceV1.mjs';
import {
  buildIndependentReviewHandoffRunReceiptV1,
} from '../shared/agents/independentReviewHandoffRunReceiptV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-handoff-provenance-v1';
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  id: 41898282,
});
const FULL_SHA = /^[0-9a-f]{40}$/i;
const DISPATCH_MARKER = 'stephanos:exact-head-review-dispatch:v1';

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function repositoryParts(repository) {
  const match = text(repository).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return { owner: match[1], repo: match[2] };
}

function sameSha(left, right) {
  return FULL_SHA.test(text(left))
    && FULL_SHA.test(text(right))
    && text(left).toLowerCase() === text(right).toLowerCase();
}

async function githubRequest(pathname, { method = 'GET', body = null, token } = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${token}`,
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
    throw new Error(`GitHub ${method} ${pathname} failed (${response.status}): ${text(message)}`);
  }
  return payload;
}

function exactCheckoutSha() {
  const sha = text(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })).toLowerCase();
  if (!FULL_SHA.test(sha)) throw new Error('trusted coordinator checkout SHA is invalid');
  return sha;
}

function exactDispatchHead(body) {
  const match = text(body).match(new RegExp(`<!--\\s*${DISPATCH_MARKER}\\s+head=([0-9a-f]{40})\\s*-->`, 'i'));
  return match?.[1]?.toLowerCase() || '';
}

function exactRunnerTempReceiptPath(runnerTemp, requestedPath) {
  const root = path.resolve(text(runnerTemp));
  const target = path.resolve(text(requestedPath));
  if (!text(runnerTemp) || !text(requestedPath)) {
    throw new Error('RUNNER_TEMP and immutable handoff receipt path are required');
  }
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('immutable handoff receipt path must be a file inside RUNNER_TEMP');
  }
  return target;
}

async function main() {
  const token = text(process.env.GITHUB_TOKEN);
  const repository = text(process.env.GITHUB_REPOSITORY);
  const runId = positiveInteger(process.env.GITHUB_RUN_ID);
  const runAttempt = positiveInteger(process.env.GITHUB_RUN_ATTEMPT);
  const jobIdentity = text(process.env.GITHUB_JOB);
  const workflowRef = text(process.env.GITHUB_WORKFLOW_REF);
  const commentId = positiveInteger(process.env.STEPHANOS_REVIEW_HANDOFF_COMMENT_ID);
  const prNumber = positiveInteger(process.env.STEPHANOS_REVIEW_HANDOFF_PR);
  const receiptPath = exactRunnerTempReceiptPath(
    process.env.RUNNER_TEMP,
    process.env.STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH,
  );

  if (!token || !repository || !runId || !runAttempt || !jobIdentity || !workflowRef || !commentId || !prNumber) {
    throw new Error('exact coordinator run, comment and PR environment is required');
  }

  const { owner, repo } = repositoryParts(repository);
  const trustedSourceSha = exactCheckoutSha();
  const [mainBranch, workflowRun, comment, pullRequest] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/branches/main`, { token }),
    githubRequest(`/repos/${owner}/${repo}/actions/runs/${runId}`, { token }),
    githubRequest(`/repos/${owner}/${repo}/issues/comments/${commentId}`, { token }),
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token }),
  ]);

  const currentMainSha = text(mainBranch?.commit?.sha).toLowerCase();
  if (!sameSha(currentMainSha, trustedSourceSha)) {
    throw new Error('trusted coordinator checkout is not exact current main');
  }
  if (positiveInteger(workflowRun?.id) !== runId
    || positiveInteger(workflowRun?.run_attempt) !== runAttempt) {
    throw new Error('GitHub workflow run does not match the current coordinator run');
  }

  const issueUrl = text(comment?.issue_url);
  const expectedIssueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}`;
  if (issueUrl !== expectedIssueUrl
    || text(comment?.user?.login).toLowerCase() !== TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    || positiveInteger(comment?.user?.id) !== TRUSTED_GITHUB_ACTIONS_REVIEWER.id) {
    throw new Error('handoff comment identity is not canonical');
  }

  if (text(pullRequest?.state).toLowerCase() !== 'open'
    || positiveInteger(pullRequest?.number) !== prNumber
    || text(pullRequest?.base?.ref) !== 'main'
    || !sameSha(pullRequest?.base?.sha, currentMainSha)
    || text(pullRequest?.head?.repo?.full_name) !== repository
    || text(pullRequest?.base?.repo?.full_name) !== repository) {
    throw new Error('pull request no longer matches exact current main and same-repository review scope');
  }

  const sourceHead = exactDispatchHead(comment?.body);
  if (!sourceHead || !sameSha(sourceHead, pullRequest?.head?.sha)) {
    throw new Error('handoff comment marker is not bound to the exact current pull request head');
  }

  const provenance = buildIndependentReviewHandoffProvenanceV1({
    repository,
    currentMainSha,
    workflowRun,
    workflowRef,
    jobIdentity,
    handoffCommentId: commentId,
  });
  const updatedBody = appendIndependentReviewHandoffProvenanceV1(comment?.body, provenance);

  await githubRequest(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: 'PATCH',
    token,
    body: { body: updatedBody },
  });

  const persistedComment = await githubRequest(`/repos/${owner}/${repo}/issues/comments/${commentId}`, { token });
  const persistedProvenance = parseIndependentReviewHandoffProvenanceV1(persistedComment?.body, {
    repository,
    currentMainSha,
    handoffCommentId: commentId,
  });
  if (JSON.stringify(persistedProvenance) !== JSON.stringify(provenance)) {
    throw new Error('persisted handoff provenance does not match the exact coordinator-run binding');
  }

  const immutableReceipt = buildIndependentReviewHandoffRunReceiptV1({
    repository,
    currentMainSha,
    pullRequest,
    provenance: persistedProvenance,
  });
  writeFileSync(receiptPath, `${JSON.stringify(immutableReceipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  console.log('INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_BOUND=true');
  console.log(`INDEPENDENT_REVIEW_HANDOFF_COMMENT_ID=${commentId}`);
  console.log(`INDEPENDENT_REVIEW_COORDINATOR_WORKFLOW_RUN_ID=${runId}`);
  console.log(`INDEPENDENT_REVIEW_COORDINATOR_WORKFLOW_RUN_ATTEMPT=${runAttempt}`);
  console.log(`INDEPENDENT_REVIEW_COORDINATOR_SOURCE_SHA=${currentMainSha}`);
  console.log(`INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_PATH=${receiptPath}`);
  console.log(`INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SHA256=${immutableReceipt.bindingSha256}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
