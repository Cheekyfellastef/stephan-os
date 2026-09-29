#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import {
  planIndependentReviewTerminalFindingsPublicationV1,
  renderIndependentReviewTerminalFindingsCommentV1,
} from '../shared/agents/independentReviewTerminalFindingsPublicationV1.mjs';
import {
  planIndependentReviewPreArtifactFailureReceiptV1,
} from '../shared/agents/independentReviewPreArtifactFailureReceiptV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-terminal-findings-v1';
const TRUSTED_GITHUB_ACTIONS_REVIEWER = Object.freeze({
  login: 'github-actions[bot]',
  id: 41898282,
});
const MAX_COMMENT_PAGES = 20;
const PRE_ARTIFACT_FAILURE_FILE = 'independent-review-pre-artifact-failure.json';

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function appendOutput(name, value) {
  const outputPath = text(process.env.GITHUB_OUTPUT);
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value ?? '').replace(/\r?\n/g, ' ')}\n`);
}

function repositoryParts(repository) {
  const match = text(repository).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) throw new Error('GITHUB_REPOSITORY must be owner/name');
  return { owner: match[1], repo: match[2] };
}

function exactArtifactPath() {
  const runnerTemp = text(process.env.RUNNER_TEMP);
  const requested = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_ARTIFACT_PATH);
  if (!runnerTemp || !requested) throw new Error('runner temp and independent-review artifact path are required');
  const expected = path.resolve(runnerTemp, 'independent-review-result.json');
  const actual = path.resolve(requested);
  if (expected !== actual) throw new Error('terminal findings publisher accepts only the exact runner-temp review artifact');
  return actual;
}

function exactPreArtifactFailurePath() {
  const runnerTemp = text(process.env.RUNNER_TEMP);
  if (!runnerTemp) throw new Error('runner temp is required for pre-artifact failure publication');
  return path.resolve(runnerTemp, PRE_ARTIFACT_FAILURE_FILE);
}

async function githubRequest(pathname, { method = 'GET', body = null } = {}) {
  const token = text(process.env.GITHUB_TOKEN);
  if (!token) throw new Error('GITHUB_TOKEN is required for terminal findings publication');
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
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
    const message = payload && typeof payload === 'object' ? payload.message : raw;
    throw new Error(`GitHub ${method} ${pathname} failed (${response.status}): ${text(message).slice(0, 300)}`);
  }
  return payload;
}

async function issueComments(owner, repo, prNumber) {
  const comments = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const rows = await githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error('issue comments response is not an array');
    comments.push(...rows);
    if (rows.length < 100) return comments;
  }
  throw new Error('issue comments exceed bounded terminal-findings scan');
}

function trustedMarkerMatches(comments, marker) {
  return comments.filter((comment) => (
    text(comment?.user?.login).toLowerCase() === TRUSTED_GITHUB_ACTIONS_REVIEWER.login
    && Number(comment?.user?.id) === TRUSTED_GITHUB_ACTIONS_REVIEWER.id
    && text(comment?.body).startsWith(marker)
  ));
}

async function publishExactComment(owner, repo, prNumber, marker, body, duplicateError) {
  const comments = await issueComments(owner, repo, prNumber);
  const matches = trustedMarkerMatches(comments, marker);
  if (matches.length > 1) throw new Error(duplicateError);
  if (matches.length === 1) return { created:false, id:positiveInteger(matches[0].id) };

  const created = await githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method:'POST',
    body:{ body },
  });
  if (!positiveInteger(created?.id)
      || text(created?.user?.login).toLowerCase() !== TRUSTED_GITHUB_ACTIONS_REVIEWER.login
      || Number(created?.user?.id) !== TRUSTED_GITHUB_ACTIONS_REVIEWER.id
      || !text(created?.body).startsWith(marker)) {
    throw new Error('terminal review publication did not return the exact trusted comment identity');
  }
  return { created:true, id:positiveInteger(created.id) };
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('terminal findings publication may run only inside GitHub Actions');
  }
  const eventName = text(process.env.GITHUB_EVENT_NAME);
  if (!['pull_request_target', 'workflow_dispatch'].includes(eventName)) {
    throw new Error(`terminal findings event ${eventName || 'unknown'} is not allowlisted`);
  }

  const repository = text(process.env.GITHUB_REPOSITORY);
  const prNumber = positiveInteger(process.env.STEPHANOS_TERMINAL_REVIEW_PR);
  const branch = text(process.env.STEPHANOS_TERMINAL_REVIEW_BRANCH);
  const sourceHead = text(process.env.STEPHANOS_TERMINAL_REVIEW_HEAD).toLowerCase();
  const baseSha = text(process.env.STEPHANOS_TERMINAL_REVIEW_BASE).toLowerCase();
  const workflowRunId = positiveInteger(process.env.GITHUB_RUN_ID);
  const workflowRunAttempt = positiveInteger(process.env.GITHUB_RUN_ATTEMPT);
  const artifactPath = exactArtifactPath();
  const { owner, repo } = repositoryParts(repository);

  if (!fs.existsSync(artifactPath)) {
    const failurePlan = planIndependentReviewPreArtifactFailureReceiptV1({
      repository,
      prNumber,
      branch,
      sourceHead,
      baseSha,
      workflowRunId,
      workflowRunAttempt,
    });
    console.log(`INDEPENDENT_REVIEW_TERMINAL_FINDINGS=${failurePlan.decision}`);
    appendOutput('decision', failurePlan.decision);
    if (failurePlan.publishAllowed !== true) {
      throw new Error(`pre-artifact review failure identity is invalid: ${failurePlan.errors.join(',')}`);
    }
    const failurePath = exactPreArtifactFailurePath();
    fs.writeFileSync(failurePath, `${JSON.stringify(failurePlan.receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    console.log(`INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_FILE=${failurePath}`);
    console.log(`INDEPENDENT_REVIEW_PRE_ARTIFACT_FAILURE_RUN=${failurePlan.receipt.runIdentityHint}`);
    appendOutput('mutation', 'write-pre-artifact-failure-artifact');
    appendOutput('pre_artifact_receipt_path', failurePath);
    return;
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const plan = planIndependentReviewTerminalFindingsPublicationV1({
    artifact,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    workflowRunId,
    workflowRunAttempt,
  });
  console.log(`INDEPENDENT_REVIEW_TERMINAL_FINDINGS=${plan.decision}`);
  appendOutput('decision', plan.decision);
  if (plan.publishAllowed !== true) return;

  const published = await publishExactComment(
    owner,
    repo,
    prNumber,
    plan.marker,
    renderIndependentReviewTerminalFindingsCommentV1(plan),
    'terminal findings marker is duplicated',
  );
  if (!published.created) console.log('INDEPENDENT_REVIEW_TERMINAL_FINDINGS_ALREADY_PUBLISHED=true');
  console.log(`INDEPENDENT_REVIEW_TERMINAL_FINDINGS_COMMENT=${published.id}`);
  appendOutput('mutation', published.created ? 'publish-terminal-findings' : 'none');
  appendOutput('comment_id', published.id);
}

main().catch((error) => {
  console.error(`INDEPENDENT_REVIEW_TERMINAL_FINDINGS_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});