#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendIndependentReviewHandoffProvenanceV1,
  buildIndependentReviewHandoffProvenanceV1,
  independentReviewHandoffProvenanceMarkerV1,
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
const MAX_COMMENT_PAGES = 20;

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

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
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

async function githubCommentPages(owner, repo, prNumber, token) {
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const payload = await githubRequest(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      { token },
    );
    if (!Array.isArray(payload)) throw new Error('review handoff comment listing is not an array');
    comments.push(...payload);
    if (payload.length < 100) return comments;
  }
  throw new Error(`review handoff comment listing exceeded ${MAX_COMMENT_PAGES * 100} records`);
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

export function selectExactReviewDispatchCommentV1(comments, { sourceHead } = {}) {
  if (!Array.isArray(comments)) throw new Error('review handoff comments must be an array');
  const head = text(sourceHead).toLowerCase();
  if (!FULL_SHA.test(head)) throw new Error('exact review handoff source head is required');
  const marker = `<!-- ${DISPATCH_MARKER} head=${head} -->`;
  const matches = comments.filter((comment) => (
    text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && positiveInteger(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    && text(comment?.body).startsWith(marker)
    && text(comment?.body).includes('## Provider-neutral exact-head review handoff')
    && positiveInteger(comment?.id)
  ));
  if (matches.length !== 1) {
    throw new Error(`exact review handoff comment count must be one, observed ${matches.length}`);
  }
  return matches[0];
}

async function main() {
  const token = text(process.env.GITHUB_TOKEN);
  const repository = text(process.env.GITHUB_REPOSITORY);
  const runId = positiveInteger(process.env.GITHUB_RUN_ID);
  const runAttempt = positiveInteger(process.env.GITHUB_RUN_ATTEMPT);
  const jobIdentity = text(process.env.GITHUB_JOB);
  const workflowRef = text(process.env.GITHUB_WORKFLOW_REF);
  let commentId = positiveInteger(process.env.STEPHANOS_REVIEW_HANDOFF_COMMENT_ID);
  const prNumber = positiveInteger(process.env.STEPHANOS_REVIEW_HANDOFF_PR);
  const requestedSourceHead = text(process.env.STEPHANOS_REVIEW_HANDOFF_HEAD).toLowerCase();
  const receiptPath = exactRunnerTempReceiptPath(
    process.env.RUNNER_TEMP,
    process.env.STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH,
  );

  if (!token || !repository || !runId || !runAttempt || !jobIdentity || !workflowRef || !prNumber) {
    throw new Error('exact coordinator run and PR environment is required');
  }
  if (requestedSourceHead && !FULL_SHA.test(requestedSourceHead)) {
    throw new Error('requested exact review handoff source head is invalid');
  }

  const { owner, repo } = repositoryParts(repository);
  const trustedSourceSha = exactCheckoutSha();
  const [mainBranch, workflowRun, pullRequest] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/branches/main`, { token }),
    githubRequest(`/repos/${owner}/${repo}/actions/runs/${runId}`, { token }),
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
  if (text(pullRequest?.state).toLowerCase() !== 'open'
    || positiveInteger(pullRequest?.number) !== prNumber
    || text(pullRequest?.base?.ref) !== 'main'
    || !sameSha(pullRequest?.base?.sha, currentMainSha)
    || text(pullRequest?.head?.repo?.full_name) !== repository
    || text(pullRequest?.base?.repo?.full_name) !== repository) {
    throw new Error('pull request no longer matches exact current main and same-repository review scope');
  }
  if (requestedSourceHead && !sameSha(requestedSourceHead, pullRequest?.head?.sha)) {
    throw new Error('requested review handoff head no longer matches the pull request');
  }

  let comment;
  if (commentId) {
    comment = await githubRequest(`/repos/${owner}/${repo}/issues/comments/${commentId}`, { token });
  } else {
    const comments = await githubCommentPages(owner, repo, prNumber, token);
    comment = selectExactReviewDispatchCommentV1(comments, {
      sourceHead: text(pullRequest?.head?.sha).toLowerCase(),
    });
    commentId = positiveInteger(comment?.id);
  }

  const issueUrl = text(comment?.issue_url);
  const expectedIssueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}`;
  if (issueUrl !== expectedIssueUrl
    || text(comment?.user?.login).toLowerCase() !== TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    || positiveInteger(comment?.user?.id) !== TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    || !commentId) {
    throw new Error('handoff comment identity is not canonical');
  }

  const sourceHead = exactDispatchHead(comment?.body);
  if (!sourceHead || !sameSha(sourceHead, pullRequest?.head?.sha)) {
    throw new Error('handoff comment marker is not bound to the exact current pull request head');
  }
  if (requestedSourceHead && !sameSha(sourceHead, requestedSourceHead)) {
    throw new Error('handoff comment marker is not bound to the requested exact head');
  }

  const provenanceMarker = independentReviewHandoffProvenanceMarkerV1();
  let provenance;
  let persistedComment = comment;
  if (text(comment?.body).includes(provenanceMarker)) {
    provenance = parseIndependentReviewHandoffProvenanceV1(comment?.body, {
      repository,
      currentMainSha,
      handoffCommentId: commentId,
    });
  } else {
    provenance = buildIndependentReviewHandoffProvenanceV1({
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

    persistedComment = await githubRequest(`/repos/${owner}/${repo}/issues/comments/${commentId}`, { token });
    const persistedProvenance = parseIndependentReviewHandoffProvenanceV1(persistedComment?.body, {
      repository,
      currentMainSha,
      handoffCommentId: commentId,
    });
    if (JSON.stringify(persistedProvenance) !== JSON.stringify(provenance)) {
      throw new Error('persisted handoff provenance does not match the exact coordinator-run binding');
    }
    provenance = persistedProvenance;
  }

  const immutableReceipt = buildIndependentReviewHandoffRunReceiptV1({
    repository,
    currentMainSha,
    pullRequest,
    provenance,
  });
  writeFileSync(receiptPath, `${JSON.stringify(immutableReceipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  appendOutput('handoff_comment_id', commentId);
  appendOutput('handoff_run_receipt_sha256', immutableReceipt.bindingSha256);
  console.log('INDEPENDENT_REVIEW_HANDOFF_PROVENANCE_BOUND=true');
  console.log(`INDEPENDENT_REVIEW_HANDOFF_COMMENT_ID=${commentId}`);
  console.log(`INDEPENDENT_REVIEW_COORDINATOR_WORKFLOW_RUN_ID=${provenance.coordinatorWorkflowRunId}`);
  console.log(`INDEPENDENT_REVIEW_COORDINATOR_WORKFLOW_RUN_ATTEMPT=${provenance.coordinatorWorkflowRunAttempt}`);
  console.log(`INDEPENDENT_REVIEW_COORDINATOR_SOURCE_SHA=${provenance.coordinatorSourceSha}`);
  console.log(`INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_PATH=${receiptPath}`);
  console.log(`INDEPENDENT_REVIEW_HANDOFF_RUN_RECEIPT_SHA256=${immutableReceipt.bindingSha256}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
