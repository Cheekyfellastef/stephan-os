#!/usr/bin/env node

import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  selectExactReviewDispatchCommentV1,
} from './bind-independent-review-handoff-provenance-v1.mjs';
import {
  validateIndependentReviewHandoffIdentityV1,
} from '../shared/agents/independentReviewHandoffIdentityV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-workflow-dispatch-preflight-v1';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const FULL_DIGEST = /^[0-9a-f]{64}$/i;
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

function exactRunnerTempFile(runnerTemp, requestedPath) {
  const root = path.resolve(text(runnerTemp));
  const target = path.resolve(text(requestedPath));
  if (!text(runnerTemp) || !text(requestedPath)) throw new Error('RUNNER_TEMP and output path are required');
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('workflow-dispatch handoff identity path must be inside RUNNER_TEMP');
  }
  return target;
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

async function githubRequest(pathname, token) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' ? payload.message : raw;
    throw new Error(`GitHub GET ${pathname} failed (${response.status}): ${text(message).slice(0, 300)}`);
  }
  return payload;
}

async function githubCommentPages(owner, repo, prNumber, token) {
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const payload = await githubRequest(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(payload)) throw new Error('review handoff comment listing is not an array');
    comments.push(...payload);
    if (payload.length < 100) return comments;
  }
  throw new Error(`review handoff comment listing exceeded ${MAX_COMMENT_PAGES * 100} records`);
}

async function main() {
  if (text(process.env.GITHUB_ACTIONS) !== 'true') throw new Error('dispatch preflight may run only inside GitHub Actions');
  if (text(process.env.GITHUB_EVENT_NAME) !== 'workflow_dispatch') throw new Error('dispatch preflight requires workflow_dispatch');
  if (text(process.env.GITHUB_JOB) !== 'independent-security-review') throw new Error('dispatch preflight job identity mismatch');

  const token = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  const repository = text(process.env.GITHUB_REPOSITORY);
  const prNumber = positiveInteger(process.env.STEPHANOS_REVIEW_DISPATCH_PR);
  const sourceHead = text(process.env.STEPHANOS_REVIEW_DISPATCH_HEAD).toLowerCase();
  const baseSha = text(process.env.STEPHANOS_REVIEW_DISPATCH_BASE).toLowerCase();
  const branch = text(process.env.STEPHANOS_REVIEW_DISPATCH_BRANCH);
  const handoffBinding = text(process.env.STEPHANOS_REVIEW_DISPATCH_BINDING).toLowerCase();
  const receiptBinding = text(process.env.STEPHANOS_REVIEW_DISPATCH_RECEIPT_BINDING).toLowerCase();
  const identityPath = exactRunnerTempFile(
    process.env.RUNNER_TEMP,
    process.env.STEPHANOS_INDEPENDENT_REVIEW_HANDOFF_IDENTITY_PATH,
  );

  if (!token || !repository || !prNumber || !FULL_SHA.test(sourceHead) || !FULL_SHA.test(baseSha)
    || !branch || !FULL_DIGEST.test(handoffBinding) || !FULL_DIGEST.test(receiptBinding)) {
    throw new Error('exact workflow-dispatch review identity is incomplete');
  }

  const { owner, repo } = repositoryParts(repository);
  const [mainBranch, pullRequest, comments] = await Promise.all([
    githubRequest(`/repos/${owner}/${repo}/branches/main`, token),
    githubRequest(`/repos/${owner}/${repo}/pulls/${prNumber}`, token),
    githubCommentPages(owner, repo, prNumber, token),
  ]);
  const currentMainSha = text(mainBranch?.commit?.sha).toLowerCase();
  if (!sameSha(currentMainSha, baseSha) || !sameSha(process.env.GITHUB_SHA, currentMainSha)) {
    throw new Error('workflow-dispatch run is not executing exact current main');
  }
  if (text(pullRequest?.state).toLowerCase() !== 'open'
    || positiveInteger(pullRequest?.number) !== prNumber
    || text(pullRequest?.head?.ref) !== branch
    || !sameSha(pullRequest?.head?.sha, sourceHead)
    || text(pullRequest?.base?.ref) !== 'main'
    || !sameSha(pullRequest?.base?.sha, currentMainSha)
    || text(pullRequest?.head?.repo?.full_name) !== repository
    || text(pullRequest?.base?.repo?.full_name) !== repository) {
    throw new Error('workflow-dispatch pull request no longer matches exact current main');
  }

  const comment = selectExactReviewDispatchCommentV1(comments, { sourceHead });
  const event = {
    repository: { full_name: repository },
    issue: { number: prNumber, pull_request: {} },
    comment,
  };
  const handoffIdentity = validateIndependentReviewHandoffIdentityV1({
    event,
    repository,
    prNumber,
    sourceHead,
    baseSha: currentMainSha,
    branch,
  });
  if (!sameSha(handoffIdentity.sourceHead, sourceHead)
    || !sameSha(handoffIdentity.baseSha, currentMainSha)) {
    throw new Error('authenticated handoff identity no longer matches dispatched source/base');
  }

  writeFileSync(identityPath, `${JSON.stringify(handoffIdentity, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  const provenance = handoffIdentity.coordinatorProvenance;
  const commentId = positiveInteger(provenance?.handoffCommentId);
  const coordinatorRunId = positiveInteger(provenance?.coordinatorWorkflowRunId);
  const coordinatorRunAttempt = positiveInteger(provenance?.coordinatorWorkflowRunAttempt);
  if (!commentId || !coordinatorRunId || !coordinatorRunAttempt) {
    throw new Error('authenticated handoff provenance is incomplete');
  }
  const artifactName = `stephanos-independent-review-handoff-${coordinatorRunId}-attempt-${coordinatorRunAttempt}-comment-${commentId}`;

  appendOutput('coordinator_run_id', coordinatorRunId);
  appendOutput('coordinator_run_attempt', coordinatorRunAttempt);
  appendOutput('handoff_comment_id', commentId);
  appendOutput('handoff_artifact_name', artifactName);
  console.log('INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT=PASS');
  console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PR=${prNumber}`);
  console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_HEAD=${sourceHead}`);
  console.log(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_BASE=${currentMainSha}`);
  console.log(`INDEPENDENT_REVIEW_HANDOFF_ARTIFACT_NAME=${artifactName}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(`INDEPENDENT_REVIEW_WORKFLOW_DISPATCH_PREFLIGHT_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
